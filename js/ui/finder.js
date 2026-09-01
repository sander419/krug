// file: js/ui/finder.js
// Поиск по инструменту: Ctrl+K.
//
// Пять вкладок, три десятка блоков, полтора десятка кнопок в шапке и сотня
// статей. Всё это разложено логично — и всё равно «где менять толщину стенки»
// новичок ищет глазами по очереди. Строка поиска отвечает на такой вопрос
// за один шаг и заодно показывает, что в инструменте вообще есть.
//
// Индекс не пишется руками: вкладки берутся из задачи, блоки — из разметки
// панели (у каждого есть data-block и заголовок), статьи — из энциклопедии.
// Список, который ведут отдельно, устаревает первым; здесь устаревать нечему.
import { $ } from './dom.js';
import { icon } from './icons.js';
import { TABS, routeTabs } from '../config/routes.js';
import { activeRoute } from './route.js';
import { showTab } from './panels.js';
import { ARTICLES } from '../config/kb/index.js';
import { openArticle } from './kb.js';

const MAX = 9;                 // больше девяти строк — уже не выбор, а список

/* Действия шапки и чертежа: имя, что нажать, слова для поиска.
   Здесь только то, чего нет во вкладках и блоках.

   `btn` — нажать кнопку с таким id; действия без кнопки в разметке (они уехали
   на экран «Настройки») несут `run`. Экран грузится по требованию: поиск
   открывается на первой секунде работы, тянуть ради него настройки незачем. */
const open_ = section => import('./settings.js').then(m => m.openSettings(section));

/* Узоры ищутся по именам: «витой жгут» человек помнит, а в каком блоке он
   лежит — нет. Пресет ставится сразу, поиск на то и поиск. */
