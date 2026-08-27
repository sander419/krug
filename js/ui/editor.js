// file: js/ui/editor.js
// Чертёж профиля рядом с моделью, в том же экранном масштабе: сколько пикселей
// приходится на миллиметр в 3D-виде, столько же и здесь. Правая половина сечения:
// ось вращения слева, изделие растёт вправо — к модели.
import { state } from '../core/state.js';
import { sampleProfile, userProfileMM, floorY } from '../core/math.js';
import { stageProfile } from '../core/geometry.js';
import { byId } from '../config/materials.js';
import { sceneAPI } from '../three/scene.js';
import { emit } from '../core/bus.js';
import { clamp } from '../core/util.js';
import { $ } from './dom.js';

let ec, ectx, eW=0, eH=0, dpr=1, hoverIdx=-1, dragIdx=-1;
let mode='1:1';                 // '1:1' | 'fit'
let modeChosen=false;
let view={pxPerMM:1, baseY:0, axisX:34};
let lastKey='';

const PAD={l:34, r:16, t:18, b:26};

/* насколько канва чертежа ниже верха 3D-вида */
function vOffset(){
  const vp=$('viewport');
  if(!vp||!ec) return 0;
  return ec.getBoundingClientRect().top - vp.getBoundingClientRect().top;
}

/* ---------- масштаб и система координат ---------- */
function computeView(){
  const fitScale=()=>{
    const usableH=eH-PAD.t-PAD.b, usableW=eW-PAD.l-PAD.r;
    return Math.max(0.05, Math.min(usableH/Math.max(state.H,1), usableW/Math.max(state.D/2,1)));
  };
  if(mode==='fit'){
    const s=fitScale();
    return {pxPerMM:s, baseY:eH-PAD.b, axisX:PAD.l, fits:true};
  }
  const sc=sceneAPI.screenScale(state);
  if(!sc || !sc.ok){
    const s=fitScale();
    return {pxPerMM:s, baseY:eH-PAD.b, axisX:PAD.l, fits:true};
  }
  const baseY=sc.baseY-vOffset();     // 3D-вид и канва начинаются на разной высоте
  const fits = state.H*sc.pxPerMM <= (baseY-PAD.t) && state.D/2*sc.pxPerMM <= (eW-PAD.l-PAD.r);
  return {pxPerMM:sc.pxPerMM, baseY, axisX:PAD.l, fits};
}

/* нормированная точка рецепта -> экран, и обратно */
function maxNorm(){
  const sm=sampleProfile(state.points);
  return Math.max(1e-6,...sm.map(s=>s.x));
}
const mmPerNorm=()=>state.D/2/maxNorm();      // во сколько мм превращается единица r
function ptToPx(p){
  return {x:view.axisX+p.r*mmPerNorm()*view.pxPerMM, y:view.baseY-p.t*state.H*view.pxPerMM};
}
function pxToPt(x,y){
  const rmm=(x-view.axisX)/view.pxPerMM;
  const ymm=(view.baseY-y)/view.pxPerMM;
  return {r:clamp(rmm/mmPerNorm(),0,1), t:clamp(ymm/state.H,0,1)};
}
const mmToPx=(r,y)=>({x:view.axisX+r*view.pxPerMM, y:view.baseY-y*view.pxPerMM});

/* ---------- отрисовка ---------- */
function gridStep(){
  const cand=[1,2,5,10,20,50,100];
  for(const c of cand) if(c*view.pxPerMM>=14) return c;
  return 100;
}

