// file: js/core/geometry.js
import * as THREE from 'three';
import { userProfileMM, radiusAt, N_SAMP } from './math.js';
import { byId } from '../config/materials.js';
import { clamp, smoothstep as smooth } from './util.js';
import { buildLathe, applyLips } from './lathe.js';
import { strainerSpec } from './strainer.js';
import { sanitizePattern, patternOn, patternFn, patternFade } from './pattern.js';

const R01=Array.from({length:N_SAMP+1},(_,i)=>i/N_SAMP);

/* ключевые профили этапов «Кинотеатра процесса» */
function keySamples(state,k,up){
  const H=state.H, R=state.D/2;
  switch(k){
    case 0: return R01.map(u=>({r:R*1.12*Math.pow(Math.cos(u*Math.PI/2),0.85), y:u*Math.min(R*0.95,H*0.35)}));
    case 1: return R01.map(u=>({r:R*0.52*(1-0.55*u)+R*0.06*Math.sin(u*Math.PI), y:u*H*1.15}));
    case 2: return R01.map(u=>({r:R*0.5+0.012*u*R, y:u*H*0.72}));
    case 3: return R01.map(u=>({r:R*0.54, y:u*H*0.9}));
    default: return up();
  }
}
export function stageProfile(state,u){
  const k=Math.floor(clamp(u,0,6)), f=smooth(clamp(u-k,0,1));
  let cached=null;
  const up=()=>cached||(cached=userProfileMM(state));   // ранним этапам он не нужен вовсе
  const a=keySamples(state,Math.min(k,6),up), b=keySamples(state,Math.min(k+1,6),up);
  if(a===b) return a.map(p=>({r:p.r,y:p.y}));           // на готовом изделии смешивать нечего
  return a.map((p,i)=>({r:p.r+(b[i].r-p.r)*f, y:p.y+(b[i].y-p.y)*f}));
}

/* Контур сечения: снизу вверх снаружи, затем сверху вниз изнутри.
   Полость и подрезка ножки не включаются рывком, а растут: `deep` — глубина
   вскрытия, `open` — ширина полости, `cut` — насколько подрезана ножка.
   Внутренняя стенка берётся своей равномерной выборкой, а не точками наружного
   профиля: так число точек контура не пляшет от кадра к кадру и тело вращения
   пересобирается в уже выделенных буферах. */
function buildPath(state,out,{t,open,deep,cut}){
  const H=out[out.length-1].y;
  const P=[];
  const V=(r,y)=>{ const v=new THREE.Vector2(Math.max(r,0.01),y); P.push(v); return v; };
  const br=out[0].r, fk=state.footK/100;
  // 0.15 мм остаётся всегда: нулевая ножка слепила бы точки в одну
  const fh=state.footH>0?state.footH*cut+0.15:0;

  V(0.01,0);
  if(fh>0){
    V(0.01,fh);
    V(Math.max(br*fk*0.85,0.5),fh);
    V(br*fk,fh*0.5);
    V(br,0.2);
  }
  /* Наружные точки помечаются: узор ложится только на них — полость остаётся
     гладкой, иначе вещь нечем мыть, а вместимость пришлось бы считать заново. */
  for(const o of out) V(o.r,o.y).outer=true;

  const fhFinal=state.footH>0?state.footH+1.5:0;   // дно считаем по готовой ножке
  const floorFinal=Math.min(Math.max(t,fhFinal),H*.6);
  if(state.hollow && deep>0.02){
    const floorNow=H-(H-floorFinal)*deep;
    const M=out.length;
    for(let k=0;k<=M;k++){
      const y=H-(H-floorNow)*(k/M);
      V((radiusAt(out,y)-t)*open, y);
    }
    V(0.01,floorNow);
  }else{
    V(0.01,H);
  }

  const clean=[P[0]];
  for(let i=1;i<P.length;i++) if(P[i].distanceTo(P[i-1])>0.01) clean.push(P[i]);
  return clean;
}

