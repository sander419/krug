// file: js/ui/editor.js
// Чертёж профиля рядом с моделью, в том же экранном масштабе: сколько пикселей
// приходится на миллиметр в 3D-виде, столько же и здесь. Правая половина сечения:
// ось вращения слева, изделие растёт вправо — к модели.
import { state } from '../core/state.js';
import { sampleProfile, userProfileMM, floorY, radiusAt } from '../core/math.js';
import { stageProfile } from '../core/geometry.js';
import { byId } from '../config/materials.js';
import { sceneAPI } from '../three/scene.js';
import { emit } from '../core/bus.js';
import { clamp, round } from '../core/util.js';
import { traceToRecipe } from '../core/trace.js';
import { $ } from './dom.js';
import { pal } from './palette.js';
import { partCurve, partSection, pathFromParams, pathFromStroke, pathPoints,
         syncFieldsFromPath } from '../core/parts.js';
import { selectedPart, syncParts } from './parts.js';
import { strainerHoles } from '../core/strainer.js';
import { kindOf, limitOf } from '../config/parts.js';
import { sanitizePattern, patternOn, patternOutline } from '../core/pattern.js';

let ec, ectx, eW=0, eH=0, dpr=1, hoverIdx=-1, dragIdx=-1;
let selIdx=-1;                  // выбранная точка: её правят числами и клавишами
let draftMode='points';         // 'points' — тянуть точки, 'draw' — вести линию
let stroke=null;                // экранная ломаная, пока её ведут
let partDrag=-1;                // индекс точки прилепа, которую тянут
let partHover=-1;
let drawTarget=null;            // 'body' | 'part' — выбрано человеком
let strokeTarget='body';        // цель штриха, зафиксированная в начале
let lastSelId=null;
let onReshape=null;             // панель обязана перечитать высоту и диаметр
let pressTimer=null, lastTap=0, lastTapPt=null;
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
/* Самая дальняя от оси точка: прилепы вылезают за габарит корпуса, и в режиме
   «по размеру» чертёж обязан вместить их тоже. */
function drawnRadiusMM(){
  let r=state.D/2;
  const parts=state.parts||[];
  if(parts.length){
    const out=userProfileMM(state);
    for(const p of parts){
      if(p.kind==='lip'){ r=Math.max(r, out[out.length-1].r+(p.out||0)); continue; }
      const sec=partSection(p);
      partCurve(out,p).getPoints(16).forEach((v,i)=>{ r=Math.max(r, v.x+sec.rAt(i/16)); });
    }
  }
  return r;
}

