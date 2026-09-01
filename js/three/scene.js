// file: js/three/scene.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPot } from '../core/geometry.js';
import { buildLathe } from '../core/lathe.js';
import { computeStrength } from '../core/math.js';
import { MATERIALS, byId } from '../config/materials.js';
import { byGlazeId } from '../config/glazes.js';
import { coatProfile } from '../core/glazeCoat.js';
import { partCurve, partSection } from '../core/parts.js';
import { sweepGeometry } from './sweep.js';
import { strainerGeometry } from './strainerMesh.js';
import { userProfileMM } from '../core/math.js';
import { lidProfile, sanitizeLid } from '../core/lid.js';
import { createGlazeMaterial, applyGlazeLook } from './glazeMaterial.js';
import { createDome, setDomeColors } from './dome.js';
import { byEnvId } from '../config/environments.js';

let container, renderer, scene, camera, controls, wheelGroup, potMesh, clayMat, glazeMat, platen;
let ringMesh=null;
const picker=new THREE.Raycaster();
/* Цвет указателя берётся из тех же токенов, что и весь интерфейс: своя
   константа разошлась бы с темой в первый же день. */
const accentColor=()=>{
  const v=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  try{ return new THREE.Color(v||'#e0693a'); }catch(_){ return new THREE.Color('#e0693a'); }
};
let groundMat, baseMat, shaftMat, hemi, keyLight, dome, grid;
let groundMesh, baseMesh, shaftMesh, partsGroup, lidGroup, strainMesh;
let envId='workshop', themeNow='dark';   // окружение и тема меняют сцену вместе
let lastCoat=null;   // толщина глазури последней сборки: {runMax, sharpest}
let camDirty=true;   // камера или модель сдвинулись — чертежу нужен пересчёт масштаба
let platenMat, lastPlatenR=0, lastBaseR=80;
let lastProfile=[];   // профиль последней сборки, в мм — для привязки чертежа
let previewPath=null; // контур оснастки: пока задан, в сцене показывается он, а не изделие
let previewGeo=null;  // готовая геометрия (полуформа прилепа): она не тело вращения

/* Подставка под изделием — часть окружения: гончарный круг, подиум, доска,
   полка печи. Геометрия одна, меняются пропорции и материал. */
function rebuildPlaten(baseR, force){
  const ped=byEnvId(envId).pedestal;
  if(ped.kind==='none'){
    if(platen) platen.visible=false;
    if(baseMesh) baseMesh.visible=shaftMesh.visible=false;
    if(groundMesh) groundMesh.position.y=-0.4;
    lastPlatenR=0;
    return;
  }
  const rad=Math.max(baseR+ped.pad,80), h=ped.height;
  if(platen && !force && Math.abs(rad-lastPlatenR)<2){ platen.visible=true; return; }
  lastPlatenR=rad;
  if(platen){platen.geometry.dispose();wheelGroup.remove(platen);}
  const taper=ped.kind==='wheel'?1.05:1.0;
  platen=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad*taper,h,64),platenMat);
  platen.position.y=-h/2;
  platen.visible=true;
  platen.castShadow=platen.receiveShadow=true;
  wheelGroup.add(platen);
  // круг стоит на станине, всё остальное — просто поверхность
  const wheel=ped.kind==='wheel';
  if(baseMesh) baseMesh.visible=shaftMesh.visible=wheel;
  if(groundMesh) groundMesh.position.y=-h-0.4;
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

/* Применить окружение вместе с текущей темой: купол, туман, свет, тень,
   подставка и сетка. Одно место на все шесть вариантов. */
