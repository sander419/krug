// file: js/ui/route.js
// Экран «что вы делаете» и сборка панели под ответ.
//
// Два вопроса, а не один. Сначала **кто перед инструментом** — мастер или
// мастерская: от этого зависит, какие задачи вообще показывать и насколько
// подробно говорить. Потом **что он сейчас делает** — задача, то есть набор
// вкладок. Ядро одно: ни профиль, ни задача не меняют ни одной формулы,
// они решают, что показать.
//
// Выбор запоминается и в рецепт не входит: это настройка рабочего места,
// а не свойство изделия. Поэтому ссылка-ДНК открывается в том профиле,
// который выбрал тот, кто по ней пришёл.
import { $ } from './dom.js';
import { icon } from './icons.js';
import { ROUTES, TABS, DEFAULT_ROUTE, routeById, routeTabs } from '../config/routes.js';
import { PROFILES, DEFAULT_PROFILE, profileById, profileRoutes } from '../config/profiles.js';
import { showTab, currentTab, openBlock } from './panels.js';
import { toast } from './overlays.js';

const KEY = 'krug.route';
const KEY_PROFILE = 'krug.profile';
const KEY_ADV = 'krug.advanced';

let current = routeById(DEFAULT_ROUTE);
let profile = profileById(DEFAULT_PROFILE);
let advanced = false;               // расширенный режим внутри простого профиля
let picking = null;                 // профиль, чьи задачи показаны на экране выбора
let stepTwo = false;                // на первом экране: профиль выбран, показываем задачи
const subs = [];

/** Текущая задача. До инициализации — «всё сразу», чтобы ничего не пропало. */
export const activeRoute = () => current;
/** Текущий профиль: мастер, мастерская или «показать всё». */
export const activeProfile = () => profile;
/** Простой вид: инженерные блоки спрятаны, пока не включён расширенный режим. */
export const isSimple = () => !!profile.simple && !advanced;

/** Подписка на смену задачи; вызывается сразу с текущей. */
export function onRoute(fn) { subs.push(fn); fn(current); }

/* ---------- применение ---------- */
function applyMode() {
  document.body.dataset.profile = profile.id;
  document.body.dataset.mode = isSimple() ? 'simple' : 'full';
  const b = $('advBtn');
  if (b) {
    b.hidden = !profile.simple;
    b.setAttribute('aria-pressed', advanced ? 'true' : 'false');
    b.innerHTML = icon(advanced ? 'eye-off' : 'sliders-horizontal', 15) +
      `<span class="btn-label">${advanced ? 'Простой вид' : 'Расширенный режим'}</span>`;
    b.title = advanced
      ? 'Спрятать инженерные блоки: останется то, что нужно для изделия'
      : 'Показать всё: инженерные блоки, пороги и подробные числа';
  }
}

export function applyProfile(id, opts = {}) {
  profile = profileById(id) || profileById(DEFAULT_PROFILE);
  if (opts.remember !== false) { try { localStorage.setItem(KEY_PROFILE, profile.id); } catch (_) {} }
  applyMode();
  // задача обязана быть из профиля, иначе человек видит вкладки, которых
  // в его наборе нет, и не понимает, откуда они
  if (!profile.routes.includes(current.id)) applyRoute(profile.home, opts);
  else applyRoute(current.id, {...opts, remember: opts.remember});
}

export function setAdvanced(on) {
  advanced = !!on;
  try { localStorage.setItem(KEY_ADV, advanced ? '1' : '0'); } catch (_) {}
  applyMode();
}

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
    chip.title = `Задача: ${r.name} · профиль: ${profile.name}. Нажмите, чтобы сменить`;
  }
  if (opts.focus !== false) focusRoute(r);
  subs.forEach(fn => fn(r));
}

/* Задача ведёт человека не на первую вкладку, а туда, ради чего её выбрали:
   «сделать крышку» — к блоку прилепов, «что стоит изделие» — к смете. */
function focusRoute(r) {
  const f = r.focus;
  if (!f) return;
  if (f.tab && routeTabs(r).includes(f.tab)) showTab(f.tab);
  if (f.block) openBlock(f.block);
  if (f.checklist) document.body.dataset.checklist = 'open';
  else delete document.body.dataset.checklist;
}

/* ---------- экран выбора ---------- */
/* Один экран — один вопрос. Раньше здесь стояли два профиля и одиннадцать
   одинаковых карточек задач сразу: человек в первую секунду видел тринадцать
   равновесных прямоугольников и не понимал, с чего начать. Теперь сначала
   спрашиваем, кто он, и только потом показываем его задачи. */
function profileHTML() {
  return PROFILES.filter(p => p.id !== 'all').map(p => `
    <button class="profile-card${p.id === picking.id ? ' current' : ''}" data-profile-pick="${p.id}">
      <span class="route-ico">${icon(p.ico, 22)}</span>
      <b>${p.name}</b>
      <span class="route-lead">${p.lead}</span>
      <span class="route-hides">${p.about}</span>
    </button>`).join('');
}

