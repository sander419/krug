// file: js/ui/glazeLab.js
import { state } from '../core/state.js';
import { onChange } from '../core/bus.js';
import { evaluateGlaze } from '../core/glaze.js';
import { CLAYS } from '../config/data.js';
import { hookSlider } from './panels.js';

const $=id=>document.getElementById(id);
let stull, sctx, R={};

function drawStull(){
  if(!stull||!sctx)return;
  const rect=stull.getBoundingClientRect();
  const w=rect.width,h=rect.height;
  if(w<60||h<60)return;              // панель ещё не разложена — рисовать нечего
  const dp=Math.min(devicePixelRatio,2);
  stull.width=w*dp;stull.height=h*dp;
  sctx.setTransform(dp,0,0,dp,0,0);
  const X=al=>14+(al-0.1)/(0.6-0.1)*(w-28);
  const Y=si=>h-16-(si-1.5)/(7-1.5)*(h-32);
  sctx.clearRect(0,0,w,h);
  sctx.strokeStyle='rgba(216,112,63,.12)';
  for(let al=0.2;al<=0.6;al+=0.1){sctx.beginPath();sctx.moveTo(X(al),12);sctx.lineTo(X(al),h-14);sctx.stroke();}
  for(let si=2;si<=7;si+=1){sctx.beginPath();sctx.moveTo(12,Y(si));sctx.lineTo(w-12,Y(si));sctx.stroke();}
  const blob=(al,si,rx,ry,col)=>{
    const RX=Math.max(0,rx/0.5*(w-28)/2), RY=Math.max(0,ry/5.5*(h-32)/2);
    sctx.beginPath();
    sctx.ellipse(X(al),Y(si),RX,RY,0,0,Math.PI*2);
    sctx.fillStyle=col;sctx.fill();
  };
  blob(0.16,2.1,0.13,1.1,'rgba(217,92,74,.22)');
  blob(0.45,3.4,0.16,1.5,'rgba(224,166,63,.24)');
  blob(0.36,4.7,0.16,1.3,'rgba(216,160,90,.14)');
  blob(0.26,5.7,0.2,1.7,'rgba(143,181,115,.26)');
  sctx.fillStyle='rgba(241,231,218,.55)';sctx.font='9px Manrope';
  sctx.fillText('недоплав',X(0.16)-18,Y(2.1));
  sctx.fillText('мат',X(0.45)-9,Y(3.4));
  sctx.fillText('сатин',X(0.36)-13,Y(4.7));
  sctx.fillText('глянец',X(0.26)-14,Y(5.9));
  sctx.fillStyle='rgba(216,112,63,.7)';
  sctx.fillText('Al₂O₃ →',w-52,h-4);
  sctx.save();sctx.translate(8,46);sctx.rotate(-Math.PI/2);sctx.fillText('SiO₂ →',0,0);sctx.restore();
  const gx=X(state.glaze.al),gy=Y(state.glaze.si);
  sctx.strokeStyle='#f1e7da';sctx.lineWidth=1.2;
  sctx.beginPath();sctx.moveTo(gx-9,gy);sctx.lineTo(gx+9,gy);sctx.moveTo(gx,gy-9);sctx.lineTo(gx,gy+9);sctx.stroke();
  sctx.beginPath();sctx.arc(gx,gy,5.5,0,Math.PI*2);
  sctx.strokeStyle='#e8935f';sctx.lineWidth=2;sctx.stroke();
}

export function updateGlaze(){
  const g=state.glaze, body=CLAYS[state.clay];
  const ev=evaluateGlaze(g, body.cte);
  $('glazeVerdict').innerHTML=
    `<div>UMF: флюсы <b>1.0</b> · Al₂O₃ <b>${g.al.toFixed(2)}</b> · SiO₂ <b>${g.si.toFixed(2)}</b> · Si:Al <b>${ev.ratio.toFixed(1)}</b></div>`+
    `<div>Поверхность (конус 6): <span class="${ev.surface.c}">${ev.surface.t}</span></div>`+
    `<div>CTE глазури ≈ <b>${ev.cte.toFixed(1)}</b> vs черепок <b>${body.cte.toFixed(1)}</b> ·10⁻⁶/°C</div>`+
    `<div><span class="${ev.fit.c}">${ev.fit.t}</span></div>`;
  drawStull();
}

export function initGlazeLab(){
  stull=$('stullCanvas');sctx=stull.getContext('2d');
  new ResizeObserver(drawStull).observe($('stullWrap'));
  onChange(updateGlaze);   // смена глины меняет CTE черепка — вердикт пересчитать
  R.al=hookSlider('alSl','alOut',v=>v.toFixed(2),v=>{state.glaze.al=v;updateGlaze();});
  R.si=hookSlider('siSl','siOut',v=>v.toFixed(2),v=>{state.glaze.si=v;updateGlaze();});
  R.ca=hookSlider('caSl','caOut',v=>Math.round(v*100)+'%',v=>{state.glaze.ca=v;updateGlaze();});
}
export function syncGlaze(){
  R.al.sync(state.glaze.al);
  R.si.sync(state.glaze.si);
  R.ca.sync(state.glaze.ca);
}
