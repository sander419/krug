// Готовность изделия:
//   node --import ./tools/node-three.mjs tools/check-readiness.mjs
//
// Статус «готово / замечания / не хватает данных / невозможно» — самое
// опасное место продукта: он короткий, заметный, и ему верят. Соврать он может
// двумя способами. Первый — сказать «готово» вещи, которая не влезет в печь.
// Второй, тише и хуже, — стать украшением: гореть красным «вообще» и не уметь
// показать, из-за чего именно.
//
// Отсюда требования, которые здесь проверяются:
//   • у любого не-зелёного статуса есть причины, и каждая — настоящий текст;
//   • худшая причина стоит первой: человек читает первую строку;
//   • отказ (blocked) ставится только на том, что действительно не выйдет:
//     не влезло в печь, слой толще сопла, стенка прорвана;
//   • «не хватает данных» не выдумывается: гипс не мешает тому, кто печатает;
//   • статус не пересчитывает изделие сам — он собран из того, что уже
//     показано человеку. Дай ему другие замечания — изменится и он.
import { state } from '../js/core/state.js';
import { PRESETS } from '../js/config/data.js';
import { computeProduction, computeStrength, computeWarnings, userProfileMM } from '../js/core/math.js';
import { sliceGCode } from '../js/core/slicer.js';
import { readiness, readinessLabel, LEVELS } from '../js/core/readiness.js';
import { ROUTES } from '../js/config/routes.js';

const problems = [];
const P = t => problems.push(t);

const BASE = () => ({
  points: PRESETS[1].pts.map(p => ({...p})),
  H: 220, D: 160, segments: 72, rings: 0.4, hollow: true, wall: 5,
  footH: 6, footK: 62, allow: 20, mat: 'gzhel-red', firing: 'raw', seed: 1, stage: 6,
  parts: [], lid: {on: false}, pattern: {layers: []},
  glazeId: 'clear-gloss', glaze: {al: 0.3, si: 3.6, ca: 0.7},
  pr: {printer: 1, nozzle: 4, lh: 2.4, feed: 1800, cart: 20, flow: 100, tau: 8},
  kiln: {id: 'studio-60', kwh: 6}, cast: {}, cost: {}, tune: {}, plaster: {id: 'gvvs-16', wr: 70},
});
const PRINT_TABS = ['form', 'mat', 'print', 'glaze', 'money'];

function status(over, tabs = PRINT_TABS) {
  Object.assign(state, BASE(), JSON.parse(JSON.stringify(over)));
  const prof = userProfileMM(state);
  const prod = computeProduction(state);
  const str = computeStrength(state);
  const warnings = computeWarnings(state, prod, str).filter(w => !w.area || tabs.includes(w.area));
  let gcode = null;
  try { gcode = sliceGCode(state); } catch (e) { gcode = {warnings: [{cls: 'e', txt: 'G-code не строится: ' + e.message}]}; }
  return readiness(state, {prod, str, warnings, gcode, prof, tabs});
}

/* ---------- отказ ставится только на настоящем отказе ---------- */
{
  const huge = status({H: 400, D: 400, wall: 12});
  if (huge.level !== 'blocked') P(`вещь ⌀40 см в студийной печи: статус «${huge.level}», а она туда не входит`);
  if (!huge.reasons.some(r => /печ/i.test(r.where) || /печ/i.test(r.txt)))
    P('вещь не влезает в печь, а среди причин печи нет');

  const thick = status({pr: {printer: 1, nozzle: 3, lh: 3, feed: 1800, cart: 20, flow: 100, tau: 8}});
  if (thick.level !== 'blocked') P(`слой толще сопла: статус «${thick.level}» вместо отказа`);

  const pierced = status({wall: 4, pattern: {layers: [{id: 'flute', n: 12, depth: 5}]}});
  if (pierced.level !== 'blocked') P(`рельеф прорвал стенку: статус «${pierced.level}» вместо отказа`);

  /* И обратно: обычная вещь не должна получать отказ. Замечания у неё быть
     могут — печатная стенка не равна рецептной, — но не отказ. */
  const plain = status({});
  if (plain.level === 'blocked') P(`обычная ваза получила отказ: ${plain.reasons[0] && plain.reasons[0].txt}`);
  const tuned = status({wall: 4.2});
  if (tuned.level === 'blocked') P('ваза со стенкой под бусину получила отказ');
}

