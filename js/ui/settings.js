// file: js/ui/settings.js
// «Настройки» — одно место для всего, что настраивают раз и забывают.
//
// Раньше они были рассыпаны: тема и масштаб — во всплывающей панели под
// иконкой ползунков, окружение — под соседней иконкой, пороги расчёта — внутри
// той же панели, раскладка — там же. Человек, которому нужна была цветовая
// схема, честно не находил её: две иконки без подписи в ряду из десяти кнопок.
//
// Теперь в шапке одна подписанная кнопка «Настройки», а здесь — разделы:
// вид, брендбук мастерской, рабочее место, расчёт и данные. Ничего нового
// не считается: экран только собирает уже существующие ручки в одном месте.
import { firstHintHTML, resetHints } from './hints.js';
import { openScreen, refreshScreen, closeScreen } from './screen.js';
import { SKINS, currentSkin, setSkin, themeMode, setTheme, THEME_MODES, THEME_LABEL,
         THEME_ICON, UI_STEPS, uiStep, setUiStep, currentTheme } from './theme.js';
import { ENVIRONMENTS, byEnvId } from '../config/environments.js';
import { currentEnv, selectEnv } from './environment.js';
import { currentBrand, patchBrand, saveBrand, readLogo } from './brand.js';
import { blankBrand, sanitizeBrand, brandWarnings, FONTS, NAME_LIMIT, SUB_LIMIT }
  from '../core/brand.js';
import { activeProfile, activeRoute, isSimple, setAdvanced, openRouteScreen } from './route.js';
import { openTuning } from './tuning.js';
import { resetLayout } from './layout.js';
import { openGuide } from './guide.js';
import { download } from '../core/files.js';
import { toast } from './overlays.js';
import { $, esc, num } from './dom.js';
import { icon } from './icons.js';

const SECTIONS = [
  {id: 'view', name: 'Вид', ico: 'image'},
  {id: 'brand', name: 'Брендбук', ico: 'palette'},
  {id: 'place', name: 'Рабочее место', ico: 'sliders-horizontal'},
  {id: 'calc', name: 'Расчёт', ico: 'gauge'},
  {id: 'data', name: 'Данные', ico: 'save'},
];

/* ---------- разделы ---------- */

function viewHTML() {
  const mode = themeMode(), skin = currentSkin(), env = currentEnv(), step = uiStep();
  return `
    <div class="set-row">
      <div class="set-label"><b>Тема</b><span>светло или темно</span></div>
      <div class="set-pick">${THEME_MODES.map(m => `
        <button class="set-chip${m === mode ? ' current' : ''}" data-theme-pick="${m}"
          aria-pressed="${m === mode}">${icon(THEME_ICON[m], 15)}${THEME_LABEL[m]}</button>`).join('')}
      </div>
    </div>

    <div class="set-row">
      <div class="set-label"><b>Цветовая схема</b><span>какого цвета мастерская</span></div>
      <div class="set-pick skin-row">${SKINS.map(s => `
        <button class="skin-dot${s.id === skin ? ' current' : ''}" data-skin-pick="${s.id}"
          aria-pressed="${s.id === skin}" title="${esc(s.what)}"><i class="skin-swatch"
          data-skin-swatch="${s.id}"></i><span>${esc(s.name)}</span></button>`).join('')}
      </div>
    </div>

    <div class="set-row">
      <div class="set-label"><b>Масштаб интерфейса</b>
        <span>шрифт и кнопки крупнее, 3D-вид не трогается</span></div>
      <div class="set-pick">
        <button class="set-chip" id="setUiDown" ${step === 0 ? 'disabled' : ''}>А−</button>
        <span class="set-val">${Math.round(UI_STEPS[step] * 100)} %</span>
        <button class="set-chip" id="setUiUp" ${step === UI_STEPS.length - 1 ? 'disabled' : ''}>А+</button>
      </div>
    </div>

    <div class="set-row col">
      <div class="set-label"><b>Окружение вокруг модели</b>
        <span>свет, фон и подставка: мастерская, фотостудия, полка, печь, витрина</span></div>
      <div class="set-env">${ENVIRONMENTS.map(e => `
        <button class="set-env-item${e.id === env ? ' current' : ''}" data-env-pick="${e.id}"
          aria-pressed="${e.id === env}">
          <span class="set-env-ico">${icon(e.ico, 17)}</span>
          <span><b>${esc(e.name)}</b><i>${esc(e.note)}</i></span>
        </button>`).join('')}
      </div>
    </div>`;
}