export function drawEditor(){
  if(!eW||!ectx)return;
  view=computeView();
  ectx.setTransform(dpr,0,0,dpr,0,0);
  ectx.clearRect(0,0,eW,eH);

  const step=gridStep(), px=view.pxPerMM;
  const topY=Math.max(PAD.t, view.baseY-state.H*px-24);

  /* сетка в миллиметрах */
  ectx.strokeStyle='rgba(216,112,63,.08)';ectx.lineWidth=1;
  for(let mm=step; mm*px<eW-view.axisX+40; mm+=step){
    const x=view.axisX+mm*px;
    if(x>eW-2)break;
    ectx.beginPath();ectx.moveTo(x,topY);ectx.lineTo(x,view.baseY);ectx.stroke();
  }
  for(let mm=step; view.baseY-mm*px>topY; mm+=step){
    const y=view.baseY-mm*px;
    ectx.beginPath();ectx.moveTo(view.axisX,y);ectx.lineTo(eW-4,y);ectx.stroke();
  }

  /* планшайба и ось вращения */
  ectx.strokeStyle='rgba(232,147,95,.55)';ectx.lineWidth=1.5;
  ectx.beginPath();ectx.moveTo(view.axisX-14,view.baseY);ectx.lineTo(eW-6,view.baseY);ectx.stroke();
  ectx.setLineDash([5,4]);ectx.lineWidth=1.3;ectx.strokeStyle='rgba(232,147,95,.45)';
  ectx.beginPath();ectx.moveTo(view.axisX,view.baseY+8);ectx.lineTo(view.axisX,topY);ectx.stroke();
  ectx.setLineDash([]);

  ectx.save();ectx.fillStyle='rgba(216,112,63,.6)';ectx.font='9px Manrope, system-ui, sans-serif';
  ectx.translate(view.axisX-12,(view.baseY+topY)/2);ectx.rotate(-Math.PI/2);ectx.textAlign='center';
  ectx.fillText('ОСЬ ВРАЩЕНИЯ',0,0);ectx.restore();

  /* призрак текущего этапа «Кинотеатра» с учётом усадки */
  if(state.stage<5.98){
    const prof=stageProfile(state,state.stage);
    const shrink=state.stage>5?1-(state.stage-5)*byId(state.mat).shrinkPct/100:1;
    ectx.beginPath();
    prof.forEach((o,i)=>{const q=mmToPx(o.r*shrink,o.y*shrink);i?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y);});
    ectx.strokeStyle='rgba(241,231,218,.28)';ectx.lineWidth=1.4;ectx.setLineDash([3,3]);ectx.stroke();ectx.setLineDash([]);
  }

  /* тело изделия: наружный контур + внутренняя стенка */
  const out=userProfileMM(state);
  const outer=out.map(o=>mmToPx(o.r,o.y));
  ectx.beginPath();
  ectx.moveTo(view.axisX,view.baseY);
  for(const q of outer)ectx.lineTo(q.x,q.y);
  ectx.lineTo(view.axisX,outer[outer.length-1].y);
  ectx.closePath();
  ectx.fillStyle='rgba(216,112,63,.14)';ectx.fill();

  if(state.hollow){
    const floor=floorY(state);
    const inner=out.filter(o=>o.y>=floor).map(o=>mmToPx(Math.max(o.r-state.wall,0),o.y));
    if(inner.length>1){
      ectx.beginPath();
      inner.forEach((q,i)=>i?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y));
      ectx.strokeStyle='rgba(241,231,218,.42)';ectx.lineWidth=1.3;ectx.stroke();
      const f=mmToPx(0,floor), f2=mmToPx(Math.max(out[0].r-state.wall,0),floor);
      ectx.beginPath();ectx.moveTo(f.x,f.y);ectx.lineTo(f2.x,f2.y);ectx.stroke();
    }
  }
  ectx.beginPath();
  outer.forEach((q,i)=>i?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y));
  ectx.strokeStyle='#e8935f';ectx.lineWidth=2.4;
  ectx.shadowColor='rgba(232,147,95,.5)';ectx.shadowBlur=7;ectx.stroke();ectx.shadowBlur=0;

  /* размерные подписи */
  ectx.fillStyle='rgba(241,231,218,.6)';ectx.font='10px Manrope, system-ui, sans-serif';
  ectx.textAlign='left';
  ectx.fillText((state.H/10).toFixed(1)+' см', view.axisX+4, Math.max(topY+11, view.baseY-state.H*px-6));
  ectx.fillText('⌀ '+(state.D/10).toFixed(1)+' см', view.axisX+4, view.baseY+14);

  /* точки рецепта */
  state.points.forEach((p,i)=>{
    const q=ptToPx(p), end=(i===0||i===state.points.length-1);
    ectx.beginPath();ectx.arc(q.x,q.y,i===hoverIdx?8:6.5,0,Math.PI*2);
    ectx.fillStyle=end?'#f4e3d2':'#d8703f';ectx.fill();
    ectx.lineWidth=2;ectx.strokeStyle='#1b1410';ectx.stroke();
    if(i===hoverIdx){
      ectx.beginPath();ectx.arc(q.x,q.y,11,0,Math.PI*2);
      ectx.strokeStyle='rgba(232,147,95,.5)';ectx.lineWidth=1.4;ectx.stroke();
      const rmm=(p.r*mmPerNorm()).toFixed(1), ymm=(p.t*state.H).toFixed(0);
      ectx.fillStyle='rgba(241,231,218,.85)';ectx.font='10px Manrope, system-ui, sans-serif';
      ectx.fillText(`⌀${(rmm*2).toFixed(0)} · ${ymm} мм`, q.x+13, q.y-9);
    }
  });

  const badge=$('draftScale');
  if(badge) badge.textContent = mode==='fit' ? 'по размеру' :
    (view.fits ? '1:1 с моделью' : '1:1 · не помещается');
}

