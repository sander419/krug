// file: js/main.js
// Точка сборки: инициализация, пакетная пересборка, цикл рендера, ДНК.
import * as THREE from 'three';
import { state, encodeDNA, applyDNAFromHash, applyDNA } from './core/state.js';
import { onChange, emit } from './core/bus.js';
import { initHistory, record, undo, redo, canUndo, canRedo } from './core/history.js';
import { computeProduction, computeStrength, computeWarnings } from './core/math.js';
import { byId } from './config/materials.js';
import { sceneAPI } from './three/scene.js';
import { exportSTL, exportOBJ, exportGLB, snapshot } from './three/exporters.js';
import { initEditor, drawEditor, syncEditorScale } from './ui/editor.js';
import { initMobile } from './ui/mobile.js';
import { initLayout } from './ui/layout.js';
import { initGuide } from './ui/guide.js';
import { initPhoto } from './ui/photo.js';
import { initRoute, activeRoute, onRoute } from './ui/route.js';
import { initWorks } from './ui/works.js';
import { paintIcons } from './ui/icons.js';
import { initTheme, onTheme } from './ui/theme.js';
import { initEnvironment } from './ui/environment.js';
import { resetPalette } from './ui/palette.js';
import { initPanels, initTabs, initBlocks, panelsAPI } from './ui/panels.js';
import { initParts, updateMechanics } from './ui/parts.js';
import { initGlazeLab, syncGlaze, updateCoatPanel } from './ui/glazeLab.js';
import { coatWarnings } from './core/glazeCoat.js';
import { byGlazeId } from './config/glazes.js';
import { initLibrary, syncLibrary } from './ui/library.js';
import { initKB, openKB } from './ui/kb.js';
import { initTooling } from './ui/tooling.js';
import { toast, updateStats, updateWarnings, setStageUI, setCinemaSlider, syncPlayIcon, initCinema, initTools } from './ui/overlays.js';
import { $ } from './ui/dom.js';


/* ---------- пакетная пересборка (один rAF на серию изменений) ---------- */
let rafPending=false;
function refreshNow(){
  const str=computeStrength(state);
  const {tris}=sceneAPI.rebuild(state,str);
  const prod=computeProduction(state);
  updateStats(prod,str,tris);
  // замечания по глазури зависят от формы, поэтому считаются после пересборки
  let warn=computeWarnings(state,prod,str);
  if(state.firing==='glaze'){
    const cw=coatWarnings(byGlazeId(state.glazeId), sceneAPI.coatStats()||{runMax:1,sharpest:0});
    if(cw.length) warn=warn.filter(w=>w.lvl!=='ok').concat(cw);
  }
  // замечание по спрятанному инструменту — шум: тому, кто лепит руками,
  // нечего делать с запасом прочности при печати
  const tabs=activeRoute().tabs;
  updateWarnings(warn.filter(w=>!w.area||tabs.includes(w.area)));
  updateCoatPanel();
  updateMechanics();
  drawEditor();
  scheduleHash();
}
function scheduleRefresh(){
  if(rafPending)return;
  rafPending=true;
  requestAnimationFrame(()=>{rafPending=false;refreshNow();});
}

/* ---------- отмена ---------- */
/* После отката рецепт поменялся весь сразу, поэтому панель, библиотека и глазурь
   перечитывают state целиком — точечных обновлений тут не хватит. */
function syncAll(){
  $('nameInput').value=state.name;
  panelsAPI.sync();
  syncLibrary();
  syncGlaze();
  sceneAPI.applyMaterial(state);
  emit();
}
function syncHistoryButtons(){
  $('undoBtn').disabled=!canUndo();
  $('redoBtn').disabled=!canRedo();
}

/* ---------- ДНК в URL и автосохранение ---------- */
/* Ссылка передаёт работу другому человеку, автосохранение возвращает её тому же:
   раньше закрытая вкладка означала потерю всего, если не догадаться скопировать ДНК. */
