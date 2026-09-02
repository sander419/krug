// file: js/ui/release.js
// Выпуск: всё, что можно забрать из КРУГа, в одном месте.
//
// Выгрузки расползлись: STL в шапке, техкарта во вкладке «Оснастка», G-code
// в «Печати», DXF там же, где матрица, лист A3 в меню. Человек, которому надо
// «отдать это в мастерскую», собирал файлы по всему инструменту и половину
// не находил.
//
// Здесь один экран и один порядок: модель → производство → данные → пакет.
// Пакет — ZIP с тем же содержимым, что и кнопки по отдельности: в мастерскую
// уходит один файл, а не восемь штук вперемешку с чужими загрузками.
import { state, encodeDNA } from '../core/state.js';
import { download, fileName } from '../core/files.js';
import { makeZip } from '../core/zip.js';
import { sliceGCode } from '../core/slicer.js';
import { computeProduction, userProfileMM } from '../core/math.js';
import { byId as materialById } from '../config/materials.js';
import { byGlazeId } from '../config/glazes.js';
import { sanitizeCost, pieceCost } from '../core/cost.js';
import { modelFiles, objText, stlBlobFromGeometry,
         exportSTL, exportOBJ, exportGLB, snapshot } from '../three/exporters.js';
import { sheetSVG, dxfText, techCardText } from './tooling.js';
import { castMouldNumbers, castMouldGeometry } from '../three/castMould.js';
import { castSubjects } from '../core/mould.js';
import { kilnNumbers } from './kiln.js';
import { currentWork } from './works.js';
import { markExported } from './next.js';
import { firstHintHTML } from './hints.js';
import { openScreen } from './screen.js';
import { $, esc, num, rub } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';
import { sanitizePattern, patternOn, patternTitle } from '../core/pattern.js';

/* Рецепт в JSON: то же, что в ссылке-ДНК, но читаемое человеком и его
   инструментами. Ссылка удобна для передачи, файл — для архива работы. */
function recipeJSON() {
  const prod = computeProduction(state);
  const mat = materialById(state.mat);
  const opt = sanitizeCost(state.cost);
  const kiln = kilnNumbers();
  const per = pieceCost(state, prod, userProfileMM(state),
    {...opt, firePerPiece: kiln.perItem || 0, glaze: byGlazeId(state.glazeId)});
  const k = 1 - mat.shrinkPct / 100;
  return JSON.stringify({
    /* Версия рецепта растёт вместе с составом полей: во второй появился
       узор на стенке. Иначе тот, кто читает файл, не отличит «узора нет»
       от «эта версия про узор ещё не знала». */
    krug: {version: 2, made: new Date().toISOString()},
    name: state.name,
    dna: encodeDNA(),
    link: location.origin + location.pathname + '#dna=' + encodeDNA(),
    raw: {heightMM: state.H, diameterMM: state.D, wallMM: state.wall},
    fired: {heightMM: +(state.H * k).toFixed(1), diameterMM: +(state.D * k).toFixed(1),
            shrinkPct: mat.shrinkPct},
    mass: {clayG: Math.round(prod.massN), wareG: Math.round(prod.massF),
           capacityMl: Math.round(prod.capMl)},
    material: {id: mat.id, name: mat.name, vendor: mat.vendor || null},
    glaze: {id: state.glazeId, name: byGlazeId(state.glazeId).name},
    /* Узор — часть формы: без него рецепт не описывает вещь, которую отдали. */
    pattern: (() => {
      const pt = sanitizePattern(state.pattern);
      if (!patternOn(pt)) return null;
      /* Слои уходят в рецепт как есть: по ним вещь воспроизводится
         числами, а не «примерно такой же плетёнкой». */
      return {name: patternTitle(pt), layers: pt.layers.map(l => ({
        id: l.id, depthMM: l.depth, repeatsAround: l.n, repeatsUp: l.m,
        twistDeg: l.twist || null, phaseDeg: l.phase || null,
        bandPct: (l.from > 0 || l.to < 1)
          ? [Math.round(l.from * 100), Math.round(l.to * 100)] : null,
      }))};
    })(),
    cost: {totalRub: Math.round(per.total), minPriceRub: Math.round(per.minPrice),
           batch: opt.n},
    note: 'Числа с пометкой «оценка» в интерфейсе — ориентиры мастерской, а не паспорт.',
  }, null, 2);
}

