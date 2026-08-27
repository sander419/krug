// file: js/three/exporters.js
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { sceneAPI } from './scene.js';
import { download, fileName } from '../core/files.js';

function exportGeo(){
  const m=sceneAPI.pot();
  const g=m.geometry.clone();
  m.updateMatrix();
  g.applyMatrix4(m.matrix); // запекаем усадку обжига, без вращения круга
  return g;
}

export function exportSTL(state){
  const g=exportGeo().toNonIndexed();
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
  g.dispose();
  download(new Blob([buf],{type:'model/stl'}), fileName(state,'stl'));
}

export function exportOBJ(state){
  const g=exportGeo(),pos=g.attributes.position,nor=g.attributes.normal,idx=g.index;
  let s=`# КРУГ — производственный симулятор гончарных форм\n# units mm\no ${(state.name||'pot').replace(/\s/g,'_')}\n`;
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
