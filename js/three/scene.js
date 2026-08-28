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
let camDirty=true;   // камера или модель сдвинулись — чертежу нужен пересчёт масштаба
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

function ensureAttr(geo,name,size){
  const cnt=geo.attributes.position.count;
  let a=geo.attributes[name];
  if(!a||a.count!==cnt||a.itemSize!==size){
    a=new THREE.BufferAttribute(new Float32Array(cnt*size),size);
    geo.setAttribute(name,a);
  }
  a.needsUpdate=true;
  return a;
}

function applyHeatmap(geo,path,str){
  const n=path.length;
  const cnt=geo.attributes.position.count;
  const colors=ensureAttr(geo,'color',3).array;
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
}

/* Толщина глазури по вершинам. LatheGeometry раскладывает вершины по сегментам,
   внутри сегмента — по точкам контура, поэтому индекс точки это v % n. */
function applyCoat(geo, path, state){
  const g=byGlazeId(state.glazeId);
  const {coat, runMax, sharpest}=coatProfile(path.map(p=>({r:p.x,y:p.y})), g.look);
  const n=path.length, cnt=geo.attributes.position.count;
  const a=ensureAttr(geo,'aCoat',1).array;
  for(let v=0;v<cnt;v++) a[v]=coat[v%n];
  return {runMax, sharpest};
}

/* Габариты содержимого сцены с учётом усадки. */
function modelBox(){
  const g=potMesh.geometry;
  if(!g.boundingBox) g.computeBoundingBox();
  const b=g.boundingBox;
  if(!b) return null;
  const s=potMesh.scale.x||1;
  return {
    minY:b.min.y*s, maxY:b.max.y*s,
    radius:Math.max(Math.abs(b.min.x),Math.abs(b.max.x),Math.abs(b.min.z),Math.abs(b.max.z))*s,
  };
}

/* Расстояние, с которого модель целиком помещается в кадр: по вертикали с оглядкой
   на панель кинотеатра, по горизонтали — на пропорции окна. */
function fitDistance(box){
  const vFov=camera.fov*Math.PI/180;
  const usable=Math.max(0.35,1-bottomInset()*0.95);
  const distV=(box.maxY-box.minY)/2/Math.tan(vFov/2)/usable;
  const hFov=2*Math.atan(Math.tan(vFov/2)*Math.max(camera.aspect||1,0.2));
  const distH=box.radius/Math.tan(hFov/2);
  return Math.max(distV,distH)*1.22+box.radius;
}

const DEFAULT_DIR=new THREE.Vector3(.57,.29,.79).normalize();
function fitCamera(keepAngles){
  const box=modelBox();
  if(!box||!(box.maxY>box.minY)) return;
  const inset=bottomInset();
  const cy=(box.minY+box.maxY)/2-(box.maxY-box.minY)*inset*0.5;
  const dist=Math.min(Math.max(fitDistance(box),controls.minDistance*1.05),controls.maxDistance*0.95);
  const dir=new THREE.Vector3();
  if(keepAngles){
    dir.subVectors(camera.position,controls.target);
    if(dir.lengthSq()<1e-6) dir.copy(DEFAULT_DIR); else dir.normalize();
  }else dir.copy(DEFAULT_DIR);
  controls.target.set(0,cy,0);
  camera.position.copy(controls.target).addScaledVector(dir,dist);
  camera.near=Math.max(1,dist*0.02);
  camera.far=dist*8+2000;
  camera.updateProjectionMatrix();
  controls.update();
  camDirty=true;
}

/* Модель не должна ни вылезать за кадр, ни теряться точкой вдали. В остальном
   камера принадлежит человеку: если всё помещается, её никто не трогает. */
