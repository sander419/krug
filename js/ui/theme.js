// file: js/ui/theme.js
// Тема и масштаб интерфейса. Тема хранится тремя состояниями: «как в системе»,
// светлая, тёмная — иначе человек, у которого система переключается по времени
// суток, не может закрепить нужную. Масштаб — отдельная ручка: на большом
// мониторе шрифт увеличивают, не трогая зум браузера, чтобы 3D-вид не мельчал.
import { $ } from './dom.js';
import { icon } from './icons.js';

const KEY_THEME = 'krug.theme', KEY_UI = 'krug.ui';
const MODES = ['system', 'light', 'dark'];
const LABEL = {system: 'как в системе', light: 'светлая', dark: 'тёмная'};
const ICON = {system: 'monitor', light: 'sun', dark: 'moon'};
const STEPS = [0.9, 1, 1.12, 1.26, 1.42];

const listeners = new Set();
let mode = 'system', step = 1;

const sysDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
/** Какая тема сейчас на самом деле: 'light' | 'dark'. */
export const currentTheme = () => (mode === 'system' ? (sysDark() ? 'dark' : 'light') : mode);
export function onTheme(fn) { listeners.add(fn); }

function store(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
function load(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

function apply() {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  root.style.setProperty('--ui', STEPS[step]);

  const b = $('themeBtn');
  if (b) {
    b.innerHTML = icon(ICON[mode]);
    b.title = `Тема: ${LABEL[mode]} — нажмите, чтобы сменить`;
    b.setAttribute('aria-label', `Тема: ${LABEL[mode]}`);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', currentTheme() === 'dark' ? '#171310' : '#ece4d8');
  const down = $('uiDownBtn'), up = $('uiUpBtn');
  if (down) down.disabled = step === 0;
  if (up) up.disabled = step === STEPS.length - 1;

  for (const fn of listeners) fn(currentTheme());
}

export function initTheme() {
  const savedTheme = load(KEY_THEME);
  if (MODES.includes(savedTheme)) mode = savedTheme;
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

  // система переключилась по времени суток — идём за ней, но только в режиме «как в системе»
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (mode === 'system') apply();
  });
  apply();
}
