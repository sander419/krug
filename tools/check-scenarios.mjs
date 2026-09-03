// Сквозные производственные сценарии:
//   node --import ./tools/node-three.mjs tools/check-scenarios.mjs
//
// Отдельные части инструмента проверены по отдельности — а мастер проходит
// путь целиком: рисует форму, вешает ручку, задаёт рельеф, считает деньги,
// режет G-code, выгружает модель, делится ссылкой. Ломается такой путь не
// в формуле, а на стыке: где одна часть отдаёт другой не то, что та ждёт,
// и обе по отдельности «работают».
//
// Здесь пятнадцать изделий, какие и правда делают, и каждое проходит весь
// путь. Требование одно и грубое: **ничего не падает, и ни одно число
// не выходит за пределы физического смысла**. Тонкие модели проверяют свои
// проверки; эта ловит развалившийся стык.
import { state, encodeDNA, applyDNA } from '../js/core/state.js';
import { PRESETS } from '../js/config/data.js';
import { computeProduction, computeStrength, computeWarnings, userProfileMM } from '../js/core/math.js';
import { sanitizePart } from '../js/core/parts.js';
import { sanitizeLid, lidMetrics } from '../js/core/lid.js';
import { sanitizePattern, patternTitle } from '../js/core/pattern.js';
import { sliceGCode } from '../js/core/slicer.js';
import { buildPot } from '../js/core/geometry.js';
import { byId, density } from '../js/config/materials.js';
import { sanitizeCost, pieceCost } from '../js/core/cost.js';
import { byGlazeId } from '../js/config/glazes.js';
import { firedSize, kilnLoad } from '../js/core/kiln.js';
import { byKilnId } from '../js/config/kilns.js';
import { wareProfiles, castSubjects } from '../js/core/mould.js';
import { buildSheet } from '../js/core/sheet.js';
import { record, undo, redo, canUndo, canRedo, COALESCE } from '../js/core/history.js';
import { blankWork, loadWorks, saveWorks, upsertWork, phaseById } from '../js/core/works.js';
import { withDNA } from '../js/core/state.js';
import { modelFiles } from '../js/three/exporters.js';

/* В Node нет localStorage, а хранилище работ — часть пути мастера: закрыл
   вкладку, вернулся, работа на месте. Подставляем минимальную замену —
   проверяется схема записи и миграция, а не браузер. */
if (typeof localStorage === 'undefined') {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
  };
}

const problems = [];
const P = t => problems.push(t);
const fin = v => Number.isFinite(v);

/* Пределы физического смысла. Не «красивые» числа, а границы, за которыми
   ответ означает поломку: отрицательная масса, ваза тяжелее человека,
   вместимость больше габарита, пустой G-code. */
const SANE = {
  massG: [1, 60000],          // от напёрстка до тяжёлой напольной вазы
  volMl: [0.5, 40000],
  angle: [0.5, 89],           // угол опрокидывания
  layers: [5, 4000],
  grams: [1, 60000],
};

function sane(name, label, v, [lo, hi]) {
  if (!fin(v)) { P(`«${name}»: ${label} — не число (${v})`); return; }
  if (v < lo || v > hi) P(`«${name}»: ${label} = ${v.toFixed(2)} вне разумного (${lo}…${hi})`);
}

const BASE = () => ({
  points: PRESETS[1].pts.map(p => ({...p})),
  H: 220, D: 160, segments: 72, rings: 0.4, hollow: true, wall: 5,
  footH: 6, footK: 62, allow: 20, mat: 'gzhel-red', firing: 'raw', seed: 48213,
  stage: 6, parts: [], lid: {on: false}, pattern: {layers: []},
  glazeId: 'clear-gloss', glaze: {al: 0.3, si: 3.6, ca: 0.7}, glazeOwn: false,
  pr: {printer: 1, nozzle: 4, lh: 2.4, feed: 1800, cart: 20, flow: 100, tau: 8},
  kiln: {id: 'studio-60', kwh: 6}, cast: {}, cost: {}, tune: {}, plaster: {id: 'gvvs-16', wr: 70},
});

