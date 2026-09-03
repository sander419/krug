// file: js/ui/overlays.js
import { state } from '../core/state.js';
import { sceneAPI } from '../three/scene.js';
import { STAGES } from '../config/data.js';
import { byId } from '../config/materials.js';
import { openContextHelp } from './kb.js';
import { atLevel } from '../core/math.js';
import { $, hintScroll, plural, esc } from './dom.js';
import { icon, paintIcons } from './icons.js';
import { openSheet } from './mobile.js';

let worstHelp=null;   // статья, которую открывает бейдж вердикта

/* Второй аргумент — сколько держать. Сообщение о починенной ссылке длиннее
   обычного и читается дольше: три секунды на него не хватает. */
export function toast(msg, ms){
  const t=$('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'), ms||3000);
}

export function updateStats(prod,str,tris){
  hintScroll($('stats'));           // первый вызов вешает слежение, дальше молчит
  const sh=byId(state.mat).shrinkPct;
  const Hs=(state.H/10).toFixed(1),Ds=(state.D/10).toFixed(1);
  const Hf=(state.H*(1-sh/100)/10).toFixed(1),Df=(state.D*(1-sh/100)/10).toFixed(1);
  const fmtG=g=>g>=1000?(g/1000).toFixed(2)+' кг':Math.round(g)+' г';
  const sfCls=str.minSF<1.5?'bad':str.minSF<2.5?'warn':'ok';
  /* Одиннадцать плашек говорили о четырёх вещах. «Габариты на круге» и
     «габариты после обжига» — одно число до и после усадки, и разница между
     ними и есть смысл: теперь они в одной плашке со стрелкой. То же с глиной:
     сколько взять и сколько останется. Объём, возврат и полигоны — инженерные,
     они уходят в расширенный вид. Осталось шесть приборов вместо одиннадцати. */
  $('stats').innerHTML=`
    <div class="chip" title="Размеры на круге и после обжига: усадка ${sh} %">
      <span class="k">Габариты, см</span>
      <b>${Hs}×${Ds} <span class="to">→</span> ${Hf}×${Df}</b></div>
    <div class="chip" title="${prod.cutBySpout?(prod.fillBy==='lip'?'Слив опускает кромку: выше него не налить':'Носик режет уровень налива: выше него не налить'):'До кромки'}">
      <span class="k">${prod.cutBySpout?'Наливается до '+(prod.fillBy==='lip'?'слива':'носика'):'Вместимость'}</span>
      <b>${state.hollow?Math.round(prod.cutBySpout?prod.fillMl:prod.capMl)+' мл':'сплошная'}</b></div>
    <div class="chip" title="Толщина стенки на круге и усадка выбранной массы">
      <span class="k">Стенка</span><b>${state.wall} мм <span class="to">·</span> −${sh} %</b></div>
    <div class="chip" title="Сколько глины взять и сколько весит готовое изделие">
      <span class="k">Глина <span class="to">→</span> изделие</span>
      <b>${fmtG(prod.massN)} <span class="to">→</span> ${fmtG(prod.massF)}</b></div>
    <div class="chip" title="Угол, при котором изделие опрокинется">
      <span class="k">Устойчивость</span><b>${prod.angle.toFixed(0)}°</b></div>
    <div class="chip" title="Запас прочности стенки при печати и где он самый малый">
      <span class="k">Прочность стенки</span>
      <b class="${sfCls}">${str.minSF.toFixed(1)}× <span class="to">·</span> ${atLevel(str.minY)}</b></div>
    <div class="chip" data-adv title="Сколько глины по объёму: стенка, дно и крышка вместе"><span class="k">Объём глины</span>
      <b>${Math.round(prod.volMl)} см³${prod.lidMl?` <span class="to">·</span> крышка ${Math.round(prod.lidMl)}`:''}</b></div>
    <div class="chip" data-adv title="Обрезки от подрезки ножки: их размалывают и возвращают в массу"><span class="k">Возврат в шамот</span><b>${fmtG(prod.waste)}</b></div>
    <div class="chip" data-adv title="Сколько треугольников в модели: на вес STL влияет напрямую, на расчёт — нет"><span class="k">Полигоны</span><b>${Math.round(tris).toLocaleString('ru')}</b></div>`;
}
/**
 * Список замечаний и готовность изделия.
 *
 * Готовность — не украшение и не пересчёт: она собрана из этого же списка,
 * ответа слайсера и габарита после обжига. Поэтому здесь она только
 * показывается, а считается в ядре (`core/readiness.js`).
 */
export function updateWarnings(list, ready){
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
  /* Раньше здесь повторялся текст худшего замечания — слово в слово тот же,
     что и в «Контроле мастера» на панели. Два одинаковых абзаца на одном экране
     съедали половину строки метрик и ничего не добавляли. Теперь это счётчик:
     сколько замечаний и сколько из них важных, а сам текст — в подсказке
     и на панели, куда ведёт нажатие. */
  const bad=list.filter(w=>w.lvl==='bad').length;
  /* Счётчик в заголовке: свёрнутые замечания не должны исчезать бесследно. */
  const c=$('warnCount');
  if(c){
    const k=list.filter(w=>w.lvl!=='ok').length;
    c.textContent = k ? `${k} ${plural(k,'замечание','замечания','замечаний')}` : 'всё чисто';
    c.className='foot-count '+(bad?'bad':k?'warn':'ok');
  }
  /* Статус готовности говорит то, чего не скажет счётчик замечаний: можно ли
     это отдавать в работу. Причины он не выдумывает — они те же, что в списке
     ниже, поэтому нажатие просто открывает список. */
  const st=$('readyBadge');
  if(st&&ready){
    st.className='ready-badge '+ready.tone;
    st.innerHTML=icon(ready.tone==='ok'?'circle-check':ready.tone==='bad'?'circle-alert':'info',15)
      +`<span>${esc(ready.name)}</span>`
      +(ready.reasons.length?`<i>${ready.reasons.length}</i>`:'');
    st.title=ready.what+(ready.reasons.length?'\n\n'+ready.reasons.slice(0,4)
      .map(r=>`• ${r.where}: ${r.txt}`).join('\n'):'');
    st.setAttribute('aria-label',ready.name+'. '+ready.what);
  }
  const cnt=list.filter(w=>w.lvl!=='ok').length;
  const label = !cnt ? 'Мастер одобряет'
    : `${cnt} ${plural(cnt,'замечание','замечания','замечаний')}` + (bad?` · ${bad} ${plural(bad,'важное','важных','важных')}`:'');
  b.innerHTML=icon(cnt?'circle-alert':'circle-check',15)+`<span>${label}</span>`;
  b.className='on '+worst.lvl;
  b.title=cnt?worst.txt:'Форма технологична и устойчива — нажмите, чтобы открыть список';
  b.setAttribute('aria-label',label+'. '+(cnt?worst.txt:''));
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