/* Части формы под отливку: сколько их, столько и файлов. */
function mouldFiles() {
  const out = [];
  try {
    for (const s of castSubjects(state)) {
      if (s.kind !== 'lathe') continue;
      const cm = castMouldNumbers(state, s.subject);
      for (let t = 0; t < cm.tiers; t++)
        for (const [half, tag] of [['bump', 'a'], ['socket', 'b']]) {
          const m = castMouldGeometry(state, {half, tier: t, subject: s.subject});
          out.push({name: `mould/${s.id}-${t + 1}${tag}.stl`, geo: m.geometry});
        }
    }
  } catch (_) { /* форма не строится — пакет соберётся без неё */ }
  return out;
}

const F = [
  {id: 'stl', group: 'model', name: 'STL', what: 'модель в сыром размере — для печати и формы',
   run: () => { exportSTL(state); return 'STL сохранён'; }},
  {id: 'obj', group: 'model', name: 'OBJ', what: 'для 3D-редакторов',
   run: () => { exportOBJ(state); return 'OBJ сохранён'; }},
  {id: 'glb', group: 'model', name: 'GLB', what: 'как на экране, с материалом',
   run: () => { exportGLB(state, () => toast('GLB сохранён')); return null; }},
  {id: 'png', group: 'model', name: 'Снимок PNG', what: 'текущий вид сцены',
   run: () => { snapshot(state, () => toast('Снимок сохранён')); return null; }},

  {id: 'gcode', group: 'prod', name: 'G-code', what: 'печать глиной на вашем принтере',
   run: () => {
     const r = sliceGCode(state);
     download(new Blob([r.text], {type: 'text/plain'}), fileName(state, 'gcode'));
     return `G-code сохранён · ${r.stats ? r.stats.layers + ' слоёв' : ''}`;
   }},
  {id: 'dxf', group: 'prod', name: 'DXF', what: 'профили изделия, стенки, ролика и матрицы',
   run: () => { download(new Blob([dxfText()], {type: 'application/dxf'}), fileName(state, 'профили.dxf'));
                return 'DXF сохранён'; }},
  {id: 'sheet', group: 'prod', name: 'Схема A3', what: 'три вида, размеры и таблица — на верстак',
   run: () => { download(new Blob([sheetSVG()], {type: 'image/svg+xml'}), fileName(state, 'схема.svg'));
                return 'Схема сохранена'; }},
  {id: 'card', group: 'prod', name: 'Техкарта', what: 'порядок операций, оснастка, деньги',
   run: () => { download(new Blob([techCardText()], {type: 'text/markdown'}), fileName(state, 'техкарта.md'));
                return 'Техкарта сохранена'; }},

  {id: 'json', group: 'data', name: 'Рецепт JSON', what: 'числа изделия и ссылка на него',
   run: () => { download(new Blob([recipeJSON()], {type: 'application/json'}), fileName(state, 'рецепт.json'));
                return 'Рецепт сохранён'; }},
  {id: 'dna', group: 'data', name: 'Ссылка-ДНК', what: 'весь рецепт одной ссылкой',
   run: () => {
     const link = location.origin + location.pathname + '#dna=' + encodeDNA();
     if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
     location.hash = 'dna=' + encodeDNA();
     return 'Ссылка скопирована в буфер';
   }},
];

const GROUPS = [
  {id: 'model', name: 'Модель', lead: 'То, что можно напечатать, открыть в редакторе или показать.'},
  {id: 'prod',  name: 'Производство', lead: 'То, что уходит в мастерскую и на станок.'},
  {id: 'data',  name: 'Данные', lead: 'Рецепт целиком: числа и ссылка, по которой изделие откроется заново.'},
];