const SCENARIOS = [
  ['гладкая кружка', {H: 95, D: 85, wall: 6, footH: 3}],
  ['кружка с ручкой', {H: 95, D: 85, wall: 6, parts: [sanitizePart({kind: 'handle', az: 0})]}],
  ['ваза с глубоким рельефом', {pattern: {layers: [{id: 'flute', n: 14, depth: 3.2}]}}],
  ['несколько слоёв рельефа', {pattern: {layers: [
    {id: 'flute', n: 16, depth: 2}, {id: 'bump', n: 12, depth: 1.5, m: 6, from: 0.3, to: 0.7},
    {id: 'wave', depth: 0.8, m: 4}, {id: 'bark', n: 20, depth: 0.6, m: 12, mute: true}]}}],
  ['рельеф на крышке', {lid: {on: true, h: 40, knobH: 16},
                        pattern: {layers: [{id: 'flute', n: 16, depth: 2}]}}],
  ['корпус с крышкой', {lid: {on: true}}],
  ['чайник целиком', {lid: {on: true}, firing: 'glaze', glazeId: 'celadon',
    parts: [sanitizePart({kind: 'spout', az: 0}), sanitizePart({kind: 'handle', az: 180})]}],
  ['под печать глиной', {pr: {printer: 1, nozzle: 6, lh: 3, feed: 2400, cart: 30, flow: 100, tau: 8},
                         pattern: {layers: [{id: 'brick', n: 12, depth: 2, m: 8}]}}],
  ['под литьё в гипс', {wall: 4, lid: {on: true}}],
  ['с глазурью на политом', {firing: 'glaze', glazeId: 'tenmoku'}],
  ['очень тонкая стенка', {wall: 2, H: 300, D: 120}],
  ['предельный рельеф', {wall: 12, pattern: {layers: [
    {id: 'star', n: 24, depth: 10}, {id: 'wave', depth: 4, m: 20},
    {id: 'bump', n: 30, depth: 6, m: 18}, {id: 'bark', n: 40, depth: 3, m: 30}]}}],
  ['фарфор на просвет', {mat: 'pg-75', wall: 4, firing: 'glaze',
                         pattern: {layers: [{id: 'window', n: 10, depth: 3.4, m: 5}]}}],
  ['крошечная вещь', {H: 50, D: 50, wall: 2, footH: 0}],
  ['напольная ваза', {H: 400, D: 400, wall: 12, footH: 12}],
];