function brandHTML() {
  const b = currentBrand();
  const warns = brandWarnings(b.accent, currentTheme());
  const where = [
    ['header', 'В шапке инструмента'],
    ['sheet', 'На листе A3 для мастерской'],
    ['card', 'В техкарте оснастки'],
    ['embed', 'В коде витрины для сайта'],
  ];
  return `
    <p class="screen-note">Мастерская отдаёт клиенту лист, техкарту и витрину. Брендбук ставит
      на них ваш знак и ваше имя вместо слова «КРУГ». Всё хранится в этом браузере и никуда
      не отправляется — сервера у инструмента нет.</p>

    <div class="set-row">
      <div class="set-label"><b>Логотип</b><span>PNG, SVG или JPG; уменьшим до 320 px сами</span></div>
      <div class="set-pick brand-logo-pick">
        ${b.logo ? `<img class="brand-logo-prev" src="${b.logo}" alt="Логотип мастерской">` : ''}
        <label class="set-chip as-file">${icon('image', 15)}${b.logo ? 'Заменить' : 'Выбрать файл'}
          <input type="file" id="brandLogoFile" accept="image/png,image/jpeg,image/svg+xml,image/webp"></label>
        ${b.logo ? `<button class="set-chip" id="brandLogoDrop">${icon('trash-2', 15)}Убрать</button>` : ''}
      </div>
    </div>

    <div class="set-row">
      <div class="set-label"><b>Название мастерской</b><span>заменит слово «КРУГ» в шапке</span></div>
      <div class="set-pick"><input type="text" id="brandName" maxlength="${NAME_LIMIT}"
        value="${esc(b.name)}" placeholder="Гончарная «Круг»" aria-label="Название мастерской"></div>
    </div>

    <div class="set-row">
      <div class="set-label"><b>Подпись</b><span>город, телефон, сайт — то, что уходит в документы</span></div>
      <div class="set-pick"><input type="text" id="brandSub" maxlength="${SUB_LIMIT}"
        value="${esc(b.sub)}" placeholder="Самара · +7 900 000-00-00 · example.ru"
        aria-label="Подпись мастерской"></div>
    </div>

    <div class="set-row">
      <div class="set-label"><b>Фирменный цвет</b>
        <span>один цвет; остальные оттенки КРУГ выведет так, чтобы всё осталось читаемым</span></div>
      <div class="set-pick">
        <input type="color" id="brandColor" value="${b.accent || '#e0693a'}"
               aria-label="Фирменный цвет">
        <input type="text" id="brandColorHex" value="${esc(b.accent)}" placeholder="#e0693a"
               maxlength="7" spellcheck="false" aria-label="Фирменный цвет кодом">
        ${b.accent ? `<button class="set-chip" id="brandColorDrop">Вернуть цвет схемы</button>` : ''}
      </div>
    </div>
    ${warns.length ? `<div class="set-warn">${warns.map(w =>
      `<p>${icon('circle-alert', 15)}${esc(w.txt)}</p>`).join('')}</div>` : ''}

    <div class="set-row">
      <div class="set-label"><b>Шрифт оболочки</b>
        <span>только вшитые в КРУГ: внешних запросов у инструмента нет</span></div>
      <div class="set-pick">${FONTS.map(f => `
        <button class="set-chip${f.id === (b.font || 'krug') ? ' current' : ''}"
          data-font-pick="${f.id}" title="${esc(f.what)}">${esc(f.name)}</button>`).join('')}
      </div>
    </div>

    <div class="set-row col">
      <div class="set-label"><b>Где показывать</b>
        <span>снятая галочка возвращает этому месту вид КРУГа</span></div>
      <div class="set-checks">${where.map(([k, t]) => `
        <label class="set-check"><input type="checkbox" data-brand-where="${k}"
          ${b.where[k] ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div>
    </div>

    <div class="btn-row">
      <button class="btn" id="brandSave">${icon('download', 15)}Сохранить брендбук в файл</button>
      <label class="btn as-file">${icon('folder-open', 15)}Загрузить из файла
        <input type="file" id="brandLoad" accept="application/json,.json"></label>
      <button class="btn" id="brandClear">${icon('rotate-ccw', 15)}Убрать брендбук</button>
    </div>`;
}

function placeHTML() {
  const p = activeProfile(), r = activeRoute();
  return `
    <div class="set-row">
      <div class="set-label"><b>Кто вы и что делаете</b>
        <span>профиль решает набор задач, задача — набор вкладок</span></div>
      <div class="set-pick">
        <span class="set-val">${esc(p.name)} · ${esc(r.name)}</span>
        <button class="set-chip" id="setRoute">${icon('sliders-horizontal', 15)}Сменить</button>
      </div>
    </div>

    <div class="set-row">
      <div class="set-label"><b>Инженерные блоки</b>
        <span>простой вид прячет то, что нужно не каждому: усилие пресса, точку окупаемости</span></div>
      <div class="set-pick">
        <button class="set-chip${isSimple() ? ' current' : ''}" data-adv-pick="simple">Простой вид</button>
        <button class="set-chip${isSimple() ? '' : ' current'}" data-adv-pick="adv">Показывать всё</button>
      </div>
    </div>

    <div class="set-row">
      <div class="set-label"><b>Раскладка</b>
        <span>ширины колонок и порядок блоков вернутся к исходным</span></div>
      <div class="set-pick"><button class="set-chip" id="setLayout">${icon('rotate-ccw', 15)}Сбросить</button></div>
    </div>

    <div class="set-row">
      <div class="set-label"><b>Как здесь работать</b><span>короткий обзор инструмента</span></div>
      <div class="set-pick">
        <button class="set-chip" id="setGuide">${icon('circle-help', 15)}Открыть</button>
        <button class="set-chip" id="setTour">${icon('circle-dot', 15)}Провести по инструменту</button>
      </div>
    </div>

    <div class="set-row">
      <div class="set-label"><b>Подсказки</b>
        <span>карточки «что здесь делают» на экранах, которые вы уже закрывали</span></div>
      <div class="set-pick"><button class="set-chip" id="setHints">${icon('lightbulb', 15)}Показать заново</button></div>
    </div>`;
}

function calcHTML() {
  return `
    <p class="screen-note">Пороги — это то, чем инструмент отличает «годится» от «не годится»:
      зазор посадки крышки, уклон стенки формы, толщина облоя, запас прочности. Умолчания взяты
      из практики мастерских, но ваша печь и ваша глина знают лучше — свои значения уезжают
      в ссылку-ДНК вместе с рецептом.</p>
    <div class="btn-row">
      <button class="btn primary" id="setTune">${icon('gauge', 15)}Открыть настройки расчёта</button>
    </div>`;
}

/** Сколько места занимают наши ключи: человек вправе знать, что лежит в его браузере. */
function storageRows() {
  const rows = [];
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('krug.')) continue;
      const size = (localStorage.getItem(k) || '').length;
      total += size;
      rows.push([k, size]);
    }
  } catch (_) {}
  rows.sort((a, b) => b[1] - a[1]);
  return {rows, total};
}

const KEY_NAMES = {
  'krug.works': 'изделия со всей их жизнью',
  'krug.notes': 'ваши замеры материалов',
  'krug.brand': 'брендбук мастерской',
  'krug.tune': 'свои пороги расчёта',
  'krug.layout': 'раскладка колонок и блоков',
  'krug.theme': 'тема', 'krug.skin': 'цветовая схема', 'krug.ui': 'масштаб интерфейса',
  'krug.env': 'окружение сцены', 'krug.route': 'задача', 'krug.profile': 'профиль',
  'krug.advanced': 'простой вид или расширенный',
  'krug.work': 'последняя работа (автосохранение)', 'krug.work.current': 'какое изделие открыто',
  'krug.tab': 'открытая вкладка', 'krug.foot': 'полоса метрик внизу',
  'krug.guide': 'обучение показано', 'krug.guided': 'обучение показано',
};

function dataHTML() {
  const {rows, total} = storageRows();
  return `
    <p class="screen-note">У КРУГа нет сервера: всё, что вы сделали, лежит в этом браузере
      и не уезжает никуда. Обратная сторона честная — чистка данных браузера стирает и это.
      Чтобы работа пережила смену устройства, забирайте ссылку-ДНК или пакет производства
      на экране «Выпуск».</p>
    <dl class="pp-list">${rows.map(([k, size]) => `
      <div class="pp-row"><dt>${esc(KEY_NAMES[k] || k)}</dt>
        <dd>${size > 1024 ? num(size / 1024, 1) + ' КБ' : size + ' Б'}
          <span class="dim">${esc(k)}</span></dd></div>`).join('')
      || '<div class="pp-row"><dt>Пусто</dt><dd>инструмент ещё ничего не сохранял</dd></div>'}
      <div class="pp-row"><dt><b>Всего</b></dt><dd><b>${num(total / 1024, 1)} КБ</b></dd></div>
    </dl>
    <div class="btn-row">
      <button class="btn" id="setForget">${icon('trash-2', 15)}Забыть всё и начать заново</button>
    </div>`;
}

const BODY = {view: viewHTML, brand: brandHTML, place: placeHTML, calc: calcHTML, data: dataHTML};
let tab = 'view';

function bodyHTML() {
  return `
    ${firstHintHTML('settings', 'Всё, что настраивают раз и забывают',
      '«Вид» — тема, цветовая схема, масштаб и окружение сцены. «Брендбук» ставит на инструмент и на документы знак вашей мастерской. «Данные» показывают, что именно лежит в этом браузере.')}

    <div class="seg set-nav" role="group" aria-label="Разделы настроек">
      ${SECTIONS.map(s => `<button data-set-tab="${s.id}"${s.id === tab ? ' class="active"' : ''}>
        ${icon(s.ico, 15)}${s.name}</button>`).join('')}
    </div>
    <section class="set-body">${BODY[tab]()}</section>`;
}

/* ---------- поведение ---------- */

function mount(box) {
  const rerender = () => { refreshScreen(bodyHTML()); mount($('screenHost')); };
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };

  box.querySelectorAll('[data-set-tab]').forEach(b => {
    b.onclick = () => { tab = b.dataset.setTab; rerender(); };
  });

  /* вид */
  box.querySelectorAll('[data-theme-pick]').forEach(b => {
    b.onclick = () => { setTheme(b.dataset.themePick); rerender(); };
  });
  box.querySelectorAll('[data-skin-pick]').forEach(b => {
    b.onclick = () => { setSkin(b.dataset.skinPick); rerender(); };
  });
  on('setUiDown', () => { setUiStep(uiStep() - 1); rerender(); });
  on('setUiUp', () => { setUiStep(uiStep() + 1); rerender(); });
  box.querySelectorAll('[data-env-pick]').forEach(b => {
    b.onclick = () => { selectEnv(b.dataset.envPick); rerender(); };
  });

  /* брендбук */
  const logoFile = $('brandLogoFile');
  if (logoFile) logoFile.onchange = async () => {
    const f = logoFile.files && logoFile.files[0];
    if (!f) return;
    try {
      const logo = await readLogo(f);
      if (!patchBrand({logo})) return toast('Логотип не влез в память браузера');
      rerender();
      toast('Логотип поставлен');
    } catch (e) { toast('Логотип не взят: ' + e.message); }
  };
  on('brandLogoDrop', () => { patchBrand({logo: ''}); rerender(); });

  const text = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.onchange = () => { patchBrand({[key]: el.value}); };
  };
  text('brandName', 'name');
  text('brandSub', 'sub');

  const color = $('brandColor'), hexIn = $('brandColorHex');
  const setColor = v => {
    const val = /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '';
    patchBrand({accent: val});
    rerender();
  };
  if (color) color.oninput = () => setColor(color.value);
  if (hexIn) hexIn.onchange = () => setColor(hexIn.value.trim());
  on('brandColorDrop', () => setColor(''));

  box.querySelectorAll('[data-font-pick]').forEach(b => {
    b.onclick = () => { patchBrand({font: b.dataset.fontPick}); rerender(); };
  });
  box.querySelectorAll('[data-brand-where]').forEach(c => {
    c.onchange = () => { patchBrand({where: {[c.dataset.brandWhere]: c.checked}}); rerender(); };
  });

  on('brandSave', () => {
    const b = currentBrand();
    download(new Blob([JSON.stringify(b, null, 2)], {type: 'application/json'}),
             `${(b.name || 'brand').replace(/[^\wа-яё\- ]/gi, '').trim() || 'brand'}.брендбук.json`);
    toast('Брендбук сохранён файлом — его можно перенести на другой компьютер');
  });
  const loadFile = $('brandLoad');
  if (loadFile) loadFile.onchange = () => {
    const f = loadFile.files && loadFile.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        saveBrand(sanitizeBrand(JSON.parse(String(fr.result))));
        rerender();
        toast('Брендбук загружен');
      } catch (_) { toast('Это не файл брендбука'); }
    };
    fr.readAsText(f);
  };
  on('brandClear', () => {
    if (!confirm('Убрать логотип, имя и фирменный цвет? Инструмент снова станет КРУГом.')) return;
    saveBrand(blankBrand());
    rerender();
  });

  /* рабочее место */
  on('setRoute', () => { closeScreen(); openRouteScreen(false); });
  box.querySelectorAll('[data-adv-pick]').forEach(b => {
    b.onclick = () => { setAdvanced(b.dataset.advPick === 'adv'); rerender(); };
  });
  on('setLayout', () => { resetLayout(); toast('Раскладка сброшена'); });
  on('setGuide', () => { closeScreen(); openGuide(); });
  on('setTour', async () => { closeScreen(); (await import('./tour.js')).startTour(); });
  on('setHints', () => { resetHints(); rerender(); toast('Подсказки будут показаны снова'); });
  on('setTune', () => { closeScreen(); openTuning(); });

  on('setForget', () => {
    /* Отменить нечем: список изделий, замеры и брендбук исчезнут вместе.
       Поэтому спрашиваем прямо и называем, что именно пропадёт. */
    const {rows} = storageRows();
    const works = (() => { try { return (JSON.parse(localStorage.getItem('krug.works')) || []).length; }
                           catch (_) { return 0; } })();
    if (!confirm(`Забыть всё, что КРУГ помнит в этом браузере?\n\n` +
        `Пропадут: изделий — ${works}, записей всего — ${rows.length}, включая ваши замеры ` +
        `материалов и брендбук. Отменить будет нечем.`)) return;
    try {
      for (const [k] of rows) localStorage.removeItem(k);
    } catch (_) {}
    location.href = location.pathname;
  });
}

/** Открыть настройки; можно сразу на нужном разделе. */
export function openSettings(section) {
  if (section && BODY[section]) tab = section;
  openScreen({
    id: 'settings', wide: true,
    title: 'Настройки',
    lead: 'Вид, брендбук мастерской, рабочее место, пороги расчёта и данные.',
    html: bodyHTML(), redraw: bodyHTML,
    onMount: mount,
  });
}
