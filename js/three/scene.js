// file: js/three/scene.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPot } from '../core/geometry.js';
import { computeStrength } from '../core/math.js';
import { MATERIALS, byId } from '../config/materials.js';
import { byGlazeId } from '../config/glazes.js';
import { coatProfile } from '../core/glazeCoat.js';
import { createGlazeMaterial, applyGlazeLook } from './glazeMaterial.js';

let container, renderer, scene, camera, controls, wheelGroup, potMesh, clayMat, glazeMat, platen;
let lastCoat=null;   // толщина глазури последней сборки: {runMax, sharpest}
let platenMat, lastPlatenR=0;
let lastProfile=[];   // профиль последней сборки, в мм — для привязки чертежа
let previewPath=null; // контур оснастки: пока задан, в сцене показывается он, а не изделие

function rebuildPlaten(baseR){
  const rad=Math.max(baseR+35,80);
  if(platen && Math.abs(rad-lastPlatenR)<2) return;
  lastPlatenR=rad;
  if(platen){platen.geometry.dispose();wheelGroup.remove(platen);}
  platen=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad*1.05,15,64),platenMat);
  platen.position.y=-7.5;
  platen.castShadow=platen.receiveShadow=true;
  wheelGroup.add(platen);
}

function applyHeatmap(geo,path,str){
  const n=path.length;
  const cnt=geo.attributes.position.count;
  const colors=new Float32Array(cnt*3);
  const c=new THREE.Color();
  const sfAt=y=>{
    const ys=str.y;
    if(y<=ys[0])return str.sf[0];
    for(let i=1;i<ys.length;i++){
      if(ys[i]>=y){
        const a=ys[i-1],b=ys[i];
        const k=(b-a)<1e-6?0:(y-a)/(b-a);
        return str.sf[i-1]+(str.sf[i]-str.sf[i-1])*k;
      }
    }
    return str.sf[ys.length-1];
  };
  const sfColor=sf=>{
    if(sf>=3){c.setRGB(.42,.68,.40);return c;}
    if(sf>=1.5){const k=(3-sf)/1.5;c.setRGB(.42+.46*k,.68-.03*k,.40-.15*k);return c;}
    const k=Math.min((1.5-sf)/0.7,1);c.setRGB(.88-.03*k,.65-.35*k,.25+.01*k);return c;
  };
  for(let v=0;v<cnt;v++){
    c.copy(sfColor(sfAt(path[v%n].y)));
    colors[v*3]=c.r;colors[v*3+1]=c.g;colors[v*3+2]=c.b;
  }
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
}

/* Толщина глазури по вершинам. LatheGeometry раскладывает вершины по сегментам,
   внутри сегмента — по точкам контура, поэтому индекс точки это v % n. */
function applyCoat(geo, path, state){
  const g=byGlazeId(state.glazeId);
  const {coat, runMax, sharpest}=coatProfile(path.map(p=>({r:p.x,y:p.y})), g.look);
  const n=path.length, cnt=geo.attributes.position.count;
  const a=new Float32Array(cnt);
  for(let v=0;v<cnt;v++) a[v]=coat[v%n];
  geo.setAttribute('aCoat', new THREE.BufferAttribute(a,1));
  return {runMax, sharpest};
}

/* Тело вращения из контура оснастки. Показываем три четверти оборота: снаружи
   читается как блок, а вырезанная четверть открывает полость — иначе матрица
   выглядит просто цилиндром. На экспорт STL уходит полное тело. */
function buildFromPath(path, state){
  const pts=path.map(p=>new THREE.Vector2(Math.max(p.r,0.01),p.y));
  const seg=Math.max(state.segments,48);
  return {
    path:pts,
    geometry:new THREE.LatheGeometry(pts,Math.round(seg*0.75),Math.PI*0.5,Math.PI*1.5),
    scale:1,
    baseR:Math.max(...pts.map(p=>p.x)),
  };
}

/* Какую долю высоты вида закрывает панель кинотеатра. На широком экране она мала
   и ничего не меняет; на телефоне занимает треть — изделие пришлось бы разглядывать
   сквозь неё, поэтому вид отъезжает и приподнимает изделие над панелью. */
function bottomInset(){
  const c=document.querySelector('.cinema');
  const h=container&&container.clientHeight;
  if(!c||!h)return 0;
  const r=c.getBoundingClientRect().height/h;
  return r>0.18?Math.min(r,0.4):0;
}

