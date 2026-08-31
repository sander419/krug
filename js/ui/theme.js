// file: js/ui/theme.js
// Тема, цветовая схема и масштаб интерфейса. Тема хранится тремя состояниями:
// «как в системе», светлая, тёмная — иначе человек, у которого система
// переключается по времени суток, не может закрепить нужную. Масштаб —
// отдельная ручка: на большом мониторе шрифт увеличивают, не трогая зум
// браузера, чтобы 3D-вид не мельчал.
//
// Цветовая схема — вторая ось, независимая от темы: тема решает, светло или
// темно, схема — какого цвета мастерская. Обе выражаются атрибутами корня
// (`data-theme`, `data-skin`) и обе задают одни и те же токены, поэтому ни
// вёрстке, ни canvas-палитре не нужно знать, что схем стало больше.
import { $ } from './dom.js';
import { icon } from './icons.js';

const KEY_THEME = 'krug.theme', KEY_UI = 'krug.ui', KEY_SKIN = 'krug.skin';
const MODES = ['system', 'light', 'dark'];
const LABEL = {system: 'как в системе', light: 'светлая', dark: 'тёмная'};
const ICON = {system: 'monitor', light: 'sun', dark: 'moon'};
const STEPS = [0.9, 1, 1.12, 1.26, 1.42];

/* Схемы. `clay` — исходные токены из `:root`, поэтому у неё нет своего блока
   в стилях и атрибут для неё не ставится: схема по умолчанию не должна
   зависеть от того, дожил ли скрипт до конца. */
export const SKINS = [
  {id: 'clay',     name: 'Мастерская', what: 'терракота и графит'},
  {id: 'celadon',  name: 'Селадон',    what: 'холодная зелень черепка'},
  {id: 'cobalt',   name: 'Кобальт',    what: 'синий по белому, гжель'},
  {id: 'graphite', name: 'Графит',     what: 'нейтральная сталь без своего цвета'},
];

const listeners = new Set();
let mode = 'system', step = 1, skin = 'clay';

const sysDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
/** Какая тема сейчас на самом деле: 'light' | 'dark'. */
export const currentTheme = () => (mode === 'system' ? (sysDark() ? 'dark' : 'light') : mode);
/** Какая схема выбрана: id из SKINS. */
export const currentSkin = () => skin;
export function onTheme(fn) { listeners.add(fn); }

function store(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
function load(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

function apply() {
  const root = document.documentElement;
  /* Ставим не выбранный режим, а тот, который получился: в режиме «как
     в системе» стилям нужно знать ответ, а не вопрос. Пока атрибут снимался,
     светлая система получала тёмный интерфейс и светлую сцену разом. */
  root.setAttribute('data-theme', currentTheme());
  if (skin === 'clay') root.removeAttribute('data-skin');
  else root.setAttribute('data-skin', skin);
  root.style.setProperty('--ui', STEPS[step]);

  const b = $('themeBtn');
  if (b) {
    b.innerHTML = icon(ICON[mode]);
    b.title = `Тема: ${LABEL[mode]} — нажмите, чтобы сменить`;
    b.setAttribute('aria-label', `Тема: ${LABEL[mode]}`);
  }
  /* Цвет строки браузера берём из самого токена, а не из копии: копия
     разъезжается с темой в первый же раз, когда меняют палитру. */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
  for (const b of document.querySelectorAll('[data-skin-pick]')) {
    const on = b.dataset.skinPick === skin;
    b.classList.toggle('current', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const down = $('uiDownBtn'), up = $('uiUpBtn');
  if (down) down.disabled = step === 0;
  if (up) up.disabled = step === STEPS.length - 1;

  for (const fn of listeners) fn(currentTheme());
}

/** Сменить цветовую схему. */
export function setSkin(id) {
  if (!SKINS.some(s => s.id === id)) return;
  skin = id;
  store(KEY_SKIN, skin);
  apply();
}

export function initTheme() {
  const savedTheme = load(KEY_THEME);
  if (MODES.includes(savedTheme)) mode = savedTheme;
  const savedSkin = load(KEY_SKIN);
  if (SKINS.some(s => s.id === savedSkin)) skin = savedSkin;
  const savedUI = load(KEY_UI);
  if (savedUI !== null && STEPS[+savedUI] !== undefined) step = +savedUI;

  const b = $('themeBtn');
  if (b) b.onclick = () => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    store(KEY_THEME, mode);
    apply();
  };
  const bump = d => {
    step = Math.min(STEPS.length - 1, Math.max(0, step + d));
    store(KEY_UI, step);
    apply();
  };
  if ($('uiDownBtn')) $('uiDownBtn').onclick = () => bump(-1);
  if ($('uiUpBtn')) $('uiUpBtn').onclick = () => bump(1);

  /* Ряд схем собирается из реестра: добавить схему — значит дописать её
     в SKINS и блок токенов в styles.css, разметку трогать не нужно. */
  const row = $('skinRow');
  if (row) {
    row.innerHTML = SKINS.map(s => `<button class="skin-dot" data-skin-pick="${s.id}"
      data-keep-open type="button" title="${s.name}: ${s.what}" aria-label="Схема: ${s.name}"
      ><i class="skin-swatch" data-skin-swatch="${s.id}"></i><span>${s.name}</span></button>`).join('');
    row.querySelectorAll('[data-skin-pick]').forEach(b => {
      b.onclick = () => setSkin(b.dataset.skinPick);
    });
  }

  // система переключилась по времени суток — идём за ней, но только в режиме «как в системе»
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (mode === 'system') apply();
  });
  apply();
}
