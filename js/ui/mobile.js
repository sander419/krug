// file: js/ui/mobile.js
// Телефонная раскладка: шапка прячет действия под «ещё», сцена переключается
// между моделью и чертежом, настройки живут в листе снизу с регулируемой высотой.
// На широком экране модуль ничего не делает — раскладка там прежняя, трёхколоночная.
import { setEditorMode } from './editor.js';
import { $ } from './dom.js';
import { clamp } from '../core/util.js';

const PHONE = '(max-width:940px)';
/* телефон боком: настройки уходят в правую колонку, высоту листа задавать нечему */
const SIDE  = '(max-width:940px) and (orientation:landscape) and (max-height:560px)';
const isPhone = () => matchMedia(PHONE).matches;
const isSheet = () => isPhone() && !matchMedia(SIDE).matches;

/* ---------- лист настроек ---------- */
const root = document.documentElement;
let peekH = 78;                       // ручка + строка вкладок

function measurePeek(){
  const grip = $('sheetGrip'), tabs = document.querySelector('.tabs');
  if(grip && tabs && grip.offsetHeight) peekH = grip.offsetHeight + tabs.offsetHeight;
  return peekH;
}
const maxSheet = () => Math.max(measurePeek() + 40, innerHeight - 250);
const defSheet = () => clamp(Math.round(innerHeight * 0.46), measurePeek() + 40, maxSheet());

function setSheet(px){
  if(!isSheet()){ root.style.removeProperty('--sheetH'); document.body.classList.remove('stage-tight'); return; }
  root.style.setProperty('--sheetH', Math.round(px) + 'px');
  markTight(px);
}

/* Когда лист вытянут почти во весь экран, сцене остаётся полоска — панель
   кинотеатра закрыла бы её целиком. В такой момент она уходит. */
function markTight(sheetPx){
  const head = document.querySelector('header'), met = $('metrics');
  const stage = innerHeight - (head ? head.offsetHeight : 0) - (met ? met.offsetHeight : 0) - sheetPx;
  document.body.classList.toggle('stage-tight', stage < 210);
}
function sheetH(){
  const p = $('panel');
  return p ? p.getBoundingClientRect().height : 0;
}
const isPeek = () => sheetH() <= measurePeek() + 12;

/** Развернуть лист — нужно, когда на него уводят из другого места интерфейса. */
export function openSheet(){
  if(!isSheet()) return;
  if(isPeek()) setSheet(defSheet());
}

function initSheet(){
  const grip = $('sheetGrip');
  if(!grip) return;

  let dragging = false, startY = 0, startH = 0, moved = 0;
  grip.addEventListener('pointerdown', e => {
    if(!isSheet()) return;
    dragging = true; startY = e.clientY; startH = sheetH(); moved = 0;
    try{ grip.setPointerCapture(e.pointerId); }catch(_){}
  });
  grip.addEventListener('pointermove', e => {
    if(!dragging) return;
    moved = Math.max(moved, Math.abs(e.clientY - startY));
    setSheet(clamp(startH - (e.clientY - startY), measurePeek(), maxSheet()));
  });
  const end = () => {
    if(!dragging) return;
    dragging = false;
    if(moved < 6) setSheet(isPeek() ? defSheet() : measurePeek());   // короткое касание — переключить
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);

  // вкладка на свёрнутом листе разворачивает его, а не молча меняет невидимое
  document.querySelector('.tabs').addEventListener('click', () => openSheet(), true);

  // «режим мастерской» на телефоне сворачивает лист: прятать его целиком некуда
  const ws = $('wsBtn');
  if(ws) ws.addEventListener('click', () => { if(isSheet()) setSheet(measurePeek()); }, true);
}

/* ---------- меню шапки ---------- */
function initMenu(){
  const btn = $('moreBtn'), menu = $('headMenu');
  if(!btn || !menu) return;
  const close = () => { document.body.classList.remove('menu-open'); btn.setAttribute('aria-expanded','false'); };
  btn.onclick = e => {
    e.stopPropagation();
    const on = document.body.classList.toggle('menu-open');
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  // любое действие внутри меню закрывает его: иначе оно закрывает собой сцену
  menu.addEventListener('click', e => { if(e.target.closest('button')) close(); });
  document.addEventListener('pointerdown', e => {
    if(document.body.classList.contains('menu-open') && !menu.contains(e.target) && e.target !== btn) close();
  });
  addEventListener('keydown', e => { if(e.key === 'Escape') close(); });
}

/* ---------- модель или чертёж ---------- */
function initStageSwitch(){
  const sw = $('stageSwitch');
  if(!sw) return;
  const btns = [...sw.querySelectorAll('button')];
  const show = v => {
    btns.forEach(b => b.classList.toggle('active', b.dataset.view === v));
    document.body.classList.toggle('view-draft', v === 'draft');
    // чертёж во весь экран: масштаб 1:1 с моделью здесь не к чему привязывать
    if(isPhone()) setEditorMode(v === 'draft' ? 'fit' : '1:1');
  };
  btns.forEach(b => b.onclick = () => show(b.dataset.view));
}

export function initMobile(){
  initMenu();
  initSheet();
  initStageSwitch();
  setSheet(defSheet());

  // поворот экрана и переход на широкий экран: пересчитать или отдать раскладку CSS
  const relayout = () => {
    document.body.classList.remove('menu-open');
    if(isSheet()) setSheet(defSheet());
    else{ root.style.removeProperty('--sheetH'); document.body.classList.remove('stage-tight'); }
  };
  matchMedia(PHONE).addEventListener('change', relayout);
  matchMedia(SIDE).addEventListener('change', relayout);
  addEventListener('resize', () => {
    if(!isSheet()) return;
    setSheet(clamp(sheetH(), measurePeek(), maxSheet()));
  });
}