function applyEnv(){
  const e=byEnvId(envId), light=themeNow==='light';
  const c=light?e.light:e.dark;
  setDomeColors(dome,c.sky,c.ground);
  if(e.fog){ scene.fog.color.setHex(c.ground); scene.fog.near=e.fog[0]; scene.fog.far=e.fog[1]; }
  else { scene.fog.near=1e6; scene.fog.far=1e7; }        // туман выключен
  keyLight.color.setHex(e.key.color);
  keyLight.intensity=e.key.intensity;
  keyLight.position.set(e.key.pos[0],e.key.pos[1],e.key.pos[2]);
  const h=light?e.hemi.light:e.hemi.dark;
  hemi.color.setHex(h[0]); hemi.groundColor.setHex(h[1]); hemi.intensity=h[2];
  renderer.toneMappingExposure=light?e.exposure.light:e.exposure.dark;
  groundMat.opacity=light?e.shadow.light:e.shadow.dark;
  grid.visible=!!e.grid;
  if(grid.visible){
    grid.material.transparent=true;
    grid.material.opacity=light?0.4:0.55;
    grid.material.color.setHex(light?0x6f6a64:0xb5aca1);
  }
  const ped=e.pedestal;
  if(ped.kind!=='none'){
    platenMat.color.setHex(light?ped.color.light:ped.color.dark);
    platenMat.roughness=ped.roughness;
    platenMat.metalness=ped.metalness;
    baseMat.color.setHex(light?0x8d7f70:0x241d18);
    shaftMat.color.setHex(light?0xa2968a:0x3a322b);
  }
  rebuildPlaten(lastBaseR,true);
  renderer.shadowMap.needsUpdate=true;
  camDirty=true;
}

/* Прилепы — отдельные тела: ручки и носики. Появляются на подрезке и растут
   от корня, потому что их и прилепляют к подвяленному изделию, а не тянут
   вместе с корпусом. Каждый повёрнут вокруг оси на свой азимут. */
/* Крышка: отдельное тело вращения на кромке. Строится тем же токарем, что
   и корпус, но своим профилем — она не часть изделия, а вторая вещь в печи. */
let lidMesh=null;
function rebuildLid(state){
  const lid=state.lid&&state.lid.on&&!previewPath&&!previewGeo&&state.stage>=5;
  if(!lid){ if(lidMesh) lidMesh.visible=false; return; }
  const prof=userProfileMM(state);
  const L=lidProfile(prof, sanitizeLid(state.lid), state.wall);
  if(!lidMesh){
    lidMesh=new THREE.Mesh(new THREE.BufferGeometry(), potMesh.material);
    lidMesh.castShadow=lidMesh.receiveShadow=true;
    lidGroup.add(lidMesh);
  }
  // токарь ждёт точки контура как {x, y}: x — радиус
  const pts=L.pts.map(p=>({x:Math.max(p.r,0.01), y:p.y}));
  const geo=buildLathe(pts, state.segments||72);
  const n=geo.attributes.position.count;
  geo.setAttribute('aCoat', new THREE.BufferAttribute(new Float32Array(n).fill(1),1));
  lidMesh.geometry.dispose();
  lidMesh.geometry=geo;
  lidMesh.material=potMesh.material;
  lidMesh.visible=true;
  lidGroup.scale.copy(potMesh.scale);
}

