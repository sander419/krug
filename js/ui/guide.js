// file: js/ui/guide.js
// Экран «как здесь работать»: шаги выбранной задачи и что на каждом делают.
//
// Новичок открывал КРУГ и видел пять вкладок без порядка и без объяснения, зачем
// они. Панель показывала «что можно покрутить», но не «с чего начать и чем это
// кончится». Шаги повторяют вкладки один в один, поэтому подсказка не живёт
// отдельной жизнью: нажал шаг — открылась та самая вкладка.
//
// Шаги берутся из задачи: тому, кто лепит руками, не показывают слайсер даже
// в подсказке. Тексты вкладок лежат в js/config/routes.js — там же, где задачи,
// чтобы подсказка и панель не разъезжались.
//
// Показывается по кнопке в шапке; на первом запуске вместо неё спрашивают
// задачу. Согласия ни у кого не спрашиваем и работать не мешаем.
import { $ } from './dom.js';
import { icon } from './icons.js';
import { showOverview } from './kb.js';
import { TABS, routeTabs } from '../config/routes.js';
import { activeRoute, openRouteScreen } from './route.js';

const KEY = 'krug.guided';

/** Шаги текущей задачи: вкладка, иконка, имя, строка о деле. */
export const steps = () => routeTabs(activeRoute()).map(t => ({tab: t, ...TABS[t]}));

function html() {
  const route = activeRoute();
  const list = steps();
  const steps_ = list.map((s, i) => `
    <button class="guide-step" data-tab="${s.tab}">
      <span class="guide-num">${i + 1}</span>
      <span class="guide-main">
        <b>${icon(s.ico, 15)}${s.name}</b>
        <span>${s.txt}</span>
      </span>
    </button>`).join('');
  return `<div class="guide-card" role="dialog" aria-label="Как здесь работать">
    <div class="guide-head">
      <h2>Как здесь работать</h2>
      <button class="btn icon" id="guideClose" title="Закрыть (Esc)" aria-label="Закрыть">${icon('x')}</button>
    </div>
    <p class="guide-lead">Задача — <b>${route.name}</b>. ${route.lead}
      Шаги ниже это вкладки панели, идти по ним подряд не обязательно.</p>
    <div class="guide-steps">${steps_}</div>
    <div class="guide-foot">
      <button class="btn primary" id="guideStart">Начать с шага «${list[0].name}»</button>
      <button class="btn" id="guideRoute">${icon(route.ico)}Сменить задачу</button>
      <button class="btn" id="guideLearn">${icon('graduation-cap')}Открыть обучение</button>
      <span class="guide-hint">Кнопка «?» в шапке вернёт эту подсказку, <kbd>Ctrl</kbd>+<kbd>K</kbd> — поиск по инструменту</span>
    </div>
  </div>`;
}

function openTab(tab) {
  const b = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (b) b.click();
}

export function openGuide() {
  const g = $('guide');
  g.innerHTML = html();
  g.classList.add('open');
  g.setAttribute('aria-hidden', 'false');
  g.querySelectorAll('[data-tab]').forEach(b => {
    b.onclick = () => { openTab(b.dataset.tab); closeGuide(); };
  });
  $('guideClose').onclick = closeGuide;
  $('guideStart').onclick = () => { openTab(steps()[0].tab); closeGuide(); };
  $('guideRoute').onclick = () => { closeGuide(); openRouteScreen(false); };
  $('guideLearn').onclick = () => { closeGuide(); showOverview(); };
}

export function closeGuide() {
  const g = $('guide');
  g.classList.remove('open');
  g.setAttribute('aria-hidden', 'true');
  try { localStorage.setItem(KEY, '1'); } catch (_) {}
}

export function initGuide() {
  const btn = $('guideBtn');
  if (btn) btn.onclick = openGuide;
  $('guide').addEventListener('click', e => { if (e.target.id === 'guide') closeGuide(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('guide').classList.contains('open')) closeGuide();
  });
  // На самом первом запуске спрашивают задачу — двух окон подряд не бывает.
  let seen = null, route = null;
  try { seen = localStorage.getItem(KEY); route = localStorage.getItem('krug.route'); } catch (_) {}
  if (!seen && route) openGuide();
}
