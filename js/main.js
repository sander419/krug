// file: js/main.js
// Точка сборки: инициализация, пакетная пересборка, цикл рендера, ДНК.
import * as THREE from 'three';
import { state, encodeDNA, applyDNAFromHash } from './core/state.js';
import { onChange } from './core/bus.js';
import { computeProduction, computeStrength, computeWarnings } from './core/math.js';
import { byId } from './config/materials.js';
import { sceneAPI } from './three/scene.js';
import { exportSTL, exportOBJ, exportGLB, snapshot } from './three/exporters.js';
import { initEditor, drawEditor, syncEditorScale } from './ui/editor.js';
import { initMobile } from './ui/mobile.js';
import { initPanels, initTabs, initBlocks, panelsAPI } from './ui/panels.js';
import { initGlazeLab, syncGlaze } from './ui/glazeLab.js';
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
  updateWarnings(computeWarnings(state,prod,str));
  drawEditor();
  scheduleHash();
}
function scheduleRefresh(){
  if(rafPending)return;
  rafPending=true;
  requestAnimationFrame(()=>{rafPending=false;refreshNow();});
}

/* ---------- ДНК в URL ---------- */
let hashTimer=null;
function scheduleHash(){
  clearTimeout(hashTimer);
  hashTimer=setTimeout(()=>history.replaceState(null,'','#dna='+encodeDNA()),400);
}
async function copyText(s){
  try{await navigator.clipboard.writeText(s);}
  catch(e){
    const ta=document.createElement('textarea');ta.value=s;document.body.appendChild(ta);
    ta.select();document.execCommand('copy');ta.remove();
  }
}

/* ---------- инициализация ---------- */
sceneAPI.init($('viewport'));
applyDNAFromHash();
$('nameInput').value=state.name;

initEditor($('profileCanvas'));
initTabs();
initBlocks();
initPanels();
panelsAPI.sync();
initKB();
initLibrary();
initTooling();
initGlazeLab();
syncGlaze();
sceneAPI.applyMaterial(state);
$('kbBtn').onclick=()=>openKB();
initMobile();
initCinema(refreshNow);
initTools(refreshNow);

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
  if(!framed){framed=true;sceneAPI.frameView(state);}   // аспект известен только после раскладки
}).observe($('viewport'));
onChange(scheduleRefresh);
refreshNow();
sceneAPI.frameView(state);

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
  syncEditorScale();      // чертёж держит масштаб 3D-вида
})();