/* собирает геометрию для текущего этапа; возвращает {path, geometry, scale, baseR}.
   `reuse` — геометрия прошлой сборки: при неизменной топологии буферы заполняются
   на месте, ничего не выделяется. */
export function buildPot(state, reuse){
  const u=state.stage;
  const prof=stageProfile(state,u);
  const baseR=prof[0].r;

  const amp=state.rings;
  if(amp>0){
    const Hh=prof[prof.length-1].y;
    for(const o of prof){
      const fade=clamp(Math.min(o.y,Hh-o.y)/7,0,1);
      o.r=Math.max(0.12,o.r+amp*fade*Math.sin(o.y*Math.PI*2/4.2+0.5));
    }
  }

  // вскрытие: сначала палец идёт вглубь, потом полость расходится вширь.
  // Раньше здесь стоял порог u>=2 — полость появлялась целиком за один кадр.
  const deep=state.hollow?smooth(clamp((u-2)/0.85,0,1)):0;
  const open=state.hollow?smooth(clamp((u-2.05)/1.05,0,1)):0;
  const cut=smooth(clamp(u-5,0,1));
  const t=state.wall*(1+1.4*clamp((4-u)/2,0,1));

  const path=buildPath(state,prof,{t,open,deep,cut});

  /* Отверстия под носики режут по кожетвёрдому — то есть тогда же, когда
     прилепляют сам носик. Раньше этапа подрезки стенка ещё сырая и глухая. */
  const specs=(state.stage>=5 && state.hollow && t>0)
    ? (state.parts||[]).filter(p=>p.kind==='spout')
        .map(p=>strainerSpec(prof,path,state.segments,p,state.wall)).filter(Boolean)
    : [];
  const skip=specs.flatMap(sp=>[
    {i0:sp.box.i0, i1:sp.box.i1, j0:sp.box.jOut0, j1:sp.box.jOut1},
    {i0:sp.box.i0, i1:sp.box.i1, j0:sp.box.jIn0,  j1:sp.box.jIn1},
  ]);
  /* Узор — часть формы, а не картинка поверх: тот же рельеф уходит в STL
     и в G-code. На ранних этапах «Кинотеатра» его ещё нет — узор появляется
     вместе с готовой стенкой, как и в жизни (его печатает машина). */
  const pat=sanitizePattern(state.pattern);
  const patOn=patternOn(pat) && u>=3.5;
  const Htop=prof[prof.length-1].y;
  const grow=clamp((u-3.5)/1.2,0,1);
  /* Всё, что не зависит от угла, считается один раз по точкам контура: доля
     высоты и гашение. В цикле сборки остаётся только сама форма рельефа —
     иначе на четырнадцати тысячах вершин «Кинотеатр» начинает спотыкаться.
     Значения лежат в массивах по индексу точки: поиск в WeakMap на каждую
     вершину стоил дороже самой формулы. */
  const pf=patOn?patternFn(pat):null;
  let warp=null;
  if(pf){
    const vArr=new Float64Array(path.length), fArr=new Float64Array(path.length);
    for(let j=0;j<path.length;j++){
      if(!path[j].outer) continue;
      vArr[j]=Htop>0?Math.min(1,Math.max(0,path[j].y/Htop)):0;
      fArr[j]=patternFade(path[j].y,Htop)*grow;
    }
    warp=(phi,p,j)=>fArr[j]?pf(phi,vArr[j],fArr[j]):0;
  }
  const geometry=buildLathe(path,state.segments,reuse,skip,warp);
  // слив оттягивают на круге, пока изделие сырое — раньше, чем прилепляют ручки
  const lips=(state.parts||[]).filter(p=>p.kind==='lip');
  if(lips.length){
    const grow=smooth(clamp((u-4.2)/0.8,0,1));
    if(grow>0.001) applyLips(geometry, path.length, state.segments, lips, prof[prof.length-1].y, grow);
  }
  const shrink=byId(state.mat).shrinkPct;
  const scale=1-(u>5?smooth(u-5)*shrink/100:0);
  return {path, geometry, scale, baseR, strainers:specs};
}