/* пересчёт при движении камеры: перерисовываем только когда масштаб реально изменился */
export function syncEditorScale(){
  if(mode!=='1:1'||!eW)return;
  const sc=sceneAPI.screenScale(state);
  if(!sc||!sc.ok)return;
  const key=sc.pxPerMM.toFixed(3)+'|'+sc.baseY.toFixed(1);
  if(key===lastKey)return;
  lastKey=key;
  drawEditor();
}

let resizePending=false;
function resizeEditor(){
  const rect=ec.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  dpr=Math.min(devicePixelRatio,2);
  ec.width=rect.width*dpr;ec.height=rect.height*dpr;
  eW=rect.width;eH=rect.height;
  lastKey='';
  if(!modeChosen){                     // на низкой панели 1:1 не поместится — стартуем вписанным
    modeChosen=true;
    const sc=sceneAPI.screenScale(state);
    if(sc&&sc.ok&&state.H*sc.pxPerMM>eH-PAD.t-PAD.b) mode='fit';
  }
  // рисуем в следующем кадре: перерисовка прямо в колбэке ResizeObserver
  // даёт «loop completed with undelivered notifications» в консоли
  if(resizePending)return;
  resizePending=true;
  setTimeout(()=>{resizePending=false;drawEditor();},0);
}
function hitPoint(px,py){
  let best=-1,bd=15;
  state.points.forEach((p,i)=>{const q=ptToPx(p);const d=Math.hypot(q.x-px,q.y-py);if(d<bd){bd=d;best=i;}});
  return best;
}

export function initEditor(canvas){
  ec=canvas;ectx=ec.getContext('2d');
  new ResizeObserver(resizeEditor).observe(ec);

  const toggle=$('draftScale');
  if(toggle) toggle.onclick=()=>{mode=mode==='1:1'?'fit':'1:1';modeChosen=true;lastKey='';drawEditor();};

  ec.addEventListener('contextmenu',e=>e.preventDefault());
  ec.addEventListener('pointerdown',e=>{
    const rect=ec.getBoundingClientRect();
    const px=e.clientX-rect.left,py=e.clientY-rect.top;
    const idx=hitPoint(px,py);
    if(e.button===2){
      if(idx>0&&idx<state.points.length-1){
        state.points.splice(idx,1);state.activePreset=-1;emit();
      }
      return;
    }
    if(idx>=0){dragIdx=idx;try{ec.setPointerCapture(e.pointerId);}catch(_){}}
  });
  ec.addEventListener('pointermove',e=>{
    const rect=ec.getBoundingClientRect();
    const px=e.clientX-rect.left,py=e.clientY-rect.top;
    if(dragIdx>=0){
      const p=state.points[dragIdx],c=pxToPt(px,py);
      p.r=c.r;
      if(dragIdx===0)p.t=0;
      else if(dragIdx===state.points.length-1)p.t=1;
      else p.t=clamp(c.t,state.points[dragIdx-1].t+.02,state.points[dragIdx+1].t-.02);
      state.activePreset=-1;emit();
    }else{
      const h=hitPoint(px,py);
      if(h!==hoverIdx){hoverIdx=h;drawEditor();}
      ec.style.cursor=h>=0?'grab':'crosshair';
    }
  });
  ec.addEventListener('pointerup',()=>dragIdx=-1);
  ec.addEventListener('pointercancel',()=>dragIdx=-1);
  ec.addEventListener('dblclick',e=>{
    const rect=ec.getBoundingClientRect();
    const c=pxToPt(e.clientX-rect.left,e.clientY-rect.top);
    if(c.t<=.02||c.t>=.98)return;
    state.points.push({t:c.t,r:c.r});
    state.points.sort((a,b)=>a.t-b.t);
    state.activePreset=-1;emit();
  });
}