const patternPreset = async id => {
  const [{state}, {emit}, core] = await Promise.all([
    import('../core/state.js'), import('../core/bus.js'), import('../core/pattern.js'),
  ]);
  const pr = core.PATTERN_PRESETS.find(p => p.id === id);
  if (!pr) return;
  state.pattern = core.sanitizePattern(pr.pat);
  emit();
  const block = document.querySelector('[data-block="pattern"]');
  if (block) { block.open = true; block.scrollIntoView({block: 'nearest', behavior: 'smooth'}); }
};
const ACTIONS = [
  {name: 'Сменить задачу', ico: 'sliders-horizontal', btn: 'routeBtn', keys: 'режим набор вкладок'},
  {name: 'Обвести картинку', ico: 'image', btn: 'photoBtn', keys: 'фото чертёж силуэт обводка'},
  {name: 'Обучение', ico: 'graduation-cap', btn: 'kbBtn', keys: 'энциклопедия статьи курс'},
  {name: 'Как здесь работать', ico: 'circle-help',
   run: () => import('./guide.js').then(m => m.openGuide()), keys: 'подсказка шаги помощь обучение'},
  {name: 'Настройки', ico: 'sliders-horizontal', btn: 'settingsBtn',
   keys: 'вид тема схема масштаб окружение данные параметры'},
  {name: 'Тема: светлая или тёмная', ico: 'sun',
   run: () => open_('view'), keys: 'цвет ночь день'},
  {name: 'Узор на стенке', ico: 'circle-dot', sel: '[data-block="pattern"] > .block-title',
   keys: 'рельеф каннелюры грани плетёнка чешуя спираль окна просвет литофания'},
  {name: 'Узор: Витой жгут', ico: 'circle-dot', run: () => patternPreset('twisted'),
   keys: 'узор закрутка каннелюры спираль'},
  {name: 'Узор: Огранка', ico: 'circle-dot', run: () => patternPreset('gem'),
   keys: 'узор грани фасет'},
  {name: 'Узор: Окна на просвет', ico: 'circle-dot', run: () => patternPreset('lamp'),
   keys: 'узор светильник литофания просвет окна'},
  {name: 'Лепить прямо на модели', ico: 'hammer', btn: 'sculptBtn',
   keys: 'тянуть форму 3d рукой профиль'},
  {name: 'Цветовая схема', ico: 'palette', run: () => open_('view'),
   keys: 'цвет палитра оформление мастерская селадон кобальт графит'},
  {name: 'Логотип и брендбук мастерской', ico: 'palette', run: () => open_('brand'),
   keys: 'бренд лого фирменный стиль название имя цвет клиенту'},
  {name: 'Что хранится в браузере', ico: 'save', run: () => open_('data'),
   keys: 'данные память очистить забыть'},
  {name: 'Окружение вокруг модели', ico: 'image', run: () => open_('view'), keys: 'фон студия сцена свет'},
  {name: 'Мои изделия', ico: 'folder-open', btn: 'worksBtn', keys: 'работы открыть сохранить список избранное архив'},
  {name: 'Снимок вида в PNG', ico: 'camera', btn: 'snapBtn', keys: 'скриншот картинка'},
  {name: 'ДНК формы: ссылка', ico: 'dna', btn: 'dnaBtn', keys: 'поделиться рецепт ссылка'},
  {name: 'Код встраивания', ico: 'code', btn: 'embedBtn', keys: 'iframe витрина сайт'},
  {name: 'Схема изделия для производства', ico: 'file-text', btn: 'sheetBtn',
   keys: 'чертёж виды разрез размеры лист svg передать'},
  {name: 'Техкарта оснастки', ico: 'file-text', btn: 'toolCard', keys: 'документ производство'},
  {name: 'Экспорт STL', ico: 'download', btn: 'stlBtn', keys: 'печать выгрузка модель'},
  {name: 'Экспорт OBJ', ico: 'download', btn: 'objBtn', keys: 'выгрузка редактор'},
  {name: 'Экспорт GLB', ico: 'download', btn: 'glbBtn', keys: 'выгрузка витрина'},
  {name: 'Отменить', ico: 'undo-2', btn: 'undoBtn', keys: 'назад ctrl+z'},
  {name: 'Повторить', ico: 'redo-2', btn: 'redoBtn', keys: 'вперёд'},
  {name: 'Настройки расчёта', ico: 'gauge',
   run: () => import('./tuning.js').then(m => m.openTuning()),
   keys: 'пороги зазоры уклон облой замки допуски свои значения'},
  {name: 'Сбросить раскладку', ico: 'rotate-ccw', run: () => open_('place'),
   keys: 'колонки блоки порядок'},
  {name: 'Масштаб интерфейса', ico: 'zoom-in', run: () => open_('view'),
   keys: 'крупнее мельче шрифт больше меньше'},
  {name: 'Чертёж: править точками', ico: 'circle-dot', sel: '[data-dmode="points"]', keys: 'профиль точки тянуть'},
  {name: 'Чертёж: провести линию', ico: 'activity', sel: '[data-dmode="draw"]', keys: 'профиль линия рисовать силуэт'},
  {name: 'Масштаб чертежа', ico: 'ruler', btn: 'draftScale', keys: '1:1 вписать'},
];

let open = false, items = [], picked = 0;

const norm = s => (s || '').toLowerCase().replace(/ё/g, 'е');

/* Блоки панели — прямо из разметки: имя блока это его заголовок. */
function blocks() {
  const tabs = routeTabs(activeRoute());
  const out = [];
  for (const pane of document.querySelectorAll('.tabpane[data-pane]')) {
    const tab = pane.dataset.pane;
    if (!tabs.includes(tab)) continue;          // спрятанное задачей не ищем
    for (const d of pane.querySelectorAll(':scope > details.block')) {
      const t = d.querySelector('.block-title');
      if (!t) continue;
      const name = t.childNodes[0].textContent.trim() || t.textContent.trim();
      out.push({name, ico: TABS[tab].ico, where: TABS[tab].name, tab, block: d.dataset.block});
    }
  }
  return out;
}

function index() {
  const tabs = routeTabs(activeRoute());
  const list = [
    ...tabs.map(t => ({name: TABS[t].name, ico: TABS[t].ico, where: 'вкладка', tab: t, keys: TABS[t].txt})),
    ...blocks(),
    ...ACTIONS.filter(a => a.run || !a.btn || $(a.btn)).map(a => ({...a, where: 'действие'})),
    ...ARTICLES.map(a => ({name: a.title, ico: 'book-open', where: 'обучение',
                           article: a.id, keys: (a.tags || []).join(' ') + ' ' + (a.lead || '')})),
  ];
  for (const it of list) it._s = norm(it.name + ' ' + (it.keys || '') + ' ' + (it.where || ''));
  return list;
}

