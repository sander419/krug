// file: js/ui/route.js
// Экран «что вы делаете» и сборка панели под ответ.
//
// Показывается первым — до того, как человек увидит пять вкладок. Выбор
// запоминается и в рецепт не входит: это настройка рабочего места, а не
// свойство изделия. Поэтому ссылка-ДНК открывается в той задаче, которую
// выбрал тот, кто по ней пришёл.
//
// Задача только прячет лишнее. Ни одно число от неё не меняется: и осадка,
// и оснастка считаются всегда — просто их не показывают тому, кто их не просил.
import { $ } from './dom.js';
import { icon } from './icons.js';
import { ROUTES, TABS, DEFAULT_ROUTE, routeById, routeTabs } from '../config/routes.js';
import { showTab, currentTab } from './panels.js';
import { toast } from './overlays.js';

const KEY = 'krug.route';
let current = routeById(DEFAULT_ROUTE);
const subs = [];

/** Текущая задача. До инициализации — «всё сразу», чтобы ничего не пропало. */
export const activeRoute = () => current;

/** Подписка на смену задачи; вызывается сразу с текущей. */
export function onRoute(fn) { subs.push(fn); fn(current); }

/* ---------- применение ---------- */
export function applyRoute(id, opts = {}) {
  const r = routeById(id) || routeById(DEFAULT_ROUTE);
  current = r;
  if (opts.remember !== false) { try { localStorage.setItem(KEY, r.id); } catch (_) {} }
  document.body.dataset.route = r.id;

  const tabs = routeTabs(r);
  document.querySelectorAll('.tab').forEach(t => {
    const on = tabs.includes(t.dataset.tab);
    t.hidden = !on;
    const num = t.querySelector('i');
    if (num && on) num.textContent = tabs.indexOf(t.dataset.tab) + 1;
  });
  // открытая вкладка обязана быть из набора, иначе панель окажется пустой
  if (!tabs.includes(currentTab())) showTab(tabs[0]);

  // подзаголовок в шапке — это путь выбранной задачи, а не общий девиз:
  // человеку с тремя вкладками незачем читать про оснастку
  const sub = document.querySelector('.brand-sub');
  if (sub) sub.textContent = tabs.map(t => TABS[t].name.toLowerCase()).join(' → ');

  const chip = $('routeBtn');
  if (chip) {
    chip.innerHTML = icon(r.ico, 15) + `<span class="btn-label">${r.name}</span>`;
    chip.title = `Задача: ${r.name}. Нажмите, чтобы сменить`;
  }
  subs.forEach(fn => fn(r));
}

/* ---------- экран выбора ---------- */
function cardsHTML(first) {
  const cards = ROUTES.map(r => {
    const steps = routeTabs(r).map(t => TABS[t].name).join(' → ');
    return `<button class="route-card${r.id === current.id && !first ? ' current' : ''}" data-route-pick="${r.id}">
      <span class="route-ico">${icon(r.ico, 20)}</span>
      <span class="route-main">
        <b>${r.name}</b>
        <span class="route-lead">${r.lead}</span>
        <span class="route-steps">${steps}</span>
        <span class="route-hides">${r.hides}</span>
      </span>
    </button>`;
  }).join('');
  return `<div class="route-card-box" role="dialog" aria-label="Что вы делаете">
    <div class="guide-head">
      <h2>${first ? 'Что вы делаете?' : 'Сменить задачу'}</h2>
      ${first ? '' : `<button class="btn icon" id="routeClose" title="Закрыть (Esc)" aria-label="Закрыть">${icon('x')}</button>`}
    </div>
    <p class="guide-lead">КРУГ считает изделие целиком — от комка глины до цены тиража, но сразу всё
      никому не нужно. Выберите задачу: инструменты под неё останутся, лишние уйдут.
      Сменить можно в любой момент, кнопкой в шапке — ничего не пропадёт.</p>
    <div class="route-cards">${cards}</div>
    <p class="guide-hint">Задача не меняет расчёт: осадка и оснастка считаются всегда, просто не мозолят глаза.</p>
  </div>`;
}

export function openRouteScreen(first = false) {
  const box = $('routeScreen');
  if (!box) return;
  box.innerHTML = cardsHTML(first);
  box.dataset.first = first ? '1' : '0';   // первый выбор закрыть некому: панель пуста
  box.classList.add('open');
  box.setAttribute('aria-hidden', 'false');
  box.querySelectorAll('[data-route-pick]').forEach(b => {
    b.onclick = () => {
      box.dataset.first = '0';
      applyRoute(b.dataset.routePick);
      closeRouteScreen();
      toast(`Задача: ${activeRoute().name}. Сменить — кнопкой в шапке`);
    };
  });
  const x = $('routeClose');
  if (x) x.onclick = closeRouteScreen;
}

export function closeRouteScreen() {
  const box = $('routeScreen');
  if (!box) return;
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
}

export function initRoute() {
  const btn = $('routeBtn');
  if (btn) btn.onclick = () => openRouteScreen(false);
  const box = $('routeScreen');
  if (box) box.addEventListener('click', e => {
    // первый выбор закрывать некуда: пока задачи нет, панель собирать не из чего
    if (e.target === box && box.dataset.first !== '1') closeRouteScreen();
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && box && box.classList.contains('open') && box.dataset.first !== '1')
      closeRouteScreen();
  });

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) {}
  if (routeById(saved)) { applyRoute(saved); return false; }

  applyRoute(DEFAULT_ROUTE, {remember: false});
  openRouteScreen(true);
  return true;                       // первый запуск: задачу ещё не выбирали
}