const AUTOSAVE='krug.work';
let hashTimer=null;
function scheduleHash(){
  clearTimeout(hashTimer);
  hashTimer=setTimeout(()=>{
    const dna=encodeDNA();
    history.replaceState(null,'','#dna='+dna);
    try{ localStorage.setItem(AUTOSAVE,dna); }catch(_){}
  },400);
}
/* Ссылка важнее автосохранения: по ней пришли смотреть конкретную форму. */
function restoreWork(){
  if(applyDNAFromHash()) return 'ссылка';
  let saved=null;
  try{ saved=localStorage.getItem(AUTOSAVE); }catch(_){}
  return saved && applyDNA(saved) ? 'автосохранение' : 'умолчание';
}
async function copyText(s){
  try{await navigator.clipboard.writeText(s);}
  catch(e){
    const ta=document.createElement('textarea');ta.value=s;document.body.appendChild(ta);
    ta.select();document.execCommand('copy');ta.remove();
  }
}

/* ---------- инициализация ---------- */
/* Каждый шаг в своей скорлупе. Один упавший модуль раньше уносил всю страницу:
   исключение обрывало main.js, и не оставалось ни кнопок, ни цикла рендера
   (так однажды это и случилось из-за ellipse() с отрицательным радиусом). */
const broken=[];
function step(name,fn){
  try{ fn(); }
  catch(e){ console.error(`КРУГ: сбой при инициализации «${name}»`,e); broken.push(name); }
}

step('сцена',()=>sceneAPI.init($('viewport')));
let restoredFrom='умолчание';
step('восстановление работы',()=>{restoredFrom=restoreWork();$('nameInput').value=state.name;});

step('чертёж',()=>initEditor($('profileCanvas'),(info,target)=>{
  // линия переопределяет высоту и диаметр: ползунки обязаны это показать
  if(!info){
    toast(target==='part' ? 'Линия не сложилась в прилеп — ведите её от стенки наружу'
                          : 'Линия не сложилась в профиль — проведите её от дна к кромке');
    return;
  }
  if(info.part){ toast(`${info.part} нарисована по чертежу: точек ${info.points}`); return; }
  panelsAPI.sync();
  toast(`Профиль нарисован: ${(info.H/10).toFixed(1)}×${(info.D/10).toFixed(1)} см, точек ${info.points}`
    + (info.squeezed?' · рисунок ужат под пределы 5…40 см':''));
}));
step('панель',()=>{initTabs();initBlocks();initPanels();initParts();panelsAPI.sync();});
step('задача',()=>initRoute());   // после вкладок: задача их и прячет
step('картинка',()=>initPhoto(info=>{
  if(!info){ toast('Файл не открылся как картинка'); return; }
  panelsAPI.sync();
  toast(`Обведено: ${(info.H/10).toFixed(1)}×${(info.D/10).toFixed(1)} см, точек ${info.points}`
    + (info.half?' · как половина сечения':''));
  sceneAPI.frameView();
}));
step('обучение',()=>initKB());
step('библиотека масс',()=>initLibrary());
step('оснастка',()=>initTooling());
step('глазурь',()=>{initGlazeLab();syncGlaze();});
sceneAPI.applyMaterial(state);
$('kbBtn').onclick=()=>openKB();
step('окружение',()=>initEnvironment());   // выбирается до темы: тема лишь пересобирает его
onTheme(t=>{                       // цвета canvas и сцены живут в тех же токенах
  resetPalette();
  sceneAPI.applyTheme(t);
  drawEditor();
  syncGlaze();
});
step('тема',()=>initTheme());   // подписка раньше вызова: иначе сцена не узнает тему при запуске
step('иконки',()=>paintIcons());
step('раскладка',()=>initLayout());
step('телефон',()=>initMobile());
step('кинотеатр',()=>initCinema(refreshNow));
step('подсказка',()=>initGuide());
step('работы',()=>initWorks(name=>{ syncAll(); syncHistoryButtons(); sceneAPI.frameView(); toast('Открыта работа «'+name+'»'); }));
step('инструменты вида',()=>initTools(refreshNow));

