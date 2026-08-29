// file: js/ui/overlays.js
import { state } from '../core/state.js';
import { sceneAPI } from '../three/scene.js';
import { STAGES } from '../config/data.js';
import { byId } from '../config/materials.js';
import { openContextHelp } from './kb.js';
import { atLevel } from '../core/math.js';
import { $ } from './dom.js';
import { icon, paintIcons } from './icons.js';
import { openSheet } from './mobile.js';

let worstHelp=null;   // статья, которую открывает бейдж вердикта

export function toast(msg){
  const t=$('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),3000);
}

export function updateStats(prod,str,tris){
  const sh=byId(state.mat).shrinkPct;
  const Hs=(state.H/10).toFixed(1),Ds=(state.D/10).toFixed(1);
  const Hf=(state.H*(1-sh/100)/10).toFixed(1),Df=(state.D*(1-sh/100)/10).toFixed(1);
  const fmtG=g=>g>=1000?(g/1000).toFixed(2)+' кг':Math.round(g)+' г';
  const sfCls=str.minSF<1.5?'bad':str.minSF<2.5?'warn':'ok';
  $('stats').innerHTML=`
    <div class="chip"><span class="k">Габариты · круг</span><b>${Hs}×${Ds} см</b></div>
    <div class="chip"><span class="k">Габариты · обжиг</span><b>${Hf}×${Df} см</b></div>
    <div class="chip"><span class="k">Вместимость</span><b>${state.hollow?Math.round(prod.capMl)+' мл':'— сплошная'}</b></div>
    <div class="chip"><span class="k">Объём глины</span><b>${Math.round(prod.volMl)} см³</b></div>
    <div class="chip"><span class="k">Глина нужна</span><b>${fmtG(prod.massN)}</b></div>
    <div class="chip"><span class="k">Масса изделия</span><b>${fmtG(prod.massF)}</b></div>
    <div class="chip"><span class="k">Возврат в шамот</span><b>${fmtG(prod.waste)}</b></div>
    <div class="chip"><span class="k">Устойчивость</span><b>${prod.angle.toFixed(0)}°</b></div>
    <div class="chip"><span class="k">Прочность стенки</span><b class="${sfCls}">${str.minSF.toFixed(1)}× · ${atLevel(str.minY)}</b></div>
    <div class="chip"><span class="k">Полигоны</span><b>${Math.round(tris).toLocaleString('ru')}</b></div>`;
}
export function updateWarnings(list){
  $('warnList').innerHTML=list.map(w=>
    `<div class="warn-item ${w.lvl}">${icon(w.lvl==='ok'?'circle-check':'circle-alert',16)}<span>${w.txt}</span>`+
    (w.help?`<button class="why" data-help="${w.help}" title="Открыть статью">почему</button>`:'')+
    `</div>`).join('');
  $('warnList').querySelectorAll('[data-help]').forEach(b=>{
    b.onclick=()=>openContextHelp(b.dataset.help);
  });
  // главный вердикт дублируем в 3D-вид: внизу панели его не видно
  const worst=list.find(w=>w.lvl==='bad')||list.find(w=>w.lvl==='warn')||list[0];
  worstHelp=worst&&worst.help||null;
  const b=$('verdictBadge');
  if(!worst){b.className='';return;}
  const more=list.length>1?` <span style="opacity:.6">ещё ${list.length-1}</span>`:'';
  b.innerHTML=icon(worst.lvl==='ok'?'circle-check':'circle-alert',15)+`<span>${worst.txt}${more}</span>`;
  b.className='on '+worst.lvl;
}

export function setStageUI(){
  const k=Math.min(6,Math.round(state.stage));
  $('stageName').textContent=STAGES[k];
  $('stageNum').textContent=`этап ${k} / 6 · ${k<6?'глина на круге':'усадка −'+byId(state.mat).shrinkPct+'%'}`;
}
export function setCinemaSlider(v){
  const sl=$('stageSl');
  sl.value=v;
  sl.style.setProperty('--fill',(v/6*100)+'%');
}
export function syncPlayIcon(){
  $('playIco').innerHTML=icon(state.playing?'pause':'play',20);
}
export function initCinema(refreshNow){
  $('stageSl').addEventListener('input',()=>{
    state.playing=false;syncPlayIcon();
    state.stage=parseFloat($('stageSl').value);
    refreshNow();setStageUI();
  });
  $('playBtn').addEventListener('click',()=>{
    if(state.playing)state.playing=false;
    else{
      if(state.stage>=5.98)state.stage=0;
      state.playing=true;
    }
    syncPlayIcon();
  });
  $('stageSl').value=state.stage;
  setStageUI();
  syncPlayIcon();      // значок рисуется набором, а не лежит в разметке
}

export function initTools(refreshNow){
  $('spinBtn').onclick=e=>{state.spin=!state.spin;e.currentTarget.classList.toggle('active',state.spin);};
  $('wireBtn').onclick=e=>{state.wire=!state.wire;sceneAPI.clayMaterial().wireframe=state.wire;e.currentTarget.classList.toggle('active',state.wire);};
  $('heatBtn').onclick=e=>{
    state.heatmap=!state.heatmap;
    e.currentTarget.classList.toggle('active',state.heatmap);
    sceneAPI.applyMaterial(state);
    refreshNow();
    toast(state.heatmap?'Карта прочности: зелёный ≥3× · жёлтый 1.5–3× · красный <1.5× запаса':'Анализ прочности выключен');
  };
  $('resetBtn').onclick=()=>sceneAPI.frameView();
  $('zoomInBtn').onclick=()=>sceneAPI.zoomBy(1.25);
  $('zoomOutBtn').onclick=()=>sceneAPI.zoomBy(1/1.25);
  $('fitBtn').onclick=()=>sceneAPI.refit();
  // те же действия с клавиатуры: руки на клавишах, мышь на форме
  addEventListener('keydown',e=>{
    if(e.metaKey||e.ctrlKey||e.altKey)return;
    if(e.target instanceof Element && e.target.matches('input,select,textarea'))return;
    if(e.key==='+'||e.key==='=') sceneAPI.zoomBy(1.25);
    else if(e.key==='-'||e.key==='_') sceneAPI.zoomBy(1/1.25);
    else if(e.key==='0') sceneAPI.refit();
  });
  $('verdictBadge').onclick=()=>{
    if(worstHelp){ openContextHelp(worstHelp); return; }
    if(document.body.classList.contains('ws')) $('wsBtn').click();
    openSheet();
    $('warnList').scrollIntoView({behavior:'smooth',block:'center'});
  };
  $('wsBtn').onclick=e=>{
    document.body.classList.toggle('ws');
    e.currentTarget.classList.toggle('active');
    sceneAPI.resize();
  };
}
