// file: js/ui/editor.js
// 2D-редактор профиля рецепта (этап «Формовка»).
import { state } from '../core/state.js';
import { sampleProfile } from '../core/math.js';
import { emit } from '../core/bus.js';

let ec, ectx, eW=0, eH=0, dpr=1, hoverIdx=-1, dragIdx=-1;
const PAD={l:26,r:14,t:14,b:14};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const eToPt=(px,py)=>({r:clamp((px-PAD.l)/(eW-PAD.l-PAD.r),0,1),t:clamp(1-(py-PAD.t)/(eH-PAD.t-PAD.b),0,1)});
const ptToE=p=>({x:PAD.l+p.r*(eW-PAD.l-PAD.r),y:PAD.t+(1-p.t)*(eH-PAD.t-PAD.b)});

export function drawEditor(){
  if(!eW||!ectx)return;
  ectx.setTransform(dpr,0,0,dpr,0,0);
  ectx.clearRect(0,0,eW,eH);
  ectx.strokeStyle='rgba(216,112,63,.07)';ectx.lineWidth=1;
  for(let g=1;g<4;g++){const x=PAD.l+g/4*(eW-PAD.l-PAD.r);ectx.beginPath();ectx.moveTo(x,PAD.t);ectx.lineTo(x,eH-PAD.b);ectx.stroke();}
  for(let g=1;g<5;g++){const y=PAD.t+g/5*(eH-PAD.t-PAD.b);ectx.beginPath();ectx.moveTo(PAD.l,y);ectx.lineTo(eW-PAD.r,y);ectx.stroke();}
  ectx.strokeStyle='rgba(232,147,95,.5)';ectx.setLineDash([4,4]);ectx.lineWidth=1.4;
  ectx.beginPath();ectx.moveTo(PAD.l,PAD.t-2);ectx.lineTo(PAD.l,eH-PAD.b+2);ectx.stroke();ectx.setLineDash([]);
  ectx.save();ectx.fillStyle='rgba(216,112,63,.55)';ectx.font='9px Manrope';
  ectx.translate(11,eH/2);ectx.rotate(-Math.PI/2);ectx.textAlign='center';
  ectx.fillText('ОСЬ ВРАЩЕНИЯ',0,0);ectx.restore();

  const sm=sampleProfile(state.points);
  const rw=eW-PAD.l-PAD.r,hh=eH-PAD.t-PAD.b;
  const right=sm.map(s=>({x:PAD.l+s.x*rw,y:PAD.t+(1-s.y)*hh}));
  const left=sm.map(s=>({x:PAD.l-s.x*rw*.92,y:PAD.t+(1-s.y)*hh}));
  ectx.beginPath();
  ectx.moveTo(left[left.length-1].x,left[left.length-1].y);
  for(const p of left)ectx.lineTo(p.x,p.y);
  for(const p of right)ectx.lineTo(p.x,p.y);
  ectx.closePath();
  ectx.fillStyle='rgba(216,112,63,.13)';ectx.fill();
  ectx.beginPath();left.forEach((p,i)=>i?ectx.lineTo(p.x,p.y):ectx.moveTo(p.x,p.y));
  ectx.strokeStyle='rgba(216,112,63,.3)';ectx.lineWidth=1.4;ectx.stroke();
  ectx.beginPath();right.forEach((p,i)=>i?ectx.lineTo(p.x,p.y):ectx.moveTo(p.x,p.y));
  ectx.strokeStyle='#e8935f';ectx.lineWidth=2.6;
  ectx.shadowColor='rgba(232,147,95,.6)';ectx.shadowBlur=8;ectx.stroke();ectx.shadowBlur=0;

  state.points.forEach((p,i)=>{
    const q=ptToE(p),end=(i===0||i===state.points.length-1);
    ectx.beginPath();ectx.arc(q.x,q.y,i===hoverIdx?8:6.5,0,Math.PI*2);
    ectx.fillStyle=end?'#f4e3d2':'#d8703f';ectx.fill();
    ectx.lineWidth=2;ectx.strokeStyle='#1b1410';ectx.stroke();
    if(i===hoverIdx){ectx.beginPath();ectx.arc(q.x,q.y,11,0,Math.PI*2);
      ectx.strokeStyle='rgba(232,147,95,.5)';ectx.lineWidth=1.4;ectx.stroke();}
  });
}

function resizeEditor(){
  const rect=ec.getBoundingClientRect();
  dpr=Math.min(devicePixelRatio,2);
  ec.width=rect.width*dpr;ec.height=rect.height*dpr;
  eW=rect.width;eH=rect.height;drawEditor();
}
function hitPoint(px,py){
  let best=-1,bd=14;
  state.points.forEach((p,i)=>{const q=ptToE(p);const d=Math.hypot(q.x-px,q.y-py);if(d<bd){bd=d;best=i;}});
  return best;
}

export function initEditor(canvas){
  ec=canvas;ectx=ec.getContext('2d');
  new ResizeObserver(resizeEditor).observe(ec);

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
    if(idx>=0){dragIdx=idx;ec.setPointerCapture(e.pointerId);}
  });
  ec.addEventListener('pointermove',e=>{
    const rect=ec.getBoundingClientRect();
    const px=e.clientX-rect.left,py=e.clientY-rect.top;
    if(dragIdx>=0){
      const p=state.points[dragIdx],c=eToPt(px,py);
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
  ec.addEventListener('dblclick',e=>{
    const rect=ec.getBoundingClientRect();
    const c=eToPt(e.clientX-rect.left,e.clientY-rect.top);
    if(c.t<=.02||c.t>=.98)return;
    state.points.push({t:c.t,r:c.r});
    state.points.sort((a,b)=>a.t-b.t);
    state.activePreset=-1;emit();
  });
}