function bodyHTML() {
  const w = currentWork();
  const groups = GROUPS.map(g => `
    <section class="rel-group">
      <h3>${g.name}</h3>
      <p class="dim">${g.lead}</p>
      <div class="rel-items">${F.filter(f => f.group === g.id).map(f => `
        <button class="rel-item" data-run="${f.id}">
          <b>${f.name}</b><span>${f.what}</span>
        </button>`).join('')}</div>
    </section>`).join('');

  return `
    ${firstHintHTML('release', 'Отсюда изделие уходит в работу',
      'Слева модель для печати и станка, справа документы для мастерской и клиента. Если не знаете, что выбрать, берите пакет производства: в нём всё сразу, одним архивом.')}
${groups}
    <section class="rel-group rel-pack">
      <h3>Пакет производства</h3>
      <p class="dim">Один архив со всем, что нужно мастерской: модель, крышка и части формы
        в STL, профили в DXF, лист A3, техкарта и рецепт. Складывается без сжатия —
        распаковывается чем угодно.</p>
      <label class="check-row"><span>Положить части формы под отливку</span>
        <input type="checkbox" id="relMould" checked></label>
      <label class="check-row"><span>Положить G-code для печати глиной</span>
        <input type="checkbox" id="relGcode"></label>
      <div class="btn-row">
        <button class="btn primary wide" id="relZip">${icon('package', 15)}Скачать пакет производства</button>
      </div>
      <p class="screen-note">${w ? `Изделие «${esc(w.name)}» сохранено в списке.`
        : 'Изделие ещё не сохранено — пакет соберётся, но в «Моих изделиях» его не будет.'}
        Файлы в сыром размере, до обжига: по ним делают форму. Готовое изделие меньше
        на усадку массы.</p>
    </section>`;
}

async function buildPackage() {
  const files = [];
  for (const m of modelFiles(state)) files.push({name: m.name, data: await m.blob.arrayBuffer()});
  files.push({name: 'model.obj', data: objText(state)});
  files.push({name: 'profile.dxf', data: dxfText()});
  files.push({name: 'drawing-a3.svg', data: sheetSVG()});
  files.push({name: 'tech-card.md', data: techCardText()});
  files.push({name: 'recipe.json', data: recipeJSON()});

  if ($('relGcode') && $('relGcode').checked) {
    try { files.push({name: 'print.gcode', data: sliceGCode(state).text}); } catch (_) {}
  }
  if ($('relMould') && $('relMould').checked) {
    for (const m of mouldFiles()) {
      files.push({name: m.name, data: await stlBlobFromGeometry(m.geo).arrayBuffer()});
      m.geo.dispose();
    }
  }
  /* Читаемая опись: человек, открывший архив через месяц, должен понимать,
     что это за файлы и в каком размере они сделаны. */
  files.push({name: 'README.txt', data: readmeText(files)});
  return makeZip(files);
}

function readmeText(files) {
  const mat = materialById(state.mat);
  return [
    `КРУГ — пакет производства`,
    `Изделие: ${state.name || 'без названия'}`,
    `Собрано: ${new Date().toLocaleString('ru')}`,
    ``,
    `Все размеры — сырые, до обжига: по ним делают форму и печатают.`,
    `Масса: ${mat.name}${mat.vendor ? ' (' + mat.vendor + ')' : ''}, усадка ${mat.shrinkPct} %.`,
    `Готовое изделие меньше на эту долю.`,
    ``,
    `Файлы:`,
    ...files.map(f => `  ${f.name}`),
    ``,
    `Рецепт целиком — в recipe.json: там же ссылка, по которой изделие`,
    `открывается в КРУГе со всеми числами.`,
  ].join('\n');
}

function mount(box) {
  box.querySelectorAll('[data-run]').forEach(b => {
    b.onclick = () => {
      const f = F.find(x => x.id === b.dataset.run);
      if (!f) return;
      try {
        const msg = f.run();
        markExported();
        if (msg) toast(msg);
      } catch (e) {
        toast('Не вышло сохранить: ' + (e && e.message ? e.message : 'ошибка'));
      }
    };
  });
  const zip = $('relZip');
  if (zip) zip.onclick = async () => {
    zip.disabled = true;
    const was = zip.innerHTML;
    zip.textContent = 'Собираю пакет…';
    try {
      const blob = await buildPackage();
      download(blob, fileName(state, 'производство.zip'));
      markExported();
      toast(`Пакет собран: ${(blob.size / 1024 / 1024).toFixed(1)} МБ`);
    } catch (e) {
      toast('Пакет не собрался: ' + (e && e.message ? e.message : 'ошибка'));
    } finally {
      zip.disabled = false;
      zip.innerHTML = was;
    }
  };
}

export function openRelease() {
  openScreen({
    id: 'release',
    title: 'Выпуск',
    lead: 'Всё, что можно забрать: модель, файлы для мастерской и рецепт.',
    html: bodyHTML(), redraw: bodyHTML,
    onMount: mount,
  });
}