/* ---------- причины: они есть, они настоящие, худшая первая ---------- */
{
  for (const [name, over] of [['не влезает', {H: 400, D: 400}], ['тонкая стенка', {wall: 2}],
                              ['прорыв', {wall: 4, pattern: {layers: [{id: 'flute', n: 12, depth: 5}]}}],
                              ['обычная', {}]]) {
    const r = status(over);
    if (r.level !== 'ready' && !r.reasons.length) P(`«${name}»: статус «${r.level}» без единой причины`);
    for (const x of r.reasons) {
      if (!x.txt || x.txt.length < 20) P(`«${name}»: причина «${x.txt}» ничего не объясняет`);
      if (!x.where) P(`«${name}»: у причины «${String(x.txt).slice(0, 30)}…» не сказано, откуда она`);
      if (!['blocked', 'warn', 'unknown'].includes(x.lvl)) P(`«${name}»: у причины уровень «${x.lvl}»`);
    }
    /* Худшая — первой: человек читает первую строку и по ней решает. */
    const order = ['blocked', 'warn', 'unknown'];
    for (let i = 1; i < r.reasons.length; i++)
      if (order.indexOf(r.reasons[i].lvl) < order.indexOf(r.reasons[i - 1].lvl))
        P(`«${name}»: причины идут не от худшей — ${r.reasons[i - 1].lvl} перед ${r.reasons[i].lvl}`);
    /* Уровень статуса равен худшей причине, а не «в среднем». */
    if (r.reasons.length && r.level !== r.reasons[0].lvl)
      P(`«${name}»: статус «${r.level}», а худшая причина «${r.reasons[0].lvl}»`);
    if (!r.reasons.length && r.level !== 'ready') P(`«${name}»: причин нет, а статус «${r.level}»`);
  }
}

/* ---------- «не хватает данных» не выдумывается ---------- */
{
  /* Водогипсовое отношение марки не мешает тому, кто печатает вазу: у него
     нет гипса вовсе. Раньше статус на этом основании желтел у всех. */
  const printing = status({}, PRINT_TABS);
  if (printing.reasons.some(r => /гипс/i.test(r.where)))
    P('печатной вазе мешает неизвестное водогипсовое отношение — гипса в ней нет');
  const moulding = status({}, ['form', 'mat', 'tool', 'cast']);
  if (!moulding.reasons.some(r => /гипс/i.test(r.where)))
    P('форму делают из гипса с неизвестным В/Г, а статус об этом молчит');

  /* Своя печь без мощности — честное «нечем считать», а не отказ. */
  const own = status({kiln: {id: 'own', kwh: 6}});
  if (!own.reasons.some(r => /мощност/i.test(r.txt))) P('у своей печи не задана мощность, а статус молчит');
  if (own.level === 'blocked') P('своя печь без мощности объявлена отказом — считать нечем, но делать можно');
}

/* ---------- статус собран из показанного, а не посчитан заново ---------- */
{
  Object.assign(state, BASE());
  const prof = userProfileMM(state);
  const prod = computeProduction(state);
  const str = computeStrength(state);
  const empty = readiness(state, {prod, str, warnings: [], gcode: {warnings: []}, prof, tabs: PRINT_TABS});
  if (empty.level !== 'ready') P(`без замечаний статус «${empty.level}» — значит, он считает что-то своё`);
  const fake = readiness(state, {prod, str, warnings: [{lvl: 'bad', txt: 'Выдуманное замечание для проверки.'}],
                                 gcode: {warnings: []}, prof, tabs: PRINT_TABS});
  if (fake.level !== 'blocked') P('красное замечание не сделало статус отказом');
  if (!fake.reasons.some(r => /Выдуманное/.test(r.txt))) P('статус не взял причину из показанных замечаний');

  /* Подпись читается по-русски при любом числе причин. */
  for (const n of [1, 2, 5, 11, 21, 22]) {
    const r = {level: 'warn', reasons: Array(n).fill({lvl: 'warn', txt: 'x', where: 'y'})};
    const s = readinessLabel(r);
    if (!/причин[аы]?$/.test(s)) P(`подпись «${s}» при ${n} причинах читается не по-русски`);
  }
  if (readinessLabel({level: 'ready', reasons: []}) !== LEVELS.ready.name) P('готовое изделие подписано не как готовое');
}

/* ---------- статус живёт на всех задачах ---------- */
/* Задача — это набор вкладок. Ни на одной из них статус не должен падать
   или молчать о том, что вещь не выйдет. */
for (const route of ROUTES) {
  const r = status({H: 400, D: 400}, route.tabs);
  if (r.level !== 'blocked') P(`задача «${route.name || route.id}»: непечатаемая вещь получила «${r.level}»`);
}

console.log('\nГотовность изделия');
console.log(`  уровней: ${Object.keys(LEVELS).length} · задач проверено: ${ROUTES.length}`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const t of problems) console.log('  ✗ ' + t);
  process.exit(1);
}
console.log('\nСтатус собран из показанных замечаний, причины настоящие, худшая первой.');