function computeView(){
  const fitScale=()=>{
    const usableH=eH-PAD.t-PAD.b, usableW=eW-PAD.l-PAD.r;
    return Math.max(0.05, Math.min(usableH/Math.max(state.H,1), usableW/Math.max(drawnRadiusMM(),1)));
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
  const fits = state.H*sc.pxPerMM <= (baseY-PAD.t) && drawnRadiusMM()*sc.pxPerMM <= (eW-PAD.l-PAD.r);
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
  // округляем здесь же: рецепт уезжает в ссылку, а лишние знаки её только удлиняют
  return {r:round(clamp(rmm/mmPerNorm(),0,1)), t:round(clamp(ymm/state.H,0,1))};
}
const mmToPx=(r,y)=>({x:view.axisX+r*view.pxPerMM, y:view.baseY-y*view.pxPerMM});

/* ---------- отрисовка ---------- */
function gridStep(){
  const cand=[1,2,5,10,20,50,100];
  for(const c of cand) if(c*view.pxPerMM>=14) return c;
  return 100;
}

/* Ручки, носики и слив на чертеже. Стоят они по разным азимутам, поэтому все
   разворачиваются в плоскость сечения — так же, как это делают на рабочем
   чертеже: иначе деталь просто не попадает в разрез. */
function drawParts(P, out, px){
  const parts=state.parts||[];
  if(!parts.length)return;
  const H=out[out.length-1].y;
  const rTop=out[out.length-1].r;

  parts.forEach((p,i)=>{
    ectx.save();
    if(p.kind==='lip'){
      const a=mmToPx(rTop,H), b=mmToPx(rTop+p.out,H-p.drop);
      ectx.strokeStyle=P.accent2(.75);ectx.lineWidth=2.2;ectx.lineCap='round';
      ectx.beginPath();ectx.moveTo(a.x,a.y);ectx.lineTo(b.x,b.y);ectx.stroke();
      ectx.fillStyle=P.text(.6);ectx.font='9px Manrope, system-ui, sans-serif';
      ectx.fillText(`слив ${i+1}`, b.x+4, b.y-3);
      ectx.restore();
      return;
    }
    const pts=partCurve(out,p).getPoints(28).map(v=>mmToPx(v.x,v.y));
    const sec=partSection(p);
    // сечение ленты в разрезе — её толщина по радиусу, у носика — диаметр
    const w=Math.max(2, (p.kind==='spout' ? (p.bore+p.tip)/2 : p.thick) * px);
    ectx.strokeStyle=P.accent(.34);ectx.lineWidth=w;ectx.lineCap='round';ectx.lineJoin='round';
    ectx.beginPath();pts.forEach((q,k)=>k?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y));ectx.stroke();
    ectx.strokeStyle=P.accent2(.85);ectx.lineWidth=1.3;
    ectx.beginPath();pts.forEach((q,k)=>k?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y));ectx.stroke();
    const tip=pts[pts.length-1];
    ectx.fillStyle=P.text(.6);ectx.font='9px Manrope, system-ui, sans-serif';
    // подпись у самого края уезжает за канву — тогда ставим её слева от кончика
    const right=tip.x>eW-70;
    ectx.textAlign=right?'right':'left';
    ectx.fillText(`${kindOf(p).name.toLowerCase()} ${i+1}`, tip.x+(right?-5:5), tip.y-4);
    ectx.textAlign='left';

    /* ситечко: поле дырочек на стенке под корнем носика */
    if(p.kind==='spout' && state.hollow){
      const h=strainerHoles(p);
      const y0=p.at*H;
      for(const hole of h.holes){
        const c=mmToPx(radiusAt(out,y0+hole.y)-state.wall/2, y0+hole.y);
        ectx.beginPath();ectx.arc(c.x,c.y,Math.max(1.2,hole.r*px),0,Math.PI*2);
        ectx.fillStyle=P.sunken();ectx.fill();
        ectx.strokeStyle=P.text(.5);ectx.lineWidth=1;ectx.stroke();
      }
      const lbl=mmToPx(radiusAt(out,y0)-state.wall/2, y0-h.field-2);
      ectx.fillStyle=P.text(.55);ectx.font='9px Manrope, system-ui, sans-serif';
      ectx.textAlign='right';
      ectx.fillText(`ситечко ${h.count}×⌀${h.holeD.toFixed(1)}`, lbl.x-3, lbl.y+3);
      ectx.textAlign='left';
    }
    ectx.restore();
  });

  ectx.fillStyle=P.text(.4);ectx.font='9px Manrope, system-ui, sans-serif';
  ectx.fillText('прилепы развёрнуты в плоскость чертежа', view.axisX+4, view.baseY+26);
}

/* Кольцо на модели живёт ровно столько, сколько актуален выбор точки. Пока
   его снимали только по клику мимо, оно оставалось висеть на вазе, когда
   человек уходил на другую вкладку, — и обещало правку, которой уже нет. */
export function dropSelection(){ if(selIdx>=0) selectPoint(-1); }

/** Подсветить точку снаружи: её тянут на модели, а показать надо и на чертеже. */
export function highlightPoint(i){
  const n=Number.isInteger(i)?i:-1;
  if(n===hoverIdx) return;
  hoverIdx=n;
  drawEditor();
}

/* ---------- точная правка выбранной точки ----------
   Тянуть удобно, но «ровно 12 см» мышью не поставить, а форма мастера часто
   держится именно на круглом числе: горловина под крышку, дно под подставку.
   Поэтому у выбранной точки есть числа, стрелки и две операции над кривой. */

/** Выбрать точку (или снять выбор при -1) и обновить панель. */
export function selectPoint(i){
  selIdx=(Number.isInteger(i)&&i>=0&&i<state.points.length)?i:-1;
  syncPointBar();
  /* Выбранная на чертеже точка обводится кольцом на модели: связь в обе
     стороны — глядя на любой из двух видов, человек видит одно и то же место. */
  if(sceneAPI.ring){
    if(selIdx>=0){
      const p=state.points[selIdx];
      sceneAPI.ring(p.t*state.H, p.r*state.D/2, true);
    }else sceneAPI.ring(0,0,false);
  }
  drawEditor();
}
export const selectedPoint=()=>selIdx;

