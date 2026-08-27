// file: js/ui/panels.js
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { PRESETS, CLAYS, PRINTERS } from '../config/data.js';
import { seededForm } from '../core/math.js';
import { sliceGCode } from '../core/slicer.js';
import { sceneAPI } from '../three/scene.js';
import { download, fileName } from '../core/files.js';
import { toast } from './overlays.js';

const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const S={};

/* ползунок с точным вводом по двойному клику (CAD-режим) */
export function hookSlider(id,outId,fmt,apply){
  const sl=$(id),out=$(outId);
  const render=()=>{
    out.textContent=fmt(parseFloat(sl.value));
    sl.style.setProperty('--fill',((sl.value-sl.min)/(sl.max-sl.min)*100)+'%');
  };
  const upd=()=>{render();apply(parseFloat(sl.value));};
  sl.addEventListener('input',upd);
  out.title='двойной клик — точный ввод';
  out.addEventListener('dblclick',()=>{
    const raw=prompt('Точное значение:',sl.value);
    if(raw===null)return;
    const v=parseFloat(raw.replace(',','.'));
    if(!isFinite(v)){toast('Число не распознано');return;}
    sl.value=clamp(v,+sl.min,+sl.max);
    upd();
  });
  render();
  return {sl, sync:v=>{sl.value=v;upd();}};
}

function buildPresets(){
  const el=$('presets');
  PRESETS.forEach((pr,i)=>{
    const b=document.createElement('button');
    b.className='preset'+(i===state.activePreset?' active':'');
    b.innerHTML=`<span class="ico">${pr.ico}</span>${pr.name}`;
    b.onclick=()=>{
      state.points=pr.pts.map(p=>({...p}));
      state.activePreset=i;
      state.name=pr.name;
      $('nameInput').value=pr.name;
      document.querySelectorAll('.preset').forEach((x,j)=>x.classList.toggle('active',j===i));
      emit();
      sceneAPI.frameView(state);
    };
    el.appendChild(b);
  });
  const rnd=document.createElement('button');
  rnd.className='preset wide';rnd.innerHTML='🎲 Случайная форма (seed)';
  rnd.onclick=()=>{
    state.seed=10000+Math.floor(Math.random()*89999);
    state.points=seededForm(state.seed);
    state.activePreset=-1;
    state.name='Авторская форма';
    $('nameInput').value=state.name;
    document.querySelectorAll('.preset').forEach(x=>x.classList.remove('active'));
    $('seedOut').textContent=state.seed;
    emit();
    sceneAPI.frameView(state);
  };
  el.appendChild(rnd);
}

function buildClays(){
  const el=$('swatches');
  CLAYS.forEach((c,i)=>{
    const b=document.createElement('button');
    b.className='swatch'+(i===state.clay?' active':'');
    b.style.background='#'+c.raw.toString(16).padStart(6,'0');
    b.title=`${c.name} · усадка ${c.shrink}% · CTE ${c.cte}·10⁻⁶/°C`;
    b.onclick=()=>{
      state.clay=i;
      document.querySelectorAll('.swatch').forEach((x,j)=>x.classList.toggle('active',j===i));
      $('swatchName').textContent=`${c.name} · усадка ${c.shrink}% · CTE ${c.cte}·10⁻⁶/°C`;
      sceneAPI.applyMaterial(state);
      emit();
    };
    el.appendChild(b);
  });
  $('swatchName').textContent=`${CLAYS[state.clay].name} · усадка ${CLAYS[state.clay].shrink}% · CTE ${CLAYS[state.clay].cte}·10⁻⁶/°C`;
  $('firingSeg').querySelectorAll('button').forEach(b=>{
    b.onclick=()=>{
      state.firing=b.dataset.f;
      document.querySelectorAll('#firingSeg button').forEach(x=>x.classList.toggle('active',x===b));
      sceneAPI.applyMaterial(state);
    };
  });
}