for (const [name, over] of SCENARIOS) {
  Object.assign(state, BASE(), JSON.parse(JSON.stringify(over)));
  let prod, str, prof;
  try {
    prof = userProfileMM(state);
    prod = computeProduction(state);
    str = computeStrength(state);
  } catch (e) { P(`«${name}»: расчёт изделия упал — ${e.message}`); continue; }

  sane(name, 'масса сырца', prod.massN, SANE.massG);
  sane(name, 'масса после обжига', prod.massF, SANE.massG);
  sane(name, 'объём глины', prod.volMl, SANE.volMl);
  sane(name, 'угол опрокидывания', prod.angle, SANE.angle);
  /* Вместимость не может превышать габарит: литр в кружке 95×85 означает,
     что где-то потерялась стенка или дно. */
  const gab = Math.PI * Math.pow(state.D / 2, 2) * state.H / 1000;
  if (prod.capMl > gab) P(`«${name}»: вместимость ${prod.capMl.toFixed(0)} мл больше габарита ${gab.toFixed(0)} мл`);
  if (prod.volMl > gab * 1.4) P(`«${name}»: глины ${prod.volMl.toFixed(0)} см³ — больше габарита вещи`);
  if (prod.massF > prod.massN) P(`«${name}»: после обжига вещь тяжелее сырца`);
  if (!fin(str.minSF) || str.minSF <= 0) P(`«${name}»: запас прочности ${str.minSF}`);

  /* Замечания: считаются и не спорят сами с собой. Их содержание проверяет
     check-warnings, здесь важно, что путь не падает. */
  let warns;
  try { warns = computeWarnings(state, prod, str); }
  catch (e) { P(`«${name}»: замечания упали — ${e.message}`); continue; }
  const ok = warns.filter(w => w.lvl === 'ok').length;
  if (ok && warns.length > ok) P(`«${name}»: «мастер одобряет» вместе с ${warns.length - ok} замечаниями`);

  /* Геометрия: сетка строится и в ней нет NaN. */
  let geo;
  try { geo = buildPot(state); } catch (e) { P(`«${name}»: модель не собралась — ${e.message}`); continue; }
  const pos = geo.geometry.attributes.position;
  if (!pos || !pos.count) P(`«${name}»: в модели нет вершин`);
  else for (let i = 0; i < pos.count * 3; i++)
    if (!fin(pos.array[i])) { P(`«${name}»: в вершинах модели NaN`); break; }

  /* Крышка: если она есть, её числа тоже обязаны быть осмысленными. */
  if (state.lid.on) {
    const m = lidMetrics(prof, sanitizeLid(state.lid), state.wall, density(byId(state.mat)),
                         byId(state.mat).shrinkPct, state.pattern);
    sane(name, 'глина крышки', m.massG, [0.5, 20000]);
    if (!(m.gapFired > 0)) P(`«${name}»: зазор крышки после обжига ${m.gapFired}`);
    if (!(m.seatR > 0)) P(`«${name}»: посадка крышки вывернулась`);
  }

  /* Печать: G-code режется, слои считаются, путь не пустой. */
  let g;
  try { g = sliceGCode(state); } catch (e) { P(`«${name}»: слайсер упал — ${e.message}`); continue; }
  sane(name, 'слоёв в G-code', g.stats.layers, SANE.layers);
  sane(name, 'пасты в G-code', g.stats.grams, SANE.grams);
  if (!/^;/.test(g.text)) P(`«${name}»: G-code не начинается с шапки`);
  if (!/M2\s*$/.test(g.text.trim())) P(`«${name}»: G-code не заканчивается остановом`);
  if (/NaN|Infinity|undefined/.test(g.text)) P(`«${name}»: в G-code попали NaN/Infinity`);

  /* Деньги: себестоимость положительна и не абсурдна. */
  const per = pieceCost(state, prod, prof, {...sanitizeCost(state.cost), glaze: byGlazeId(state.glazeId)});
  if (!fin(per.total) || per.total <= 0) P(`«${name}»: себестоимость ${per.total}`);
  if (per.total > 1e6) P(`«${name}»: себестоимость ${per.total.toFixed(0)} — это не изделие, а самолёт`);

  /* Печь: габарит после обжига меньше сырого, садка считается. */
  const fired = firedSize(prof, state.parts, byId(state.mat).shrinkPct, null, {pattern: state.pattern});
  if (!(fired.d > 0 && fired.h > 0)) P(`«${name}»: габарит после обжига ${fired.d}×${fired.h}`);
  if (fired.h > state.H + 0.01) P(`«${name}»: после обжига вещь выше сырой`);
  const load = kilnLoad(byKilnId(state.kiln.id), fired, state.kiln.own);
  if (!fin(load.perShelf) || load.perShelf < 0) P(`«${name}»: садка ${load.perShelf} штук на полку`);

  /* Оснастка и лист: собираются на любом изделии. */
  try {
    if (!castSubjects(state).length) P(`«${name}»: формовать нечего — список частей пуст`);
    wareProfiles(state);
  } catch (e) { P(`«${name}»: оснастка упала — ${e.message}`); }
  try {
    const svg = buildSheet({
      name, date: '01.01.2026', dna: 'x', prof: prof.map(q => ({r: q.r, y: q.y})),
      wall: state.wall, footH: state.footH, footR: state.D / 2 * state.footK / 100,
      H: state.H, D: state.D, shrinkPct: byId(state.mat).shrinkPct,
      parts: [], rows: [['Масса', '1']], notes: ['x'],
    });
    if (!/^<svg/.test(svg.trim())) P(`«${name}»: лист A3 не собрался`);
  } catch (e) { P(`«${name}»: лист A3 упал — ${e.message}`); }

  /* Ссылка: рецепт этого изделия сворачивается и разворачивается тем же. */
  const dna = encodeDNA();
  const before = {mass: prod.massN, cap: prod.capMl, title: patternTitle(sanitizePattern(state.pattern))};
  if (!applyDNA(dna)) P(`«${name}»: своя же ссылка не открылась`);
  else {
    const after = computeProduction(state);
    if (Math.abs(after.massN - before.mass) > 0.5)
      P(`«${name}»: после ссылки масса ${after.massN.toFixed(1)} вместо ${before.mass.toFixed(1)}`);
    if (Math.abs(after.capMl - before.cap) > 0.5) P(`«${name}»: после ссылки вместимость разошлась`);
    if (patternTitle(sanitizePattern(state.pattern)) !== before.title)
      P(`«${name}»: после ссылки узор стал другим`);
  }
}

/* ---------- 16. серия отмен и повторов ---------- */
/* Отмена — разрушающая операция: если она вернёт не всё, человек продолжит
   работать поверх наполовину откаченного рецепта и не заметит. */
{
  Object.assign(state, BASE());
  const snap = () => JSON.stringify({H: state.H, wall: state.wall, mat: state.mat,
    firing: state.firing, pattern: state.pattern, parts: state.parts, lid: state.lid});
  const steps = [
    () => { state.H = 300; },
    () => { state.wall = 8; },
    () => { state.pattern = {layers: [{id: 'flute', n: 12, depth: 2}]}; },
    () => { state.parts = [sanitizePart({kind: 'handle', az: 0})]; },
    () => { state.lid = {on: true}; state.firing = 'glaze'; },
  ];
  /* Правки в инструменте идут пачками, и запись в историю отложена на COALESCE:
     тянущийся ползунок — один шаг, а не сорок. Значит и здесь между шагами
     надо ждать, иначе проверка мерила бы не ту историю, что у человека. */
  const settle = () => new Promise(r => setTimeout(r, COALESCE + 30));
  const marks = [snap()];
  for (const f of steps) { record(); await settle(); f(); marks.push(snap()); }
  record(); await settle();
  for (let i = steps.length; i > 0; i--) {
    if (!canUndo()) { P(`отмена кончилась на шаге ${i}, а шагов было ${steps.length}`); break; }
    undo();
    if (snap() !== marks[i - 1]) P(`после отмены шага ${i} рецепт не совпал с тем, что было`);
  }
  for (let i = 1; i <= steps.length; i++) {
    if (!canRedo()) { P(`повтор кончился на шаге ${i}`); break; }
    redo();
    if (snap() !== marks[i]) P(`после повтора шага ${i} рецепт не совпал`);
  }
  const prod = computeProduction(state);
  sane('после отмен и повторов', 'масса', prod.massN, SANE.massG);
}