function rebuildParts(state){
  // слив живёт в корпусе (см. applyLips), отдельного тела у него нет
  const parts=(!previewPath && !previewGeo && state.stage>=5) ? (state.parts||[]).filter(p=>p.kind!=='lip') : [];
  while(partsGroup.children.length>parts.length){
    const m=partsGroup.children.pop();
    m.geometry.dispose();
    partsGroup.remove(m);
  }
  if(!parts.length) return;
  const prof=userProfileMM(state);
  const grow=Math.min(1,Math.max(0.06,(state.stage-5)/0.55));
  parts.forEach((p,i)=>{
    let mesh=partsGroup.children[i];
    if(!mesh){
      mesh=new THREE.Mesh(new THREE.BufferGeometry(),potMesh.material);
      mesh.castShadow=mesh.receiveShadow=true;
      partsGroup.add(mesh);
    }
    const full=partCurve(prof,p);
    const curve=grow>=0.999 ? full
      : new THREE.CatmullRomCurve3(full.getPoints(40).slice(0,Math.max(2,Math.round(40*grow))));
    const geo=sweepGeometry(curve, partSection(p), 48, 14);
    const n=geo.attributes.position.count;
    geo.setAttribute('aCoat', new THREE.BufferAttribute(new Float32Array(n).fill(1),1));
    mesh.geometry.dispose();
    mesh.geometry=geo;
    mesh.material=potMesh.material;
    mesh.rotation.y=-(p.az||0)*Math.PI/180;
    mesh.visible=true;
  });
  partsGroup.scale.copy(potMesh.scale);
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
    /* Раскладка кнопок — общая для обоих режимов: левая вращает, правая тоже.
       В режиме лепки левую забирает форма (контролы выключаются целиком),
       а правая остаётся камерой — так пальцу и мыши достаётся по способу. */
    controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE, MIDDLE:THREE.MOUSE.DOLLY,
                           RIGHT:THREE.MOUSE.ROTATE};
    controls.maxPolarAngle=Math.PI*.58;

    const dir=new THREE.DirectionalLight(0xffe4c4,2.6);
    keyLight=dir;
    dir.position.set(300,420,240);
    dir.castShadow=true;
    dir.shadow.mapSize.set(coarse?1024:2048,coarse?1024:2048);
    Object.assign(dir.shadow.camera,{left:-600,right:600,top:600,bottom:-600,far:1600});
    dir.shadow.bias=-0.0004;
    scene.add(dir);
    hemi=new THREE.HemisphereLight(0xbfa98f,0x241a12,.5);
    scene.add(hemi);

    groundMat=new THREE.ShadowMaterial({opacity:.38});
    const ground=new THREE.Mesh(new THREE.CircleGeometry(1200,48),groundMat);
    groundMesh=ground;
    ground.rotation.x=-Math.PI/2;ground.position.y=-15.6;ground.receiveShadow=true;
    scene.add(ground);

    dome=createDome();
    scene.add(dome);
    grid=new THREE.GridHelper(2400,48,0x000000,0x000000);
    grid.position.y=-15.4;
    grid.visible=false;
    scene.add(grid);

    baseMat=new THREE.MeshStandardMaterial({color:0x241d18,roughness:.7,metalness:.35});
    const base=new THREE.Mesh(new THREE.CylinderGeometry(18,68,46,40),baseMat);
    baseMesh=base;
    base.position.y=-38;base.receiveShadow=true;scene.add(base);

    wheelGroup=new THREE.Group();scene.add(wheelGroup);
    shaftMat=new THREE.MeshStandardMaterial({color:0x3a322b,roughness:.5,metalness:.7});
    const shaft=new THREE.Mesh(new THREE.CylinderGeometry(12,12,44,24),shaftMat);
    shaftMesh=shaft;
    shaft.position.y=-37;wheelGroup.add(shaft);

    platenMat=new THREE.MeshStandardMaterial({color:0x332a23,roughness:.62,metalness:.25});

    clayMat=new THREE.MeshStandardMaterial({color:MATERIALS[0].colors.raw,roughness:.92,side:THREE.DoubleSide});
    glazeMat=createGlazeMaterial();
    potMesh=new THREE.Mesh(new THREE.BufferGeometry(),clayMat);
    potMesh.castShadow=potMesh.receiveShadow=true;
    wheelGroup.add(potMesh);

    partsGroup=new THREE.Group();
    wheelGroup.add(partsGroup);

    /* Крышка живёт в своей группе, а не среди прилепов: rebuildParts подрезает
       partsGroup по числу прилепов и вместе с лишним мешем выбросил бы её. */
    lidGroup=new THREE.Group();
    wheelGroup.add(lidGroup);

    strainMesh=new THREE.Mesh(new THREE.BufferGeometry(),clayMat);
    strainMesh.castShadow=strainMesh.receiveShadow=true;
    strainMesh.visible=false;
    wheelGroup.add(strainMesh);
  },

  /* Сцена живёт по ту же сторону переключателя тем, что и вёрстка: на светлой
     теме круг и тень другие, иначе посреди светлой страницы висит чёрная дыра. */
  /* Сцена и вёрстка живут по одну сторону переключателя: и тема, и окружение
     меняют одни и те же материалы, поэтому применяются вместе. */
  applyTheme(t){ themeNow=t; applyEnv(); },
  setEnvironment(id){ envId=id; applyEnv(); },
  environment:()=>envId,

  /* Приблизить или отдалить кнопкой: колесо мыши есть не у всех, а на ноутбуке
     тачпадом попасть в нужный масштаб трудно. k>1 — ближе. */
  zoomBy(k){
    const dir=new THREE.Vector3().subVectors(camera.position,controls.target);
    const d=Math.min(Math.max(dir.length()/k,controls.minDistance),controls.maxDistance);
    camera.position.copy(controls.target).addScaledVector(dir.normalize(),d);
    controls.update();
    camDirty=true;
  },
  /* Насколько модель заполняет кадр: 1.0 — вписана целиком. */
  zoomLevel(){
    const i=this.fitInfo();
    return i&&i.have>0 ? i.need/i.have : 1;
  },

  /* Показать в сцене оснастку (контур сечения) или вернуть изделие (null). */
  setPreviewPath(path){ previewPath=path&&path.length>2?path:null; if(previewPath) previewGeo=null; },
  /* Показать в сцене произвольную геометрию (полуформу прилепа) вместо изделия. */
  setPreviewMesh(geo){
    if(previewGeo && previewGeo!==geo) previewGeo.dispose();
    previewGeo=geo||null;
    if(previewGeo) previewPath=null;
  },
  previewActive:()=>!!previewPath||!!previewGeo,

  rebuild(state, str){
    const prev=potMesh.geometry;
    if(previewGeo){
      // готовую геометрию не пересобираем: показываем как есть
      if(prev!==previewGeo){ prev.dispose(); potMesh.geometry=previewGeo; }
      potMesh.material=clayMat;
      potMesh.scale.setScalar(1);
      potMesh.updateMatrix();
      lastProfile=[];
      strainMesh.visible=false;
      rebuildParts(state);
      rebuildLid(state);
      previewGeo.computeBoundingBox();
      lastBaseR=Math.max(60, previewGeo.boundingBox.max.x, -previewGeo.boundingBox.min.x);
      rebuildPlaten(lastBaseR);
      camDirty=true;
      renderer.shadowMap.needsUpdate=true;
      keepInView();
      return {tris: previewGeo.attributes.position.count/3};
    }
    const built=previewPath?buildFromPath(previewPath,state):buildPot(state,prev);
    lastProfile=built.path.map(p=>({r:p.x,y:p.y}));
    if(state.heatmap && !previewPath) applyHeatmap(built.geometry, built.path, str||computeStrength(state));
    // толщину плёнки считаем только когда её видно: на сырой глине это лишняя работа
    lastCoat=(!previewPath && state.firing==='glaze' && !state.heatmap)
      ? applyCoat(built.geometry, built.path, state) : lastCoat;
    if(built.geometry!==prev){ prev.dispose(); potMesh.geometry=built.geometry; }
    potMesh.scale.setScalar(built.scale);
    potMesh.updateMatrix();
    lastBaseR=built.baseR;
    // стенка с отверстиями кладётся на место вырезанного куска тела
    const sg=(!previewPath && built.strainers && built.strainers.length)
      ? strainerGeometry(built.path, state.segments, built.strainers) : null;
    strainMesh.geometry.dispose();
    strainMesh.geometry=sg||new THREE.BufferGeometry();
    strainMesh.visible=!!sg;
    strainMesh.material=potMesh.material;
    strainMesh.scale.copy(potMesh.scale);
    if(sg){
      const n=sg.attributes.position.count;
      sg.setAttribute('aCoat', new THREE.BufferAttribute(new Float32Array(n).fill(1),1));
    }
    rebuildParts(state);
    rebuildLid(state);
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
    const glazed = state.firing==='glaze' && !state.heatmap && !previewPath && !previewGeo;
    potMesh.material = glazed ? glazeMat : clayMat;
    if(partsGroup) for(const m of partsGroup.children) m.material=potMesh.material;
    if(lidGroup) for(const m of lidGroup.children) m.material=potMesh.material;
    if(strainMesh) strainMesh.material=potMesh.material;
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

  /* ---------- лепка прямо на модели ----------
     Профиль правился только на чертеже: человек смотрел на вазу, а форму
     менял в соседнем окне и мысленно переносил одно в другое. Здесь три
     кирпича, из которых собирается прямое перетаскивание: попадание луча
     в стенку, кольцо-указатель на этой высоте и выключение орбиты, чтобы
     тяга формы не крутила камеру. */

  /** Куда попал луч из точки экрана: высота и радиус в миллиметрах рецепта. */
  pick(clientX, clientY){
    if(!potMesh || !potMesh.geometry.attributes.position) return null;
    const rect=renderer.domElement.getBoundingClientRect();
    const ndc=new THREE.Vector2(
      (clientX-rect.left)/rect.width*2-1,
      -((clientY-rect.top)/rect.height)*2+1);
    picker.setFromCamera(ndc,camera);
    const hits=picker.intersectObject(potMesh,false);
    if(!hits.length) return null;
    /* Локальные координаты меша — это и есть миллиметры рецепта: усадка
       сидит в масштабе меша, а поворот круга — в группе. */
    const local=potMesh.worldToLocal(hits[0].point.clone());
    return {y:local.y, r:Math.hypot(local.x,local.z), point:hits[0].point.clone()};
  },

  /**
   * Где курсор в плоскости силуэта: вертикальная плоскость через ось, повёрнутая
   * к камере. Тянуть форму по попаданию в стенку нельзя — стоит увести курсор
   * за край вазы, и попадать становится некуда, тяга замирает. Здесь же радиус
   * есть всегда, включая «наружу от силуэта».
   */
  pickSilhouette(clientX, clientY){
    if(!camera||!renderer) return null;
    const rect=renderer.domElement.getBoundingClientRect();
    const ndc=new THREE.Vector2(
      (clientX-rect.left)/rect.width*2-1,
      -((clientY-rect.top)/rect.height)*2+1);
    picker.setFromCamera(ndc,camera);
    /* Нормаль плоскости — направление на камеру в горизонтали, повёрнутое
       на 90°: сама плоскость проходит через ось вращения и смотрит на зрителя. */
    const dir=new THREE.Vector3().subVectors(camera.position,controls.target);
    dir.y=0;
    if(dir.lengthSq()<1e-6) dir.set(0,0,1);
    dir.normalize();
    const normal=new THREE.Vector3(-dir.z,0,dir.x);
    const plane=new THREE.Plane(normal,0);
    const hit=new THREE.Vector3();
    if(!picker.ray.intersectPlane(plane,hit)) return null;
    const sc=potMesh?(potMesh.scale.x||1):1;
    const along=hit.dot(dir);                 // положительная сторона — к зрителю
    return {r:Math.abs(along)/sc, y:hit.y/sc, side:along>=0?1:-1};
  },

  /** Кольцо на заданной высоте: показывает, какой уровень сейчас правят. */
  ring(y, r, on=true){
    if(!potMesh) return;
    if(!ringMesh){
      ringMesh=new THREE.Mesh(
        new THREE.TorusGeometry(1,0.5,8,96),
        new THREE.MeshBasicMaterial({transparent:true,opacity:.8,depthTest:false}));
      ringMesh.rotation.x=Math.PI/2;
      ringMesh.renderOrder=5;
      /* Кольцо живёт внутри самого меша: тогда усадка, поворот круга и любое
         будущее преобразование применяются к нему сами собой. Пока оно висело
         в группе круга, его приходилось умножать на масштаб вручную — и оно
         уезжало под потолок при первой же неточности. */
      potMesh.add(ringMesh);
    }
    ringMesh.visible=!!on;
    if(!on) return;
    const thick=Math.max(0.6,r*0.012);
    ringMesh.geometry.dispose();
    ringMesh.geometry=new THREE.TorusGeometry(Math.max(r,0.6),thick,8,96);
    ringMesh.position.y=y;
    ringMesh.material.color.set(accentColor());
  },

  /**
   * Режим лепки: у камеры забирается левая кнопка и один палец, всё остальное
   * ей остаётся. Выключать контролы целиком нельзя — на телефоне тогда вид
   * не покрутить и не приблизить вовсе, а лепят там теми же пальцами.
   */
  setSculpt(on){
    if(!controls) return;
    if(on){
      controls.mouseButtons={LEFT:null, MIDDLE:THREE.MOUSE.DOLLY, RIGHT:THREE.MOUSE.ROTATE};
      controls.touches={ONE:null, TWO:THREE.TOUCH.DOLLY_ROTATE};
    }else{
      controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE, MIDDLE:THREE.MOUSE.DOLLY,
                             RIGHT:THREE.MOUSE.ROTATE};
      controls.touches={ONE:THREE.TOUCH.ROTATE, TWO:THREE.TOUCH.DOLLY_PAN};
    }
  },
  orbitEnabled(){ return controls?controls.mouseButtons.LEFT!==null:false; },

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
  parts:()=>partsGroup,
  lid:()=>lidGroup,
  strainer:()=>strainMesh,
  renderer:()=>renderer,
  scene:()=>scene,
  camera:()=>camera,
  clayMaterial:()=>clayMat,
};