function buildPrintPanel(){
  const sel=$('printerSel');
  PRINTERS.forEach((p,i)=>{
    const o=document.createElement('option');
    o.value=i;o.textContent=p.name;
    sel.appendChild(o);
  });
  sel.addEventListener('change',()=>{
    const p=PRINTERS[sel.value|0];
    state.pr.printer=sel.value|0;
    $('printerNote').textContent=p.note;
    S.nozzle.sync(p.nozzle);S.layer.sync(p.lh);S.feed.sync(p.feed);S.cart.sync(p.cart);
  });
  S.nozzle=hookSlider('nozzleSl','nozzleOut',v=>v.toFixed(1)+' мм',v=>{state.pr.nozzle=v;});
  S.layer=hookSlider('layerSl','layerOut',v=>v.toFixed(2)+' мм',v=>{state.pr.lh=v;});
  S.feed=hookSlider('feedSl','feedOut',v=>v+' мм/мин',v=>{state.pr.feed=v;});
  S.cart=hookSlider('cartSl','cartOut',v=>v+' мм',v=>{state.pr.cart=v;});
  S.flow=hookSlider('flowSl','flowOut',v=>v+'%',v=>{state.pr.flow=v;});
  S.tau=hookSlider('tauSl','tauOut',v=>v.toFixed(1)+' кПа',v=>{state.pr.tau=v;emit();});

  $('sliceBtn').onclick=()=>{
    const {text,stats,warnings}=sliceGCode(state);
    const res=$('sliceRes');
    res.style.display='block';
    const time=stats.mins<90?Math.round(stats.mins)+' мин':(stats.mins/60).toFixed(1)+' ч';
    const grams=stats.grams>=1000?(stats.grams/1000).toFixed(2)+' кг':Math.round(stats.grams)+' г';
    res.innerHTML=`Готово: <b>${stats.layers} слоёв</b> · путь <b>${stats.lenM.toFixed(0)} м</b> · ≈<b>${time}</b> · паста <b>${grams}</b>`
      +(warnings.length?'<br>'+warnings.map(w=>`<span class="${w.cls}">⚠ ${w.txt}</span>`).join('<br>')
      :'<br><span style="color:var(--ok)">✓ Технология печати соблюдена</span>');
    download(new Blob([text],{type:'text/plain'}), fileName(state,'gcode'));
    toast(`G-code сгенерирован: ${stats.layers} слоёв vase-спирали без ретракций`);
  };
}

export function initPanels(){
  buildPresets();
  S.height=hookSlider('heightSl','heightOut',v=>v.toFixed(1)+' см',v=>{state.H=v*10;emit();});
  S.diam=hookSlider('diamSl','diamOut',v=>v.toFixed(1)+' см',v=>{state.D=v*10;emit();});
  S.seg=hookSlider('segSl','segOut',v=>v+' сегм.',v=>{state.segments=v;emit();});
  S.rings=hookSlider('ringsSl','ringsOut',v=>v.toFixed(1)+' мм',v=>{state.rings=v;emit();});
  S.wall=hookSlider('thickSl','thickOut',v=>v.toFixed(1)+' мм',v=>{state.wall=v;emit();});
  S.footH=hookSlider('footHSl','footHOut',v=>v===0?'без ножки':v+' мм',v=>{state.footH=v;emit();});
  S.footK=hookSlider('footKSl','footKOut',v=>v+'%',v=>{state.footK=v;emit();});
  S.allow=hookSlider('allowSl','allowOut',v=>v+'%',v=>{state.allow=v;emit();});
  $('hollowChk').addEventListener('change',e=>{state.hollow=e.target.checked;emit();});
  buildClays();
  buildPrintPanel();
}

/* синхронизация UI с состоянием (после загрузки ДНК) */
export const panelsAPI = {
  sync(){
    S.height.sync(state.H/10);S.diam.sync(state.D/10);S.seg.sync(state.segments);S.rings.sync(state.rings);
    S.wall.sync(state.wall);S.footH.sync(state.footH);S.footK.sync(state.footK);S.allow.sync(state.allow);
    $('hollowChk').checked=state.hollow;
    S.nozzle.sync(state.pr.nozzle);S.layer.sync(state.pr.lh);S.feed.sync(state.pr.feed);
    S.cart.sync(state.pr.cart);S.flow.sync(state.pr.flow);S.tau.sync(state.pr.tau);
    $('printerSel').value=state.pr.printer;
    $('printerNote').textContent=PRINTERS[state.pr.printer].note;
    $('seedOut').textContent=state.seed;
    document.querySelectorAll('.preset').forEach((el,j)=>el.classList.toggle('active',j===state.activePreset));
    document.querySelectorAll('.swatch').forEach((el,j)=>el.classList.toggle('active',j===state.clay));
    document.querySelectorAll('#firingSeg button').forEach(b=>b.classList.toggle('active',b.dataset.f===state.firing));
    $('swatchName').textContent=`${CLAYS[state.clay].name} · усадка ${CLAYS[state.clay].shrink}% · CTE ${CLAYS[state.clay].cte}·10⁻⁶/°C`;
  }
};
