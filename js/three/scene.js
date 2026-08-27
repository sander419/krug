// file: js/three/scene.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPot } from '../core/geometry.js';
import { computeStrength } from '../core/math.js';
import { CLAYS } from '../config/data.js';

let container, renderer, scene, camera, controls, wheelGroup, potMesh, clayMat, platen;
let platenMat, lastPlatenR=0;

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

    clayMat=new THREE.MeshStandardMaterial({color:CLAYS[0].raw,roughness:.92,side:THREE.DoubleSide});
    potMesh=new THREE.Mesh(new THREE.BufferGeometry(),clayMat);
    potMesh.castShadow=potMesh.receiveShadow=true;
    wheelGroup.add(potMesh);
  },

  rebuild(state, str){
    const built=buildPot(state);
    if(state.heatmap) applyHeatmap(built.geometry, built.path, str||computeStrength(state));
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
    if(state.heatmap){
      clayMat.color.set(0xffffff);clayMat.roughness=.6;clayMat.metalness=0;return;
    }
    const c=CLAYS[state.clay], m=state.firing;
    clayMat.color.setHex(m==='raw'?c.raw:m==='bisque'?c.bisque:c.glaze);
    clayMat.roughness=m==='raw'?.92:m==='bisque'?.88:.25;
    clayMat.metalness=m==='glaze'?.05:0;
  },

  frameView(state){
    const H=state.H, D=Math.max(state.D,60);
    const a=camera.aspect||1;
    const k=a<1.1?1.1/Math.max(a,0.4):1;      // узкий экран — отъехать, иначе изделие не влезает
    const dist=(Math.max(H,D)*1.5+140)*k;
    camera.position.set(dist*.62,H*.62+60,dist*.86);
    controls.target.set(0,H*.45,0);
    controls.update();
  },

  resize(){
    const w=container.clientWidth,h=container.clientHeight;
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