/* Совпадение: сначала начало имени, потом вхождение, потом буквы подряд.
   Без баллов за красоту — важно, чтобы точное слово всегда было первым. */
function score(it, q) {
  const name = norm(it.name);
  // навигация вперёд чтения: при равном совпадении вкладка и блок нужнее статьи,
  // потому что за поиском чаще идут «куда нажать», а не «что почитать»
  const kind = it.article ? 0 : 6;
  if (name.startsWith(q)) return 100 + kind - name.length * 0.01;
  if (name.includes(q)) return 60 + kind;
  if (it._s.includes(q)) return 40 + kind;
  let i = 0;
  for (const ch of it._s) if (ch === q[i]) i++;
  return i === q.length ? 10 + kind : 0;
}

function run(it) {
  close();
  if (it.article) { openArticle(it.article); return; }
  if (it.tab && !it.block) { showTab(it.tab); return; }
  if (it.block) {
    showTab(it.tab);
    const d = document.querySelector(`.tabpane[data-pane="${it.tab}"] [data-block="${it.block}"]`);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    d.classList.add('found');
    setTimeout(() => d.classList.remove('found'), 1400);
    return;
  }
  if (it.run) { it.run(); return; }
  const el = it.btn ? $(it.btn) : document.querySelector(it.sel);
  if (el) el.click();
}

function draw(q) {
  const box = $('finderList');
  if (!box) return;
  const all = index();
  items = (norm(q).trim()
    ? all.map(it => ({it, s: score(it, norm(q).trim())})).filter(x => x.s > 0)
         .sort((a, b) => b.s - a.s).slice(0, MAX).map(x => x.it)
    : all.filter(it => it.where === 'вкладка' || it.where === 'действие').slice(0, MAX));
  picked = 0;
  box.innerHTML = items.length ? items.map((it, i) => `
    <button class="finder-row${i ? '' : ' on'}" data-i="${i}">
      ${icon(it.ico || 'search', 15)}
      <span class="finder-name">${it.name}</span>
      <span class="finder-where">${it.where}</span>
    </button>`).join('')
    : '<p class="hint finder-empty">Ничего не нашлось. Попробуйте слово из подсказки — «усадка», «сопло», «гипс».</p>';
  box.querySelectorAll('[data-i]').forEach(b => {
    b.onclick = () => run(items[+b.dataset.i]);
    b.onpointerenter = () => mark(+b.dataset.i);
  });
}

function mark(i) {
  if (!items.length) return;
  picked = (i + items.length) % items.length;
  $('finderList').querySelectorAll('.finder-row').forEach((b, j) => b.classList.toggle('on', j === picked));
  const on = $('finderList').querySelector('.finder-row.on');
  if (on) on.scrollIntoView({block: 'nearest'});
}

export function openFinder() {
  const box = $('finderScreen');
  if (!box) return;
  open = true;
  box.innerHTML = `<div class="finder-card" role="dialog" aria-label="Поиск по инструменту">
    <div class="finder-head">
      ${icon('search', 17)}
      <input id="finderInput" type="search" placeholder="Что нужно? Вкладка, настройка, статья…"
             autocomplete="off" spellcheck="false" aria-label="Поиск по инструменту">
      <kbd>Esc</kbd>
    </div>
    <div class="finder-list" id="finderList"></div>
    <p class="finder-foot"><kbd>↑</kbd><kbd>↓</kbd> выбор · <kbd>Enter</kbd> открыть · <kbd>Ctrl</kbd>+<kbd>K</kbd> вызвать</p>
  </div>`;
  box.classList.add('open');
  box.setAttribute('aria-hidden', 'false');
  draw('');
  const inp = $('finderInput');
  inp.oninput = () => draw(inp.value);
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mark(picked + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(picked - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[picked]) run(items[picked]); }
  };
  inp.focus();
}

export function close() {
  const box = $('finderScreen');
  if (!box || !open) return;
  open = false;
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '';
}

export function initFinder() {
  const btn = $('findBtn');
  if (btn) btn.onclick = () => (open ? close() : openFinder());
  const box = $('finderScreen');
  if (box) box.addEventListener('click', e => { if (e.target === box) close(); });
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open ? close() : openFinder(); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); close(); }
  });
}