/* ---------- 17. автосохранение и «Мои изделия» ---------- */
/* Работа возвращается в браузер записью: рецепт ссылкой, производственный
   контекст рядом. Путать эти два хранилища нельзя — рецепт уезжает другому
   человеку, контекст остаётся здесь. И список не должен теряться из-за того,
   что мы когда-то добавили колонку. */
{
  Object.assign(state, BASE(), {H: 260, pattern: {layers: [{id: 'weave', n: 12, depth: 2, m: 8}]},
                                lid: {on: true}, firing: 'glaze'});
  const dna = encodeDNA();
  const mine = computeProduction(state).massN;

  saveWorks([]);
  const rec = blankWork({name: 'Автосохранение', dna, phase: 'bisque', note: 'проба'});
  upsertWork(rec);
  const back = loadWorks().find(w => w.id === rec.id);
  if (!back) P('сохранённая работа не читается обратно');
  else {
    if (back.dna !== dna) P('запись изделия потеряла рецепт');
    if (back.phase !== 'bisque') P('запись изделия потеряла этап производства');
    if (back.note !== 'проба') P('запись изделия потеряла заметку');
    const theirs = withDNA(back.dna, s => computeProduction(s).massN);
    if (!fin(theirs) || Math.abs(theirs - mine) > 0.5)
      P(`числа по сохранённой работе (${theirs}) разошлись с открытой (${mine.toFixed(1)})`);
  }

  /* Старая запись первой схемы обязана открыться, а не пропасть. */
  saveWorks([]);
  localStorage.setItem('krug.works', JSON.stringify([{id: 'old1', name: 'Прошлый год', dna, ts: 1}]));
  const old = loadWorks();
  if (old.length !== 1) P('запись прежней схемы потерялась при чтении');
  else if (!old[0].phase || !phaseById(old[0].phase)) P('у мигрированной записи нет этапа');

  /* Мусор в хранилище не должен ронять список: у мастера их сотня. */
  for (const junk of ['не json', '{}', '[1,2,3]', '[{"id":1}]']) {
    localStorage.setItem('krug.works', junk);
    let list;
    try { list = loadWorks(); } catch (e) { P(`мусор в хранилище уронил список: ${e.message}`); continue; }
    if (!Array.isArray(list)) P(`из мусора «${junk}» вышел не список`);
    for (const w of list) if (typeof w.name !== 'string') P('в списке запись без имени');
  }
  saveWorks([]);
}


/* ---------- 18. полный производственный архив ---------- */
/* Всё, что мастер забирает: модель, крышка отдельным телом, G-code. Упадёт
   что-то здесь — человек узнает об этом в момент, когда файлы уже нужны. */
{
  Object.assign(state, BASE(), {
    lid: {on: true}, firing: 'glaze',
    pattern: {layers: [{id: 'flute', n: 14, depth: 2}, {id: 'wave', depth: 1, m: 5, from: 0.7, to: 0.95}]},
    parts: [sanitizePart({kind: 'handle', az: 90}), sanitizePart({kind: 'spout', az: 270})],
  });
  let files = [];
  try { files = modelFiles(state); }
  catch (e) { P(`архив: модели не собрались — ${e.message}`); }
  if (files.length < 2) P(`архив: файлов модели ${files.length} — корпус и крышка обязаны быть врозь`);
  for (const f of files) {
    if (!f.blob || !f.blob.size) P(`архив: «${f.name}» пустой`);
    else if (f.blob.size < 1000) P(`архив: «${f.name}» подозрительно мал (${f.blob.size} байт)`);
  }
  const names = files.map(f => f.name).join(' ');
  if (files.length && !/крышк|lid/i.test(names)) P(`архив: крышки нет среди файлов (${names})`);
  if (!sliceGCode(state).text.length) P('архив: G-code пустой');
}


console.log('\nСквозные сценарии');
console.log(`  изделий: ${SCENARIOS.length} · путь: расчёт → замечания → модель → G-code → деньги → печь → оснастка → лист → ссылка`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const t of problems) console.log('  ✗ ' + t);
  process.exit(1);
}
console.log('\nПятнадцать изделий проходят весь путь: ничего не падает, числа в пределах смысла.');