function keepInView(){
  const box=modelBox();
  if(!box||!(box.maxY>box.minY)) return;
  const need=fitDistance(box);
  const have=camera.position.distanceTo(controls.target);
  if(have<need*0.98||have>need*2.4) fitCamera(true);
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
    // на телефоне буфер вчетверо меньше при том же виде: пиксели там мельче глаза
    const coarse=matchMedia('(pointer:coarse)').matches;
    renderer.setPixelRatio(Math.min(devicePixelRatio,coarse?1.5:2));
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    // тень пересчитывается не каждый кадр, а когда форма изменилась: вращение круга
    // тень тела вращения почти не меняет, а карта 2048² стоит дороже самой сцены
    renderer.shadowMap.autoUpdate=false;
    renderer.shadowMap.needsUpdate=true;
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
    controls.addEventListener('change',()=>{camDirty=true;});
    controls.minDistance=60;controls.maxDistance=2600;
    controls.maxPolarAngle=Math.PI*.58;

    const dir=new THREE.DirectionalLight(0xffe4c4,2.6);
    dir.position.set(300,420,240);
    dir.castShadow=true;
    dir.shadow.mapSize.set(coarse?1024:2048,coarse?1024:2048);
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
    const prev=potMesh.geometry;
    const built=previewPath?buildFromPath(previewPath,state):buildPot(state,prev);
    lastProfile=built.path.map(p=>({r:p.x,y:p.y}));
    if(state.heatmap && !previewPath) applyHeatmap(built.geometry, built.path, str||computeStrength(state));
    // толщину плёнки считаем только когда её видно: на сырой глине это лишняя работа
    lastCoat=(!previewPath && state.firing==='glaze' && !state.heatmap)
      ? applyCoat(built.geometry, built.path, state) : lastCoat;
    if(built.geometry!==prev){ prev.dispose(); potMesh.geometry=built.geometry; }
    potMesh.scale.setScalar(built.scale);
    potMesh.updateMatrix();
    rebuildPlaten(built.baseR);
    camDirty=true;
    renderer.shadowMap.needsUpdate=true;   // тени сами не обновляются, см. init
    keepInView();
    return {tris: built.geometry.index ? built.geometry.index.count/3 : 0};
  },

  applyMaterial(state){
    if(clayMat.vertexColors!==state.heatmap){
      clayMat.vertexColors=state.heatmap;
      clayMat.needsUpdate=true;
    }
    const c=byId(state.mat).colors;
    // политое изделие показываем шейдером глазури, всё остальное — глиной
    const glazed = state.firing==='glaze' && !state.heatmap && !previewPath;
    potMesh.material = glazed ? glazeMat : clayMat;
    if(glazed){ applyGlazeLook(glazeMat, byGlazeId(state.glazeId), c.bisque); return; }
    if(state.heatmap){
      clayMat.color.set(0xffffff);clayMat.roughness=.6;clayMat.metalness=0;return;
    }
    const m=state.firing;
    clayMat.color.setHex(m==='raw'?c.raw:m==='bisque'?c.bisque:c.glaze);
    clayMat.roughness=m==='raw'?.92:m==='bisque'?.88:.25;
    clayMat.metalness=m==='glaze'?.05:0;
  },

  /* Что вышло с покрытием на этой форме: для замечаний мастера. */
  coatStats:()=>lastCoat,

  /* Кадр строится по настоящим габаритам того, что в сцене: раньше он считался
     по рецепту (H и D), из-за чего комок на первом этапе, оснастка и любая
     нестандартная форма вылезали за край. */
  frameView(){ fitCamera(false); },
  refit(){ fitCamera(true); },

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
    camDirty=true;
    renderer.shadowMap.needsUpdate=true;
    keepInView();
  },

  spinStep(dt,state){ if(state.spin) wheelGroup.rotation.y+=dt*.55; },
  render(){ if(controls.update()) camDirty=true; renderer.render(scene,camera); },

  /* Диагностика кадра: с какого расстояния модель помещается и где камера сейчас.
     Нужна проверкам — иначе «камера не так показывает» проверяется только глазом. */
  fitInfo(){
    const box=modelBox();
    if(!box) return null;
    return {need:fitDistance(box), have:camera.position.distanceTo(controls.target),
            h:box.maxY-box.minY, r:box.radius, aspect:camera.aspect};
  },

  /* Сдвинулась ли камера с прошлого опроса. Чертёж 1:1 пересчитывается только
     тогда: раньше проекция всего профиля считалась в каждом кадре впустую. */
  consumeCamDirty(){ const d=camDirty; camDirty=false; return d; },

  pot:()=>potMesh,
  renderer:()=>renderer,
  scene:()=>scene,
  camera:()=>camera,
  clayMaterial:()=>clayMat,
};