function pointName(i){
  if(i<=0) return 'дно';
  if(i>=state.points.length-1) return 'кромка';
  return `точка ${i+1}`;
}

export function syncPointBar(){
  const bar=$('pointBar');
  if(!bar) return;
  const has=selIdx>=0&&selIdx<state.points.length;
  bar.hidden=!has;
  if(!has) return;
  const p=state.points[selIdx];
  $('pointName').textContent=pointName(selIdx);
  const d=$('pointD'), y=$('pointY');
  if(document.activeElement!==d) d.value=(p.r*state.D/10).toFixed(1);
  if(document.activeElement!==y) y.value=(p.t*state.H/10).toFixed(1);
  /* Дно и кромку по высоте не двигают: они и есть границы формы. */
  const edge=selIdx===0||selIdx===state.points.length-1;
  y.disabled=edge;
  $('pointDrop').disabled=edge;
  /* У дна и кромки соседей с двух сторон нет: сглаживать нечего, и кнопка
     не должна выглядеть работающей. Раньше она просто молча ничего не делала. */
  $('pointSmooth').disabled=edge;
}

/** Сгладить кривую вокруг выбранной точки: среднее с соседями. */
function smoothAround(i){
  const pts=state.points;
  if(i<=0||i>=pts.length-1) return;
  const a=pts[i-1], p=pts[i], b=pts[i+1];
  p.r=clamp((a.r+p.r*2+b.r)/4,0.02,1);
  p.t=clamp((a.t+p.t*2+b.t)/4,a.t+0.02,b.t-0.02);
  state.activePreset=-1;
  emit();
}

/** Сдвинуть выбранную точку клавишами: шаг в миллиметрах рецепта. */
function nudge(dr,dt,fine){
  if(selIdx<0) return false;
  const p=state.points[selIdx];
  const stepR=(fine?0.2:1)/Math.max(state.D/2,1);      // мм → доли радиуса
  const stepT=(fine?0.2:1)/Math.max(state.H,1);
  if(dr) p.r=clamp(p.r+dr*stepR,0.02,1);
  if(dt&&selIdx>0&&selIdx<state.points.length-1)
    p.t=clamp(p.t+dt*stepT,state.points[selIdx-1].t+0.02,state.points[selIdx+1].t-0.02);
  state.activePreset=-1;
  emit();
  return true;
}

export function initPointBar(){
  const bar=$('pointBar');
  if(!bar) return;
  const apply=()=>{
    if(selIdx<0) return;
    const p=state.points[selIdx];
    const d=parseFloat($('pointD').value), y=parseFloat($('pointY').value);
    if(Number.isFinite(d)) p.r=clamp(d*10/Math.max(state.D,1),0.02,1);
    if(Number.isFinite(y)&&selIdx>0&&selIdx<state.points.length-1)
      p.t=clamp(y*10/Math.max(state.H,1),
        state.points[selIdx-1].t+0.02,state.points[selIdx+1].t-0.02);
    state.activePreset=-1;
    emit();
  };
  $('pointD').onchange=apply;
  $('pointY').onchange=apply;
  $('pointSmooth').onclick=()=>smoothAround(selIdx);
  $('pointDrop').onclick=()=>{
    if(selIdx>0&&selIdx<state.points.length-1){
      state.points.splice(selIdx,1);
      state.activePreset=-1;
      selectPoint(-1);
      emit();
    }
  };
  /* Стрелки двигают точку, Shift — мелким шагом. Клавиатура здесь не роскошь:
     мышью ровное дно не поставить, а точность формы решает посадку крышки. */
  addEventListener('keydown',e=>{
    if(selIdx<0) return;
    const tag=(document.activeElement&&document.activeElement.tagName)||'';
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
    const fine=e.shiftKey;
    let used=false;
    if(e.key==='ArrowRight') used=nudge(1,0,fine);
    else if(e.key==='ArrowLeft') used=nudge(-1,0,fine);
    else if(e.key==='ArrowUp') used=nudge(0,1,fine);
    else if(e.key==='ArrowDown') used=nudge(0,-1,fine);
    else if(e.key==='Escape'){ selectPoint(-1); used=true; }
    else if((e.key==='Delete'||e.key==='Backspace')&&selIdx>0&&selIdx<state.points.length-1){
      state.points.splice(selIdx,1); state.activePreset=-1; selectPoint(-1); emit(); used=true;
    }
    if(used) e.preventDefault();
  });
}

