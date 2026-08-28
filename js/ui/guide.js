// file: js/ui/guide.js
// Экран «как здесь работать»: пять шагов и что на каждом делают.
//
// Новичок открывал КРУГ и видел пять вкладок без порядка и без объяснения, зачем
// они. Панель показывала «что можно покрутить», но не «с чего начать и чем это
// кончится». Шаги повторяют вкладки один в один, поэтому подсказка не живёт
// отдельной жизнью: нажал шаг — открылась та самая вкладка.
//
// Показывается один раз, дальше — по кнопке в шапке. Согласия ни у кого не
// спрашиваем и работать не мешаем: это подсказка, а не мастер настройки.
import { $ } from './dom.js';
import { icon } from './icons.js';
import { showOverview } from './kb.js';

const KEY = 'krug.guided';

export const STEPS = [
  {tab: 'form',  ico: 'circle-dot', name: 'Форма',
   txt: 'Возьмите пресет или тяните точки на чертеже. Высота и диаметр — как на круге, до обжига.'},
  {tab: 'mat',   ico: 'layers', name: 'Масса',
   txt: 'Выберите керамическую массу: от неё усадка, цвет черепка и температура обжига.'},
  {tab: 'print', ico: 'printer', name: 'Печать',
   txt: 'Проверьте, выдержит ли стенка печать глиной, и заберите G-code.'},
  {tab: 'glaze', ico: 'droplet', name: 'Глазурь',
   txt: 'Подберите глазурь: КРУГ сверит её обжиг с массой и покажет плёнку на модели.'},
  {tab: 'tool',  ico: 'factory', name: 'Оснастка',
   txt: 'Если нужен тираж — посмотрите, годится ли форма под штамповку или литьё и что это стоит.'},
];

function html() {
  const steps = STEPS.map((s, i) => `
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
    <p class="guide-lead">КРУГ считает изделие целиком: от комка глины на круге до цены тиража.
      Пять шагов — это пять вкладок панели, идти по ним подряд не обязательно.</p>
    <div class="guide-steps">${steps}</div>
    <div class="guide-foot">
      <button class="btn primary" id="guideStart">Начать с формы</button>
      <button class="btn" id="guideLearn">${icon('graduation-cap')}Открыть обучение</button>
      <span class="guide-hint">Вернуться к этой подсказке — кнопка «?» в шапке</span>
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
  $('guideStart').onclick = () => { openTab('form'); closeGuide(); };
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
  let seen = null;
  try { seen = localStorage.getItem(KEY); } catch (_) {}
  if (!seen) openGuide();
}