$('nameInput').addEventListener('input',e=>{state.name=e.target.value;scheduleHash();});
$('dnaBtn').onclick=()=>{
  copyText(location.origin+location.pathname+'#dna='+encodeDNA());
  toast('ДНК формы скопирована — рецепт передаётся ссылкой');
};
$('embedBtn').onclick=()=>{
  const url=location.origin+location.pathname+'#dna='+encodeDNA();
  copyText(`<iframe src="${url}" title="КРУГ — 3D-витрина" style="width:100%;height:620px;border:0;border-radius:12px" loading="lazy"></iframe>`);
  toast('Код встраивания 3D-витрины скопирован (headless-плеер для e-commerce)');
};
const shrinkNow=()=>byId(state.mat).shrinkPct;
$('stlBtn').onclick=()=>{exportSTL(state);toast('STL сохранён · сырой размер в мм, как печатать · после обжига −'+shrinkNow()+'%');};
$('objBtn').onclick=()=>{exportOBJ(state);toast('OBJ сохранён · сырой размер в мм');};
$('glbBtn').onclick=()=>exportGLB(state,()=>toast('GLB сохранён · вид как на экране, с учётом усадки'),()=>toast('Ошибка экспорта GLB'));
$('snapBtn').onclick=()=>snapshot(state,()=>toast('Снимок сохранён'));

let framed=false;
new ResizeObserver(()=>{
  sceneAPI.resize();
  if(!framed){framed=true;sceneAPI.frameView();}   // аспект известен только после раскладки
}).observe($('viewport'));
onRoute(()=>scheduleRefresh());   // сменили задачу — пересобрать список замечаний
onChange(scheduleRefresh);
onChange(record);
initHistory(syncHistoryButtons);
$('undoBtn').onclick=()=>{ if(undo()){ syncAll(); syncHistoryButtons(); toast('Отменено'); } };
$('redoBtn').onclick=()=>{ if(redo()){ syncAll(); syncHistoryButtons(); toast('Возвращено'); } };
addEventListener('keydown',e=>{
  // e.target может быть не элементом (document, window) — matches там нет
  if(!(e.ctrlKey||e.metaKey))return;
  if(e.target instanceof Element && e.target.matches('input,textarea,select'))return;
  const k=e.key.toLowerCase();
  if(k==='z'&&!e.shiftKey){ e.preventDefault(); $('undoBtn').click(); }
  else if((k==='z'&&e.shiftKey)||k==='y'){ e.preventDefault(); $('redoBtn').click(); }
});
refreshNow();
sceneAPI.frameView();
if(broken.length) toast('Не загрузилось: '+broken.join(', ')+'. Остальное работает.');
else if(restoredFrom==='автосохранение') toast('Вернулись к последней работе — «'+state.name+'»');

/* Ошибка в обработчике не должна оставлять человека наедине с замершим экраном. */
let told=false;
const complain=where=>{
  if(told)return; told=true;
  toast('Сбой в «'+where+'». Перезагрузите страницу; рецепт сохранён в адресной строке.');
};
addEventListener('error',e=>{ console.error('КРУГ:',e.error||e.message); complain('интерфейсе'); });
addEventListener('unhandledrejection',e=>{ console.error('КРУГ:',e.reason); complain('фоновой задаче'); });

/* ---------- цикл рендера ---------- */
const clock=new THREE.Clock();
(function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  if(state.playing){
    state.stage=Math.min(6,state.stage+dt*0.62);
    setCinemaSlider(state.stage);
    refreshNow();
    setStageUI();
    if(state.stage>=6){
      state.playing=false;syncPlayIcon();
      toast('Обжиг завершён: усадка −'+byId(state.mat).shrinkPct+'%');
    }
  }
  sceneAPI.spinStep(dt,state);
  sceneAPI.render();
  // чертёж пересчитывается только когда камера или модель сдвинулись:
  // проекция всего профиля в каждом кадре — заметная часть кадрового бюджета
  if(sceneAPI.consumeCamDirty()) syncEditorScale();
})();