export function drawEditor(){
  if(!eW||!ectx)return;
  const P=pal();
  view=computeView();
  ectx.setTransform(dpr,0,0,dpr,0,0);
  ectx.clearRect(0,0,eW,eH);

  const step=gridStep(), px=view.pxPerMM;
  const topY=Math.max(PAD.t, view.baseY-state.H*px-24);

  /* сетка в миллиметрах */
  ectx.strokeStyle=P.accent(.10);ectx.lineWidth=1;
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
  ectx.strokeStyle=P.accent2(.55);ectx.lineWidth=1.5;
  ectx.beginPath();ectx.moveTo(view.axisX-14,view.baseY);ectx.lineTo(eW-6,view.baseY);ectx.stroke();
  ectx.setLineDash([5,4]);ectx.lineWidth=1.3;ectx.strokeStyle=P.accent2(.45);
  ectx.beginPath();ectx.moveTo(view.axisX,view.baseY+8);ectx.lineTo(view.axisX,topY);ectx.stroke();
  ectx.setLineDash([]);

  ectx.save();ectx.fillStyle=P.accent(.7);ectx.font='9px Manrope, system-ui, sans-serif';
  ectx.translate(view.axisX-12,(view.baseY+topY)/2);ectx.rotate(-Math.PI/2);ectx.textAlign='center';
  ectx.fillText('ОСЬ ВРАЩЕНИЯ',0,0);ectx.restore();

  /* призрак текущего этапа «Кинотеатра» с учётом усадки */
  if(state.stage<5.98){
    const prof=stageProfile(state,state.stage);
    const shrink=state.stage>5?1-(state.stage-5)*byId(state.mat).shrinkPct/100:1;
    ectx.beginPath();
    prof.forEach((o,i)=>{const q=mmToPx(o.r*shrink,o.y*shrink);i?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y);});
    ectx.strokeStyle=P.text(.3);ectx.lineWidth=1.4;ectx.setLineDash([3,3]);ectx.stroke();ectx.setLineDash([]);
  }

  /* тело изделия: наружный контур + внутренняя стенка */
  const out=userProfileMM(state);
  const outer=out.map(o=>mmToPx(o.r,o.y));
  ectx.beginPath();
  ectx.moveTo(view.axisX,view.baseY);
  for(const q of outer)ectx.lineTo(q.x,q.y);
  ectx.lineTo(view.axisX,outer[outer.length-1].y);
  ectx.closePath();
  ectx.fillStyle=P.accent(.16);ectx.fill();

  if(state.hollow){
    const floor=floorY(state);
    const inner=out.filter(o=>o.y>=floor).map(o=>mmToPx(Math.max(o.r-state.wall,0),o.y));
    if(inner.length>1){
      ectx.beginPath();
      inner.forEach((q,i)=>i?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y));
      ectx.strokeStyle=P.text(.45);ectx.lineWidth=1.3;ectx.stroke();
      const f=mmToPx(0,floor), f2=mmToPx(Math.max(out[0].r-state.wall,0),floor);
      ectx.beginPath();ectx.moveTo(f.x,f.y);ectx.lineTo(f2.x,f2.y);ectx.stroke();
    }
  }
  /* Узор на чертеже: сечение проходит по одной точке круга и рельефа не
     показывает вовсе — человек правит глубину и видит неподвижную линию.
     Рисуем не сам узор, а его границы: пунктиром гребень и ложбину, между
     которыми гуляет стенка. Так видно и глубину, и то, где рельеф гасится. */
  const pat=sanitizePattern(state.pattern);
  if(patternOn(pat)){
    const Hs=out[out.length-1].y;
    /* Огибающие несимметричны: чешуя и кладка растут только наружу, лунки
       и окна — только внутрь. Рисовать их зеркально значило бы обещать
       борозду там, где её нет. */
    ectx.setLineDash([4,3]);ectx.lineWidth=1.1;ectx.strokeStyle=P.accent(.5);
    /* Огибающие берутся готовым списком: чертёж перерисовывается на каждое
       движение камеры, а считать их по точке на кадр — четыре миллисекунды
       на ровном месте. */
    const env=patternOutline(pat,out);
    for(const side of ['hi','lo']){
      ectx.beginPath();
      env.forEach((e,i)=>{
        const q=mmToPx(Math.max(e.r+e[side],0),e.y);
        i?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y);
      });
      ectx.stroke();
    }
    ectx.setLineDash([]);
  }

  ectx.beginPath();
  outer.forEach((q,i)=>i?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y));
  ectx.strokeStyle=P.accent2();ectx.lineWidth=2.4;
  ectx.shadowColor=P.accent2(.5);ectx.shadowBlur=7;ectx.stroke();ectx.shadowBlur=0;

  /* прилепы: развёрнуты в плоскость чертежа, иначе в сечении их не видно вовсе */
  drawParts(P, out, px);

  /* размерные подписи */
  ectx.fillStyle=P.text(.65);ectx.font='10px Manrope, system-ui, sans-serif';
  ectx.textAlign='left';
  ectx.fillText((state.H/10).toFixed(1)+' см', view.axisX+4, Math.max(topY+11, view.baseY-state.H*px-6));
  ectx.fillText('⌀ '+(state.D/10).toFixed(1)+' см', view.axisX+4, view.baseY+14);

  /* ручки выбранного прилепа: их правят так же, как точки профиля */
  const ph=partHandles();
  if(ph){
    ectx.save();
    const line=ph.pts.map(q=>mmToPx(q.x,q.y));
    ectx.beginPath();
    line.forEach((q,i)=>i?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y));
    ectx.strokeStyle=P.text(ph.ghost?.28:.45);ectx.lineWidth=1.2;
    ectx.setLineDash([4,4]);ectx.stroke();ectx.setLineDash([]);
    line.forEach((q,i)=>{
      ectx.beginPath();ectx.arc(q.x,q.y,i===partHover?7:5.5,0,Math.PI*2);
      ectx.fillStyle=ph.ghost?P.sunken():P.text(.9);
      ectx.fill();
      ectx.lineWidth=2;ectx.strokeStyle=P.text(.75);ectx.stroke();
    });
    ectx.restore();
  }

  /* ведомый штрих поверх всего: видно, что рука рисует, до пересборки */
  if(stroke&&stroke.length>1){
    ectx.beginPath();
    stroke.forEach((q,i)=>i?ectx.lineTo(q.x,q.y):ectx.moveTo(q.x,q.y));
    ectx.strokeStyle=P.text(.9);ectx.lineWidth=2;ectx.setLineDash([5,4]);
    ectx.lineCap='round';ectx.lineJoin='round';ectx.stroke();ectx.setLineDash([]);
  }

  /* точки рецепта */
  state.points.forEach((p,i)=>{
    const q=ptToPx(p), end=(i===0||i===state.points.length-1);
    ectx.beginPath();ectx.arc(q.x,q.y,i===hoverIdx?8:i===selIdx?7.5:6.5,0,Math.PI*2);
    ectx.fillStyle=end?P.text(.92):P.accent();ectx.fill();
    ectx.lineWidth=2;ectx.strokeStyle=P.sunken();ectx.stroke();
    if(i===hoverIdx){
      ectx.beginPath();ectx.arc(q.x,q.y,11,0,Math.PI*2);
      ectx.strokeStyle=P.accent2(.5);ectx.lineWidth=1.4;ectx.stroke();
      const rmm=(p.r*mmPerNorm()).toFixed(1), ymm=(p.t*state.H).toFixed(0);
      ectx.fillStyle=P.text(.85);ectx.font='10px Manrope, system-ui, sans-serif';
      ectx.fillText(`⌀${(rmm*2).toFixed(0)} · ${ymm} мм`, q.x+13, q.y-9);
    }
  });

  syncTargetChip();
  /* «Не помещается» — это жалоба, а не помощь: чип в этом случае превращается
     в кнопку, которая чинит ровно то, о чём сообщает. */
  const badge=$('draftScale');
  if(badge){
    const bad = mode!=='fit' && !view.fits;
    badge.textContent = mode==='fit' ? 'по размеру' : (bad ? 'вписать' : '1:1 с моделью');
    badge.classList.toggle('fix', bad);
    badge.title = bad ? 'Изделие не влезает в чертёж в масштабе 1:1 — нажмите, чтобы вписать'
                      : 'Переключить масштаб: 1:1 с 3D-видом или вписать в панель';
  }
}

