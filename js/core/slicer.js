// file: js/core/slicer.js
// LDM-слайсер: непрерывная vase-спираль без ретракций.
import { userProfileMM, radiusAt } from './math.js';
import { PRINTERS } from '../config/data.js';
import { byId, density } from '../config/materials.js';
import { clamp } from './util.js';
import { sanitizePattern, patternOn, patternOffset, patternWarnings } from './pattern.js';


/* Ширина бусины: сопло раскатывает пасту чуть шире своего диаметра. Наружу —
   потому что по ней меряют и стенку, и то, различит ли сопло рельеф узора. */
export const beadWidth = state => (state.pr && +state.pr.nozzle || 4) * 1.05;

export function sliceGCode(state){
  const pr=state.pr, P0=PRINTERS[pr.printer];
  const out=userProfileMM(state);
  const H=out[out.length-1].y;
  const bead=pr.nozzle*1.05;
  const floor=Math.min(Math.max(state.wall, state.footH>0?state.footH+1.5:0), H*.6);
  const P=clamp(Math.round(state.wall/bead),1,4);
  const segs=72, flow=pr.flow/100;
  const cartArea=Math.PI*Math.pow(pr.cart/2,2);
  const ePerMM=(pr.lh*bead*flow)/cartArea;

  // центр стола: у портальной машины ноль в углу, у дельты — в центре.
  // Без этого сдвига половина траектории уходит в минус и печать срывается.
  const cx=P0.origin==='center'?0:P0.bed[0]/2;
  const cy=P0.origin==='center'?0:P0.bed[1]/2;

  const L=[];
  const mat=byId(state.mat), shrink=mat.shrinkPct;
  L.push('; ============================================');
  L.push(`; КРУГ — LDM G-code · ${state.name||'форма'}`);
  L.push(`; принтер: ${P0.name} (${P0.note})`);
  L.push(`; ноль стола: ${P0.origin==='center'?'центр':'угол'} · центр изделия X${cx} Y${cy}`);
  L.push(`; сопло ${pr.nozzle} мм · слой ${pr.lh} мм · ${pr.feed} мм/мин · поток ${pr.flow}%`);
  L.push(`; периметров: ${P} · ${P===1?'непрерывная спираль, без ретракций':'послойный обход'}`);
  L.push(`; печать в сыром размере; после обжига усадка -${shrink}%`);
  L.push('; ============================================');
  L.push('G21','G90','M82','G28','G92 E0');
  L.push('G1 Z10 F600');

  let pathLen=0,eAcc=0,lastX=null,lastY=null,lastZ=null;
  const fN=v=>v.toFixed(3), fE=v=>v.toFixed(4);
  const moveTo=(x,y,z)=>{lastX=x;lastY=y;lastZ=z;};
  function ext(x,y,z){
    const d=Math.hypot(x-(lastX??x),y-(lastY??y),z-(lastZ??z));
    pathLen+=d;eAcc+=d*ePerMM;
    lastX=x;lastY=y;lastZ=z;
    L.push(`G1 X${fN(x+cx)} Y${fN(y+cy)} Z${fN(z)} E${fE(eAcc)} F${pr.feed}`);
  }

  /* сплошное дно: спираль от центра */
  const r0=Math.max(radiusAt(out,floor)-bead/2,1);
  const revsB=Math.max(1,Math.round(floor/pr.lh));
  const stepsB=revsB*segs;
  L.push('; --- сплошное дно (спираль) ---');
  moveTo(bead*0.4,0,pr.lh/2);
  L.push(`G1 X${fN(bead*0.4+cx)} Y${fN(cy)} Z${fN(pr.lh/2)} F${pr.feed}`);
  for(let k=1;k<=stepsB;k++){
    const q=k/stepsB, ang=q*revsB*Math.PI*2;
    const r=bead*0.4+(r0-bead*0.4)*q;
    const z=pr.lh/2+(floor-pr.lh/2)*q;
    ext(r*Math.cos(ang),r*Math.sin(ang),z);
  }

  /* стенки. Один периметр — непрерывная спираль без единого переезда, как и
     принято в LDM. Несколько периметров спиралями подряд печатать нельзя:
     закончив первый наверху, сопло пришлось бы опустить вниз сквозь только что
     напечатанную стенку. Поэтому от двух периметров переходим на послойный
     обход: все петли слоя, потом подъём. */
  /* Узор попадает в G-code той же функцией, что и в модель: иначе сопло
     напечатало бы гладкую вазу, а на экране был бы рельеф. */
  const pat=sanitizePattern(state.pattern);
  const patOn=patternOn(pat);
  /* Рельеф повторяют все периметры, а не только наружный: внутренние идут
     тем же контуром со смещением внутрь. Пока рельеф был только на первом,
     между петлями гулял зазор в две глубины — местами бусины наезжали друг
     на друга, местами между ними оставалась щель. */
  const rw=(z,p,ang=0)=>Math.max(radiusAt(out,z)
    +(patOn?patternOffset(pat,ang,z,H):0)-p*bead*0.95-bead/2,0.6);
  if(P===1){
    L.push('; --- стенка: непрерывная спираль ---');
    const stepsW=Math.max(segs,Math.round((H-floor)/pr.lh)*segs);
    for(let k=1;k<=stepsW;k++){
      const q=k/stepsW, ang=q*Math.PI*2*((H-floor)/pr.lh);
      const z=floor+(H-floor)*q, r=rw(z,0,ang);
      ext(r*Math.cos(ang),r*Math.sin(ang),z);
    }
  }else{
    L.push(`; --- стенка: ${P} периметра, обход послойно ---`);
    const layers=Math.max(1,Math.round((H-floor)/pr.lh));
    for(let li=1;li<=layers;li++){
      const z=floor+(H-floor)*li/layers;
      for(let p=0;p<P;p++){
        const r0=rw(z,p,0);
        if(r0<=0.7) break;
        // переезд на начало петли — на той же высоте и без подачи
        L.push(`G1 X${fN(r0+cx)} Y${fN(cy)} Z${fN(z)} F${pr.feed}`);
        lastX=r0;lastY=0;lastZ=z;
        for(let k=1;k<=segs;k++){
          const ang=k/segs*Math.PI*2;
          const rr=rw(z,p,ang);
          ext(rr*Math.cos(ang),rr*Math.sin(ang),z);
        }
      }
    }
  }

  L.push('; --- завершение ---');
  L.push('G1 Z'+fN(H+15)+' F600','M5','M2');

  /* производственные предупреждения */
  const warns=[];
  const ratio=pr.lh/pr.nozzle;
  if(ratio>0.9) warns.push({cls:'e',txt:`Слой ${pr.lh} мм ≥ сопла — бусина не склеится.`});
  else if(ratio<0.25) warns.push({cls:'w',txt:'Слой слишком тонкий для сопла — риск переэкструзии и разрушения слоёв.'});
  if(state.D>Math.min(P0.bed[0],P0.bed[1])||H>P0.bed[2])
    warns.push({cls:'e',txt:`Не входит в камеру ${P0.name} (${P0.bed[0]}×${P0.bed[1]}×${P0.bed[2]} мм).`});
  let overLayers=0;
  for(let i=1;i<out.length;i++){
    const dy=out[i].y-out[i-1].y;
    if(dy>0.05){
      const drPerLayer=(out[i].r-out[i-1].r)/dy*pr.lh;
      if(drPerLayer<-bead*0.75) overLayers+=Math.round(dy/pr.lh);
    }
  }
  if(overLayers>3) warns.push({cls:'w',txt:`Нависание >45° на ~${overLayers} слоях — возможен завал свежей стенки.`});
  // печатается бусина шириной bead, а масса и прочность считаны по стенке рецепта
  const printedWall=P*bead*0.95+bead*0.05;
  if(Math.abs(printedWall-state.wall)>0.6)
    warns.push({cls:'w',txt:`Печатается стенка ${printedWall.toFixed(1)} мм (${P} × бусина ${bead.toFixed(1)} мм), а в рецепте ${state.wall} мм — масса и запас прочности считаны по рецепту. Под сопло ${pr.nozzle} мм ровно ложится стенка ${(Math.max(1,Math.round(state.wall/(bead*0.95)))*bead*0.95).toFixed(1)} мм.`});

  /* Время оборота в самом узком месте. Узкая шейка печатается быстро, свежая
     паста не успевает набрать прочность, и стенка ползёт — при том, что расчёт
     осадки по весу столба этого не видит: он статический. */
  let rMin=Infinity;
  for(const o of out){
    if(o.y<=floor) continue;
    const r=Math.max(o.r-bead/2,0.6);
    if(r<rMin) rMin=r;
  }
  const layerSec=Number.isFinite(rMin) ? 60*(2*Math.PI*rMin*P)/pr.feed : 0;
  if(layerSec>0 && layerSec<6)
    warns.push({cls:layerSec<3?'e':'w', txt:
      `Оборот слоя в самом узком месте — ${layerSec.toFixed(1)} с. Паста не успевает схватиться, стенка поплывёт: снизьте подачу или ставьте на стол сразу два изделия. Порог 6 с — умолчание инструмента, не отраслевой норматив.`});

  const nParts=(state.parts||[]).length;
  if(nParts)
    warns.push({cls:'w',txt:`В G-code только тело: ${nParts===1?'прилеп':'прилепы ('+nParts+')'} спираль не печатает — их лепят и прилепляют отдельно, к подвяленному изделию.`});

  /* Узор проверяется теми же порогами, что и на вкладке формы: сопло, шаг
     рельефа, свес закрутки. Печатнику это надо знать до запуска, а не после. */
  for(const w of patternWarnings(pat,{wall:state.wall,hollow:state.hollow,D:state.D,H,bead,layerH:pr.lh}))
    if(w.lvl!=='ok') warns.push({cls:w.lvl==='bad'?'e':'w',txt:'Узор: '+w.txt});

  const volMM=pathLen*pr.lh*bead;
  const grams=volMM/1000*density(mat);
  const mins=pathLen/pr.feed;
  return {
    text: L.join('\n'),
    stats: {layers:Math.round(H/pr.lh), lenM:pathLen/1000, mins, grams, layerSec},
    warnings: warns,
  };
}
