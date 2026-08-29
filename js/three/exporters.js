// file: js/three/exporters.js
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { sceneAPI } from './scene.js';
import { buildPot } from '../core/geometry.js';
import { partCurve, partSection } from '../core/parts.js';
import { sweepGeometry } from './sweep.js';
import { strainerGeometry } from './strainerMesh.js';
import { userProfileMM } from '../core/math.js';
import { download, fileName } from '../core/files.js';

/* Сшивка индексированных геометрий в одну. Своя, потому что вся сборка держится
   на вшитом three без дополнительных модулей, а выгружать корпус без ручки нельзя:
   файл должен описывать то же изделие, что и масса на экране. */
function mergeGeo(list){
  let vTotal=0, iTotal=0;
  for(const g of list){ vTotal+=g.attributes.position.count; iTotal+=g.index?g.index.count:0; }
  const pos=new Float32Array(vTotal*3), nor=new Float32Array(vTotal*3);
  const idx=vTotal>65535?new Uint32Array(iTotal):new Uint16Array(iTotal);
  let vo=0, io=0;
  for(const g of list){
    const p=g.attributes.position.array, n=g.attributes.normal.array, ix=g.index.array;
    pos.set(p, vo*3); nor.set(n, vo*3);
    for(let k=0;k<ix.length;k++) idx[io+k]=ix[k]+vo;
    vo+=g.attributes.position.count; io+=ix.length;
  }
  const out=new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos,3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor,3));
  out.setIndex(new THREE.BufferAttribute(idx,1));
  return out;
}

/* Прилепы к выгрузке: каждый повёрнут на свой азимут, как в сцене. */
function partsGeo(state){
  const list=(state.parts||[]).filter(p=>p.kind!=='lip');   // слив уже в корпусе
  if(!list.length) return [];
  const prof=userProfileMM(state);
  return list.map(p=>{
    const g=sweepGeometry(partCurve(prof,p), partSection(p), 48, 14);
    g.rotateY(-(p.az||0)*Math.PI/180);
    return g;
  });
}

/* Фабрикационные форматы: готовая форма в сыром размере —
   то, что реально печатается и что совпадает с G-code. Усадка обжига
   и кадр «Кинотеатра» в экспорт не попадают. */
function fabricationGeo(state){
  const saved=state.stage;
  state.stage=6;
  const built=buildPot(state);
  state.stage=saved;
  const pg=partsGeo(state);
  // стенка с ситечком: тело отдало этот кусок, и без него в файле осталась бы дыра
  const sg=(built.strainers&&built.strainers.length)
    ? strainerGeometry(built.path, state.segments, built.strainers) : null;
  if(sg) pg.push(sg);
  if(!pg.length) return built.geometry.clone();
  const merged=mergeGeo([built.geometry, ...pg]);
  for(const g of pg) g.dispose();
  return merged;
}

function exportGeo(){
  const m=sceneAPI.pot();
  m.updateMatrix();
  const parts=[m.geometry.clone().applyMatrix4(m.matrix)];   // усадка обжига запечена
  const st=sceneAPI.strainer();
  if(st && st.visible){
    st.updateMatrix();
    parts.push(st.geometry.clone().applyMatrix4(st.matrix));
  }
  const grp=sceneAPI.parts();
  if(grp){
    grp.updateMatrixWorld(true);
    for(const c of grp.children){
      if(!c.visible) continue;
      parts.push(c.geometry.clone().applyMatrix4(c.matrixWorld));
    }
  }
  if(parts.length===1) return parts[0];
  const merged=mergeGeo(parts);
  for(const p of parts) p.dispose();
  return merged;
}

/* Двоичный STL из любой геометрии — общий для изделия и для оснастки. */
function stlBlob(geometry){
  const g=geometry.index?geometry.toNonIndexed():geometry;
  const pos=g.attributes.position,n=pos.count/3;
  const buf=new ArrayBuffer(84+n*50),dv=new DataView(buf);
  dv.setUint32(80,n,true);
  const va=new THREE.Vector3(),vb=new THREE.Vector3(),vc=new THREE.Vector3(),
        ab=new THREE.Vector3(),ac=new THREE.Vector3(),nn=new THREE.Vector3();
  let off=84;
  for(let i=0;i<n;i++){
    va.fromBufferAttribute(pos,i*3);vb.fromBufferAttribute(pos,i*3+1);vc.fromBufferAttribute(pos,i*3+2);
    ab.subVectors(vb,va);ac.subVectors(vc,va);nn.crossVectors(ab,ac).normalize();
    dv.setFloat32(off,nn.x,true);dv.setFloat32(off+4,nn.y,true);dv.setFloat32(off+8,nn.z,true);off+=12;
    for(const v of[va,vb,vc]){dv.setFloat32(off,v.x,true);dv.setFloat32(off+4,v.y,true);dv.setFloat32(off+8,v.z,true);off+=12;}
    dv.setUint16(off,0,true);off+=2;
  }
  if(g!==geometry) g.dispose();
  return new Blob([buf],{type:'model/stl'});
}

export function exportSTL(state){
  const geo=fabricationGeo(state);
  download(stlBlob(geo), fileName(state,'stl'));
  geo.dispose();
}

/* Полуформа прилепа: готовая геометрия -> STL. */
export function exportGeoSTL(state, geometry, suffix){
  download(stlBlob(geometry), fileName(state, suffix+'.stl'));
}

/* Оснастка: контур сечения -> тело вращения -> STL. */
export function exportPathSTL(state, path, suffix){
  const pts=path.map(p=>new THREE.Vector2(Math.max(p.r,0.01),p.y));
  const geo=new THREE.LatheGeometry(pts, Math.max(state.segments,48));
  download(stlBlob(geo), fileName(state, suffix+'.stl'));
  geo.dispose();
}

export function exportOBJ(state){
  const g=fabricationGeo(state),pos=g.attributes.position,nor=g.attributes.normal,idx=g.index;
  let s=`# КРУГ — производственный симулятор гончарных форм\n# units mm, сырой размер (до обжига)\no ${(state.name||'pot').replace(/\s/g,'_')}\n`;
  for(let i=0;i<pos.count;i++)s+=`v ${pos.getX(i).toFixed(3)} ${pos.getY(i).toFixed(3)} ${pos.getZ(i).toFixed(3)}\n`;
  for(let i=0;i<nor.count;i++)s+=`vn ${nor.getX(i).toFixed(3)} ${nor.getY(i).toFixed(3)} ${nor.getZ(i).toFixed(3)}\n`;
  for(let i=0;i<idx.count;i+=3){
    const a=idx.getX(i)+1,b=idx.getX(i+1)+1,c=idx.getX(i+2)+1;
    s+=`f ${a}//${a} ${b}//${b} ${c}//${c}\n`;
  }
  g.dispose();
  download(new Blob([s],{type:'text/plain'}), fileName(state,'obj'));
}

export function exportGLB(state, done, err){
  const tmp=new THREE.Mesh(exportGeo(), sceneAPI.clayMaterial());
  new GLTFExporter().parse(tmp, res=>{
    tmp.geometry.dispose();
    download(new Blob([res],{type:'model/gltf-binary'}), fileName(state,'glb'));
    done && done();
  }, ()=>{ err && err(); }, {binary:true});
}

export function snapshot(state, done){
  const r=sceneAPI.renderer();
  r.render(sceneAPI.scene(), sceneAPI.camera());
  r.domElement.toBlob(b=>{
    if(b){ download(b, fileName(state,'png')); done && done(); }
  });
}