export const sceneAPI = {
  init(el){
    container=el;
    renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.05;
    renderer.setClearColor(0x000000,0);
    container.appendChild(renderer.domElement);

    scene=new THREE.Scene();
    scene.fog=new THREE.Fog(0x16110d,900,2400);
    const pmrem=new THREE.PMREMGenerator(renderer);
    scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture;

    camera=new THREE.PerspectiveCamera(40,1,1,6000);
    controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;controls.dampingFactor=.08;
    controls.minDistance=60;controls.maxDistance=2600;
    controls.maxPolarAngle=Math.PI*.58;

    const dir=new THREE.DirectionalLight(0xffe4c4,2.6);
    dir.position.set(300,420,240);
    dir.castShadow=true;
    dir.shadow.mapSize.set(2048,2048);
    Object.assign(dir.shadow.camera,{left:-600,right:600,top:600,bottom:-600,far:1600});
    dir.shadow.bias=-0.0004;
    scene.add(dir);
    scene.add(new THREE.HemisphereLight(0xbfa98f,0x241a12,.5));

    const ground=new THREE.Mesh(new THREE.CircleGeometry(1200,48),new THREE.ShadowMaterial({opacity:.38}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-15.6;ground.receiveShadow=true;
    scene.add(ground);

    const base=new THREE.Mesh(new THREE.CylinderGeometry(18,68,46,40),
      new THREE.MeshStandardMaterial({color:0x241d18,roughness:.7,metalness:.35}));
    base.position.y=-38;base.receiveShadow=true;scene.add(base);

    wheelGroup=new THREE.Group();scene.add(wheelGroup);
    const shaft=new THREE.Mesh(new THREE.CylinderGeometry(12,12,44,24),
      new THREE.MeshStandardMaterial({color:0x3a322b,roughness:.5,metalness:.7}));
    shaft.position.y=-37;wheelGroup.add(shaft);

    platenMat=new THREE.MeshStandardMaterial({color:0x332a23,roughness:.62,metalness:.25});

    clayMat=new THREE.MeshStandardMaterial({color:MATERIALS[0].colors.raw,roughness:.92,side:THREE.DoubleSide});
    glazeMat=createGlazeMaterial();
    potMesh=new THREE.Mesh(new THREE.BufferGeometry(),clayMat);
    potMesh.castShadow=potMesh.receiveShadow=true;
    wheelGroup.add(potMesh);
  },

  /* Показать в сцене оснастку (контур сечения) или вернуть изделие (null). */
  setPreviewPath(path){ previewPath=path&&path.length>2?path:null; },
  previewActive:()=>!!previewPath,

  rebuild(state, str){
    const built=previewPath?buildFromPath(previewPath,state):buildPot(state);
    lastProfile=built.path.map(p=>({r:p.x,y:p.y}));
    if(state.heatmap && !previewPath) applyHeatmap(built.geometry, built.path, str||computeStrength(state));
    lastCoat=previewPath?null:applyCoat(built.geometry, built.path, state);
    potMesh.geometry.dispose();
    potMesh.geometry=built.geometry;
    potMesh.scale.setScalar(built.scale);
    potMesh.updateMatrix();
    rebuildPlaten(built.baseR);
    return {tris: built.geometry.index ? built.geometry.index.count/3 : 0};
  },

  applyMaterial(state){
    if(clayMat.vertexColors!==state.heatmap){
      clayMat.vertexColors=state.heatmap;
      clayMat.needsUpdate=true;
    }
    // политое изделие показываем шейдером глазури, всё остальное — глиной
    const glazed = state.firing==='glaze' && !state.heatmap && !previewPath;
    potMesh.material = glazed ? glazeMat : clayMat;
    if(glazed){
      applyGlazeLook(glazeMat, byGlazeId(state.glazeId), byId(state.mat).colors.bisque);
      return;
    }
    if(state.heatmap){
      clayMat.color.set(0xffffff);clayMat.roughness=.6;clayMat.metalness=0;return;
    }
    const c=byId(state.mat).colors, m=state.firing;
    clayMat.color.setHex(m==='raw'?c.raw:m==='bisque'?c.bisque:c.glaze);
    clayMat.roughness=m==='raw'?.92:m==='bisque'?.88:.25;
    clayMat.metalness=m==='glaze'?.05:0;
  },

  /* Что вышло с покрытием на этой форме: для замечаний мастера. */
  coatStats:()=>lastCoat,

  frameView(state){
    const H=state.H, D=Math.max(state.D,60);
    const a=camera.aspect||1;
    const k=a<1.1?1.1/Math.max(a,0.4):1;      // узкий экран — отъехать, иначе изделие не влезает
    const inset=bottomInset();                // на телефоне низ вида закрыт кинотеатром
    const dist=(Math.max(H,D)*1.5+140)*k*(1+inset*0.9);
    camera.position.set(dist*.62,H*.62+60,dist*.86);
    controls.target.set(0,H*(.45-inset*.55),0);
    controls.update();
  },

  /* Экранная привязка чертежа к модели: где на экране низ и верх силуэта изделия
     и сколько пикселей приходится на миллиметр рецепта. Считается по видимой стороне
     профиля, а не по оси — иначе перспектива даёт расхождение до четверти размера. */
  screenScale(state){
    const h=container.clientHeight;
    if(!h||!camera||!potMesh) return null;
    const sc=potMesh.scale.x||1;
    // направление «на камеру» в плоскости круга: ближняя сторона силуэта
    const dir=new THREE.Vector3().subVectors(camera.position,controls.target);
    dir.y=0;
    if(dir.lengthSq()<1e-6) dir.set(0,0,1);
    dir.normalize();
    const prof=lastProfile.length?lastProfile:[{r:state.D/2,y:0},{r:state.D/2,y:state.H}];
    const v=new THREE.Vector3();
    let yMin=Infinity,yMax=-Infinity;
    for(const p of prof){
      v.set(dir.x*p.r*sc, p.y*sc, dir.z*p.r*sc).project(camera);
      const y=(1-v.y)/2*h;
      if(y<yMin)yMin=y;
      if(y>yMax)yMax=y;
    }
    const pxPerMM=(yMax-yMin)/Math.max(state.H,10);
    return {pxPerMM, baseY:yMax, ok:isFinite(pxPerMM)&&pxPerMM>0.05&&isFinite(yMax)};
  },

  resize(){
    // страховка от обратной связи «канва растит контейнер»: буфер не больше окна
    const w=Math.max(1,Math.min(container.clientWidth,innerWidth));
    const h=Math.max(1,Math.min(container.clientHeight,innerHeight));
    renderer.setSize(w,h);
    camera.aspect=w/h;camera.updateProjectionMatrix();
  },

  spinStep(dt,state){ if(state.spin) wheelGroup.rotation.y+=dt*.55; },
  render(){ controls.update(); renderer.render(scene,camera); },

  pot:()=>potMesh,
  renderer:()=>renderer,
  scene:()=>scene,
  camera:()=>camera,
  clayMaterial:()=>clayMat,
};
