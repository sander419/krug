// file: js/core/geometry.js
import * as THREE from 'three';
import { userProfileMM, radiusAt, N_SAMP } from './math.js';
import { byId } from '../config/materials.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=f=>f*f*(3-2*f);
const R01=Array.from({length:N_SAMP+1},(_,i)=>i/N_SAMP);

/* ключевые профили этапов «Кинотеатра процесса» */
export function keySamples(state,k){
  const H=state.H, R=state.D/2, up=userProfileMM(state);
  switch(k){
    case 0: return R01.map(u=>({r:R*1.12*Math.pow(Math.cos(u*Math.PI/2),0.85), y:u*Math.min(R*0.95,H*0.35)}));
    case 1: return R01.map(u=>({r:R*0.52*(1-0.55*u)+R*0.06*Math.sin(u*Math.PI), y:u*H*1.15}));
    case 2: return R01.map(u=>({r:R*0.5+0.012*u*R, y:u*H*0.72}));
    case 3: return R01.map(u=>({r:R*0.54, y:u*H*0.9}));
    default: return up;
  }
}
export function stageProfile(state,u){
  const k=Math.floor(clamp(u,0,6)), f=smooth(clamp(u-k,0,1));
  const a=keySamples(state,Math.min(k,6)), b=keySamples(state,Math.min(k+1,6));
  return a.map((p,i)=>({r:p.r+(b[i].r-p.r)*f, y:p.y+(b[i].y-p.y)*f}));
}

export function buildPath(state,out,t,foot){
  const H=out[out.length-1].y;
  const path=[new THREE.Vector2(0.01,0)];
  if(foot && state.footH>0){
    const br=out[0].r, fk=state.footK/100, fh=state.footH;
    path.push(new THREE.Vector2(0.01,fh));
    path.push(new THREE.Vector2(Math.max(br*fk*0.85,0.5),fh));
    path.push(new THREE.Vector2(br*fk,fh*0.5));
    path.push(new THREE.Vector2(br,0.2));
  }
  for(const o of out) path.push(new THREE.Vector2(Math.max(o.r,0.12),o.y));
  if(t>0){
    const rimIn=Math.max(out[out.length-1].r-t,0.2);
    path.push(new THREE.Vector2(rimIn,H));
    const floor=Math.min(Math.max(t, foot&&state.footH>0?state.footH+1.5:0), H*.6);
    for(let i=out.length-1;i>=0;i--){
      const o=out[i];
      if(o.y<floor) break;
      path.push(new THREE.Vector2(Math.max(o.r-t,0.15),o.y));
    }
    const rf=Math.max(radiusAt(out,floor)-t,0.15);
    path.push(new THREE.Vector2(rf,floor));
    path.push(new THREE.Vector2(0.01,floor));
  } else {
    path.push(new THREE.Vector2(0.01,H));
  }
  const clean=[path[0]];
  for(let i=1;i<path.length;i++) if(path[i].distanceTo(path[i-1])>0.01) clean.push(path[i]);
  return clean;
}

/* собирает геометрию для текущего этапа; возвращает {path, geometry, scale, baseR} */
export function buildPot(state){
  const u=state.stage;
  const prof=stageProfile(state,u);
  const hollowNow=state.hollow && u>=2;
  const t=hollowNow?state.wall*(1+1.4*clamp((4-u)/2,0,1)):0;
  const foot=u>=5 && state.footH>0;
  const baseR=prof[0].r;

  const amp=state.rings;
  if(amp>0){
    const Hh=prof[prof.length-1].y;
    for(const o of prof){
      const fade=clamp(Math.min(o.y,Hh-o.y)/7,0,1);
      o.r=Math.max(0.12,o.r+amp*fade*Math.sin(o.y*Math.PI*2/4.2+0.5));
    }
  }

  const path=buildPath(state,prof,t,foot);
  const geometry=new THREE.LatheGeometry(path,state.segments);
  const shrink=byId(state.mat).shrinkPct;
  const scale=1-(u>5?smooth(u-5)*shrink/100:0);
  return {path, geometry, scale, baseR};
}
