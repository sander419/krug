// file: js/core/slicer.js
// LDM-слайсер: непрерывная vase-спираль без ретракций.
import { userProfileMM, radiusAt } from './math.js';
import { PRINTERS } from '../config/data.js';
import { byId, density } from '../config/materials.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

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

  const L=[];
  const mat=byId(state.mat), shrink=mat.shrinkPct;
  L.push('; ============================================');
  L.push(`; КРУГ — LDM G-code · ${state.name||'форма'}`);
  L.push(`; принтер: ${P0.name} (${P0.note})`);
  L.push(`; сопло ${pr.nozzle} мм · слой ${pr.lh} мм · ${pr.feed} мм/мин · поток ${pr.flow}%`);
  L.push(`; периметров: ${P} · vase-спираль, без ретракций`);
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
    L.push(`G1 X${fN(x)} Y${fN(y)} Z${fN(z)} E${fE(eAcc)} F${pr.feed}`);
  }

  /* сплошное дно: спираль от центра */
  const r0=Math.max(radiusAt(out,floor)-bead/2,1);
  const revsB=Math.max(1,Math.round(floor/pr.lh));
  const stepsB=revsB*segs;
  L.push('; --- сплошное дно (спираль) ---');
  moveTo(bead*0.4,0,pr.lh/2);
  L.push(`G1 X${fN(bead*0.4)} Y0 Z${fN(pr.lh/2)} F${pr.feed}`);
  for(let k=1;k<=stepsB;k++){
    const q=k/stepsB, ang=q*revsB*Math.PI*2;
    const r=bead*0.4+(r0-bead*0.4)*q;
    const z=pr.lh/2+(floor-pr.lh/2)*q;
    ext(r*Math.cos(ang),r*Math.sin(ang),z);
  }

  /* стенки: периметры-спирали снаружи внутрь */
  for(let p=0;p<P;p++){
    const offset=p*bead*0.95;
    const rw=z=>Math.max(radiusAt(out,z)-offset-bead/2,0.6);
    if(rw(floor)<1)break;
    if(p>0){
      L.push(`; --- периметр ${p+1}: клапан закрыт, переезд ---`);
      L.push(`G1 X${fN(rw(floor))} Y0 Z${fN(floor)} F${pr.feed}`);
      lastX=rw(floor);lastY=0;lastZ=floor;
    }
    L.push(`; --- периметр ${p+1}: спираль ---`);
    const stepsW=Math.max(segs,Math.round((H-floor)/pr.lh)*segs);
    for(let k=1;k<=stepsW;k++){
      const q=k/stepsW, ang=q*Math.PI*2*((H-floor)/pr.lh);
      const z=floor+(H-floor)*q;
      const r=rw(z);
      ext(r*Math.cos(ang),r*Math.sin(ang),z);
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
  if(state.wall>bead*1.6 && P===4) warns.push({cls:'w',txt:'Стенка заметно толще бусины — периметров может не хватить.'});

  const volMM=pathLen*pr.lh*bead;
  const grams=volMM/1000*density(mat);
  const mins=pathLen/pr.feed;
  return {
    text: L.join('\n'),
    stats: {layers:Math.round(H/pr.lh), lenM:pathLen/1000, mins, grams},
    warnings: warns,
  };
}