function taskHTML() {
  const list = profileRoutes(picking, ROUTES);
  return list.map(r => {
    const home = r.id === picking.home;
    return `<button class="task-row${r.id === current.id ? ' current' : ''}" data-route-pick="${r.id}">
      <span class="task-ico">${icon(r.ico, 18)}</span>
      <span class="task-main">
        <b>${r.name}${home ? '<i class="task-rec">с этого начинают</i>' : ''}</b>
        <span class="task-lead">${r.lead}</span>
      </span>
      <span class="task-steps">${routeTabs(r).map(t => TABS[t].name).join(' · ')}</span>
    </button>`;
  }).join('');
}

function cardsHTML(first) {
  /* Первый заход: только вопрос «кто вы». Задачи появляются вторым шагом —
     это тот самый выбор, ради которого экран и открыт. */
  if (first && !stepTwo) {
    return `<div class="route-card-box narrow" role="dialog" aria-label="Кто вы">
      <h2>Что вы делаете?</h2>
      <p class="guide-lead">КРУГ считает изделие целиком — от комка глины до цены тиража.
        Кто вы — решает, какие задачи показать и насколько подробно говорить.
        Сменить можно в любой момент, кнопкой в шапке.</p>
      <div class="profile-cards">${profileHTML()}</div>
      <button class="route-all" data-profile-pick="all">Не уверен — показать всё</button>
    </div>`;
  }
  return `<div class="route-card-box" role="dialog" aria-label="Что вы делаете">
    <div class="guide-head">
      <h2>${first ? 'С чего начнём?' : 'Задача и профиль'}</h2>
      ${first ? '' : `<button class="btn icon" id="routeClose" title="Закрыть (Esc)" aria-label="Закрыть">${icon('x')}</button>`}
    </div>
    <div class="profile-switch" role="group" aria-label="Профиль">
      ${PROFILES.map(p => `<button data-profile-pick="${p.id}"${p.id === picking.id ? ' class="active"' : ''}>
        ${icon(p.ico, 15)}${p.id === 'all' ? 'Показать всё' : p.name}</button>`).join('')}
    </div>
    <div class="task-list">${taskHTML()}</div>
    <p class="guide-hint">Задача только прячет лишнее. Осадка, оснастка и деньги считаются
      всегда — просто не мозолят глаза.</p>
  </div>`;
}

export function openRouteScreen(first = false) {
  const box = $('routeScreen');
  if (!box) return;
  picking = picking || profile;
  const draw = () => {
    box.innerHTML = cardsHTML(first);
    box.querySelectorAll('[data-profile-pick]').forEach(b => {
      b.onclick = () => {
        /* Профиль применяется сразу, а не когда выберут задачу. Иначе человек,
           нажавший «У меня мастерская» и закрывший экран по Esc, остаётся
           в прежнем профиле и не понимает, почему у него другие вкладки. */
        picking = profileById(b.dataset.profilePick) || picking;
        applyProfile(picking.id);
        stepTwo = true;
        draw();
      };
    });
    box.querySelectorAll('[data-route-pick]').forEach(b => {
      b.onclick = () => {
        box.dataset.first = '0';
        if (picking.id !== profile.id) applyProfile(picking.id);
        applyRoute(b.dataset.routePick);
        closeRouteScreen();
        toast(`${picking.name} · задача: ${activeRoute().name}. Сменить — кнопкой в шапке`);
      };
    });
    const x = $('routeClose');
    if (x) x.onclick = closeRouteScreen;
  };
  box.dataset.first = first ? '1' : '0';   // первый выбор закрыть некому: панель пуста
  draw();
  box.classList.add('open');
  box.setAttribute('aria-hidden', 'false');
}

export function closeRouteScreen() {
  const box = $('routeScreen');
  if (!box) return;
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
}

export function initRoute() {
  const btn = $('routeBtn');
  if (btn) btn.onclick = () => { picking = profile; stepTwo = true; openRouteScreen(false); };
  const adv = $('advBtn');
  if (adv) adv.onclick = () => {
    setAdvanced(!advanced);
    toast(advanced
      ? 'Расширенный режим: показаны инженерные блоки'
      : 'Простой вид: инженерные блоки спрятаны');
  };
  const box = $('routeScreen');
  if (box) box.addEventListener('click', e => {
    // первый выбор закрывать некуда: пока задачи нет, панель собирать не из чего
    if (e.target === box && box.dataset.first !== '1') closeRouteScreen();
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && box && box.classList.contains('open') && box.dataset.first !== '1')
      closeRouteScreen();
  });

  let savedRoute = null, savedProfile = null, savedAdv = null;
  try {
    savedRoute = localStorage.getItem(KEY);
    savedProfile = localStorage.getItem(KEY_PROFILE);
    savedAdv = localStorage.getItem(KEY_ADV);
  } catch (_) {}
  advanced = savedAdv === '1';

  if (profileById(savedProfile) && routeById(savedRoute)) {
    profile = profileById(savedProfile);
    current = routeById(savedRoute);
    applyProfile(profile.id);
    return false;
  }

  profile = profileById(DEFAULT_PROFILE);
  picking = profile;
  stepTwo = false;
  applyProfile(profile.id, {remember: false});
  applyRoute(DEFAULT_ROUTE, {remember: false, focus: false});
  openRouteScreen(true);
  return true;                       // первый запуск: профиль ещё не выбирали
}