/** Масштаб чертежа снаружи: '1:1' — как в 3D-виде, 'fit' — вписать в канву. */
export function setEditorMode(m){
  if(m!=='1:1'&&m!=='fit')return;
  if(mode===m)return;
  mode=m;modeChosen=true;lastKey='';drawEditor();
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
const coarse=()=>matchMedia('(pointer:coarse)').matches;
function hitPoint(px,py){
  let best=-1,bd=coarse()?26:15;
  state.points.forEach((p,i)=>{const q=ptToPx(p);const d=Math.hypot(q.x-px,q.y-py);if(d<bd){bd=d;best=i;}});
  return best;
}

/* ---------- линия профиля одним движением ---------- */
/* Вся математика перевода штриха в рецепт — в js/core/trace.js: она чистая
   и проверяется из командной строки. Здесь остаётся только то, чего в ядре
   быть не должно, — экранные координаты. */
function applyStroke(px){
  const mm=px.map(p=>({r:(p.x-view.axisX)/view.pxPerMM, y:(view.baseY-p.y)/view.pxPerMM}));
  const got=traceToRecipe(mm);
  if(!got) return false;
  state.points=got.points; state.H=got.H; state.D=got.D; state.activePreset=-1;
  emit();
  if(onReshape) onReshape({H:got.H, D:got.D, points:got.points.length, squeezed:got.squeezed});
  return true;
}

/* ---------- ручки выбранного прилепа ---------- */
/* Профиль правят точками — прилеп должен править ими же. Пока кривой у детали
   нет, точки показываются призраками прямо с параметрической кривой: тронул —
   кривая появилась, и дальше ползунки формы её только пересказывают. */
function partHandles(){
  const p=selectedPart();
  if(!p) return null;
  const prof=userProfileMM(state);
  /* Слив кривой не имеет — он отгиб кромки. Но и его настраивают на чертеже:
     одна точка на конце отгиба задаёт сразу вылет и понижение кромки. */
  if(kindOf(p).deform){
    const H=prof[prof.length-1].y, rTop=prof[prof.length-1].r;
    return {p, prof, lip:true, ghost:false,
            pts:[{x:rTop+(p.out||0), y:H-(p.drop||0)}]};
  }
  const pts = p.path ? pathPoints(prof,p)
    : pathFromParams(prof,p).map(q=>({x:Math.max(0,radiusAt(prof,q.t*prof[prof.length-1].y)+q.d),
                                      y:q.t*prof[prof.length-1].y}));
  return {p, prof, pts, ghost:!p.path};
}

/* Что правит штрих: корпус или выбранная деталь. Выбрали деталь — рисуем её;
   переключатель в шапке чертежа даёт вернуться к корпусу, не снимая выбора. */
function drawTargetNow(){
  const p=selectedPart();
  if(!p||kindOf(p).deform) return 'body';
  return drawTarget||'part';
}
function syncTargetChip(){
  const b=$('draftTarget');
  if(!b) return;
  const p=selectedPart(), can=p&&!kindOf(p).deform;
  if(p&&p.id!==lastSelId){lastSelId=p.id;drawTarget=null;}   // сменили деталь — сбросить выбор
  if(!p) lastSelId=null;
  b.hidden = draftMode!=='draw'||!can;
  const part = drawTargetNow()==='part';
  if(!b.hidden){
    const i=(state.parts||[]).indexOf(p);
    b.textContent = part ? `рисую: ${kindOf(p).name.toLowerCase()} ${i+1}` : 'рисую: корпус';
  }
  // подсказка обязана говорить про то, что рисуют сейчас, а не про корпус вообще
  const hb=$('draftHintBody'), hpt=$('draftHintPart');
  if(hb) hb.hidden = part;
  if(hpt) hpt.hidden = !part;
}

/* Штрих в кривую детали. Профиль так переснять нельзя: у ручки высота
   не монотонна, поэтому у прилепов своя математика — js/core/parts.js. */
function applyPartStroke(px){
  const p=selectedPart();
  if(!p||kindOf(p).deform) return false;
  const prof=userProfileMM(state);
  const mm=px.map(q=>({x:(q.x-view.axisX)/view.pxPerMM, y:(view.baseY-q.y)/view.pxPerMM}));
  const path=pathFromStroke(prof,p,mm);
  if(!path) return false;
  p.path=path;
  syncFieldsFromPath(prof,p);
  state.activePreset=-1;
  emit(); syncParts();
  if(onReshape) onReshape({part:kindOf(p).name, points:path.length});
  return true;
}

function hitPartPoint(px,py){
  const h=partHandles();
  if(!h) return -1;
  let best=-1,bd=coarse()?26:15;
  h.pts.forEach((q,i)=>{
    const s=mmToPx(q.x,q.y), d=Math.hypot(s.x-px,s.y-py);
    if(d<bd){bd=d;best=i;}
  });
  return best;
}

/* Экран → пара «доля высоты, отступ от стенки». Отступ, а не радиус: стенка
   двигается вместе с силуэтом и диаметром, и прилеп обязан ехать с ней. */
function pxToPart(prof,px,py){
  const rmm=(px-view.axisX)/view.pxPerMM, ymm=(view.baseY-py)/view.pxPerMM;
  const H=prof[prof.length-1].y||1;
  return {t:ymm/H, d:rmm-radiusAt(prof,ymm)};
}

function dragPartPoint(i,px,py){
  const h=partHandles();
  if(!h||i<0) return;
  const p=h.p;
  if(h.lip){
    const rmm=(px-view.axisX)/view.pxPerMM, ymm=(view.baseY-py)/view.pxPerMM;
    const H=h.prof[h.prof.length-1].y, rTop=h.prof[h.prof.length-1].r;
    const Lo=limitOf('lip','out'), Ld=limitOf('lip','drop');
    p.out=Math.round(clamp(rmm-rTop,Lo.min,Lo.max));
    p.drop=Math.round(clamp(H-ymm,Ld.min,Ld.max));
    state.activePreset=-1;
    emit(); syncParts();
    return;
  }
  if(!p.path) p.path=pathFromParams(h.prof,p);        // призрак стал кривой
  const q=pxToPart(h.prof,px,py);
  p.path[i]={t:round(clamp(q.t,-0.5,2)), d:round(clamp(q.d,-40,300),2)};
  syncFieldsFromPath(h.prof,p);
  state.activePreset=-1;
  emit(); syncParts();
}

function addPointAt(px,py){
  const c=pxToPt(px,py);
  if(c.t<=.02||c.t>=.98)return;
  state.points.push({t:c.t,r:c.r});
  state.points.sort((a,b)=>a.t-b.t);
  state.activePreset=-1;emit();
}
function removePoint(i){
  if(i>0&&i<state.points.length-1){
    state.points.splice(i,1);state.activePreset=-1;emit();
    if(navigator.vibrate)navigator.vibrate(15);
  }
}

/** Чем правят профиль: 'points' — тянуть точки, 'draw' — вести линию. */
/** Масштаб чертежа снаружи: редактору нужен «вписать», иначе в его широком
    поле профиль показан кусками. */
export function setDraftScale(next){
  const want = next === '1:1' ? '1:1' : 'fit';
  if (mode === want) return;
  mode = want;
  modeChosen = true;
  lastKey = '';
  drawEditor();
}

export function draftScale(){ return mode; }

export function setDraftMode(m){
  if(m!=='points'&&m!=='draw')return;
  draftMode=m; stroke=null;
  document.querySelectorAll('#draftMode [data-dmode]')
    .forEach(b=>b.classList.toggle('active',b.dataset.dmode===m));
  const hp=$('draftHintPts'), hd=$('draftHintDraw');
  if(hp) hp.hidden = m==='draw';
  if(hd) hd.hidden = m!=='draw';
  syncTargetChip();
  if(ec) ec.style.cursor='crosshair';
  hoverIdx=-1;
  if(eW) drawEditor();
}

export function initEditor(canvas, reshaped){
  ec=canvas;ectx=ec.getContext('2d');
  onReshape=reshaped||null;
  new ResizeObserver(resizeEditor).observe(ec);

  const toggle=$('draftScale');
  if(toggle) toggle.onclick=()=>{mode=mode==='1:1'?'fit':'1:1';modeChosen=true;lastKey='';drawEditor();};
  document.querySelectorAll('#draftMode [data-dmode]')
    .forEach(b=>b.onclick=()=>setDraftMode(b.dataset.dmode));
  const tgt=$('draftTarget');
  if(tgt) tgt.onclick=()=>{drawTarget=drawTargetNow()==='part'?'body':'part';syncTargetChip();};

  ec.addEventListener('contextmenu',e=>e.preventDefault());
  ec.addEventListener('pointerdown',e=>{
    const rect=ec.getBoundingClientRect();
    const px=e.clientX-rect.left,py=e.clientY-rect.top;
    if(draftMode==='draw'){
      if(e.button===2)return;
      strokeTarget=drawTargetNow();
      stroke=[{x:px,y:py}];
      try{ec.setPointerCapture(e.pointerId);}catch(_){}
      drawEditor();
      return;
    }
    const pi=hitPartPoint(px,py);
    if(pi>=0&&e.button!==2){
      partDrag=pi;
      try{ec.setPointerCapture(e.pointerId);}catch(_){}
      return;
    }
    const idx=hitPoint(px,py);
    if(e.button===2){
      if(idx>0&&idx<state.points.length-1){
        state.points.splice(idx,1);state.activePreset=-1;emit();
      }
      return;
    }
    if(idx>=0){
      dragIdx=idx;
      selectPoint(idx);
      try{ec.setPointerCapture(e.pointerId);}catch(_){}
    }else if(e.button!==2){
      selectPoint(-1);
    }
    if(e.pointerType==='mouse')return;
    // на телефоне правой кнопки нет: удаление — долгим нажатием, добавление — двойным касанием
    clearTimeout(pressTimer);
    if(idx>0&&idx<state.points.length-1){
      pressTimer=setTimeout(()=>{dragIdx=-1;removePoint(idx);},520);
    }else if(idx<0){
      const now=Date.now();
      if(now-lastTap<340&&lastTapPt&&Math.hypot(lastTapPt.x-px,lastTapPt.y-py)<30){
        addPointAt(px,py);lastTap=0;lastTapPt=null;
      }else{lastTap=now;lastTapPt={x:px,y:py};}
    }
  });
  ec.addEventListener('pointermove',e=>{
    const rect=ec.getBoundingClientRect();
    const px=e.clientX-rect.left,py=e.clientY-rect.top;
    if(stroke){
      const last=stroke[stroke.length-1];
      if(Math.hypot(px-last.x,py-last.y)>=2){stroke.push({x:px,y:py});drawEditor();}
      return;
    }
    if(partDrag>=0){ clearTimeout(pressTimer); dragPartPoint(partDrag,px,py); return; }
    if(dragIdx>=0){
      clearTimeout(pressTimer);
      const p=state.points[dragIdx],c=pxToPt(px,py);
      p.r=c.r;
      if(dragIdx===0)p.t=0;
      else if(dragIdx===state.points.length-1)p.t=1;
      else p.t=clamp(c.t,state.points[dragIdx-1].t+.02,state.points[dragIdx+1].t-.02);
      state.activePreset=-1;emit();
      syncPointBar();
      if(sceneAPI.ring) sceneAPI.ring(p.t*state.H, p.r*state.D/2, true);
    }else{
      const ph=hitPartPoint(px,py);
      const h=ph>=0?-1:hitPoint(px,py);
      if(h!==hoverIdx||ph!==partHover){hoverIdx=h;partHover=ph;drawEditor();}
      ec.style.cursor=(h>=0||ph>=0)?'grab':'crosshair';
    }
  });
  const endStroke=ok=>{
    if(!stroke)return;
    const s=stroke, tgt=strokeTarget; stroke=null;
    const done = ok && (tgt==='part' ? applyPartStroke(s) : applyStroke(s));
    if(ok && !done && onReshape) onReshape(null, tgt);        // штрих не сложился
    drawEditor();
  };
  ec.addEventListener('pointerup',()=>{clearTimeout(pressTimer);dragIdx=-1;partDrag=-1;endStroke(true);});
  ec.addEventListener('pointercancel',()=>{clearTimeout(pressTimer);dragIdx=-1;partDrag=-1;endStroke(false);});
  ec.addEventListener('dblclick',e=>{
    if(draftMode==='draw')return;
    const rect=ec.getBoundingClientRect();
    addPointAt(e.clientX-rect.left,e.clientY-rect.top);
  });
}
