// Проверка замечаний мастера:
//   node --import ./tools/node-three.mjs tools/check-warnings.mjs
//
// Замечание — единственное место, где инструмент говорит «так нельзя». Оно же
// ломается тише всего: кнопка «почему» ведёт в статью, которой нет; замечание
// помечено вкладкой, которой нет ни в одной задаче, — и интерфейс прячет его
// молча; текст обрывается на полуслове или говорит «ошибка» вместо того, что
// делать. Ни одну из этих поломок не видно, пока не встретишь именно её.
//
// Поэтому здесь перебор: два десятка изделий, у каждого свои материалы, узор,
// прилепы, крышка и обжиг, — и все замечания, которые инструмент выдаёт, идут
// через одни и те же требования.
import { state } from '../js/core/state.js';
import { PRESETS } from '../js/config/data.js';
import { MATERIALS } from '../js/config/materials.js';
import { GLAZES } from '../js/config/glazes.js';
import { ROUTES } from '../js/config/routes.js';
import { articleById, helpArticleId } from '../js/config/kb/index.js';
import { computeProduction, computeStrength, computeWarnings, userProfileMM } from '../js/core/math.js';
import { sanitizePart } from '../js/core/parts.js';
import { sliceGCode } from '../js/core/slicer.js';

const problems = [];
const P = t => problems.push(t);
const seen = new Map();                     // текст → откуда пришёл

const TABS = new Set(ROUTES.flatMap(r => r.tabs));
const LVL = new Set(['ok', 'warn', 'bad']);

/* Изделия для перебора: не «разные числа», а разные поводы для замечаний —
   тонкая стенка, неустойчивость, глубокий рельеф, тесная крышка, прилепы,
   глазурь на политом обжиге, мелкий узор под толстым соплом. */
const CASES = [
  ['ваза по умолчанию', {}],
  ['тонкая стенка', {wall: 2}],
  ['толстая стенка', {wall: 12}],
  ['сплошная', {hollow: false}],
  ['высокая и узкая', {H: 400, D: 60}],
  ['низкая и широкая', {H: 60, D: 400}],
  ['без ножки', {footH: 0}],
  ['фарфор политой', {mat: MATERIALS[MATERIALS.length - 1].id, firing: 'glaze'}],
  ['глубокий узор', {pattern: {layers: [{id: 'flute', n: 12, depth: 4.5}]}}],
  ['мелкий узор', {pattern: {layers: [{id: 'flute', n: 60, depth: 2}]}}],
  ['частые кольца', {pattern: {layers: [{id: 'wave', depth: 1.5, m: 40}]}}],
  ['окна на просвет', {pattern: {layers: [{id: 'window', n: 10, depth: 3.8, m: 5}]}, wall: 4}],
  ['стопка из трёх', {pattern: {layers: [
    {id: 'flute', n: 14, depth: 2}, {id: 'bump', n: 10, depth: 1.5, m: 6, from: 0.3, to: 0.7},
    {id: 'wave', depth: 0.8, m: 4}]}}],
  ['запредельная закрутка', {pattern: {layers: [{id: 'flute', n: 12, depth: 2, twist: 700}]}}],
  ['ручка в ложбине', {pattern: {layers: [{id: 'flute', n: 10, depth: 2.5}]},
                       parts: [sanitizePart({kind: 'handle', az: 72})]}],
  ['чайник', {parts: [sanitizePart({kind: 'spout', az: 0}), sanitizePart({kind: 'handle', az: 180})]}],
  ['слив', {parts: [sanitizePart({kind: 'lip', az: 0})]}],
  ['крышка в горловину', {lid: {on: true}}],
  ['крышка внахлёст, политая', {lid: {on: true, type: 'over'}, firing: 'glaze'}],
  ['крышка тонкая с узором', {lid: {on: true, wall: 3},
                              pattern: {layers: [{id: 'flute', n: 16, depth: 2.6}]}}],
  ['узор на тираж', {pattern: {layers: [{id: 'bump', n: 12, depth: 2, m: 6}]}}],
  ['сопло толстое', {pr: {...state.pr, nozzle: 8, lh: 4}}],
  ['слой толще сопла', {pr: {...state.pr, nozzle: 3, lh: 3}}],
];

const BASE = JSON.parse(JSON.stringify({
  points: state.points, H: state.H, D: state.D, wall: state.wall, hollow: state.hollow,
  footH: state.footH, footK: state.footK, mat: state.mat, firing: state.firing,
  parts: state.parts, lid: state.lid, pattern: state.pattern, pr: state.pr,
  glazeId: state.glazeId, segments: state.segments,
}));

function check(where, w) {
  const txt = String(w.txt || '');
  if (!txt.trim()) { P(`${where}: пустое замечание`); return; }
  if (txt.length < 25) P(`${where}: «${txt}» короче двадцати пяти знаков — это ярлык, а не объяснение`);
  if (!/[.!?»]$/.test(txt.trim())) P(`${where}: «${txt.slice(0, 40)}…» не заканчивается точкой`);
  /* Замечание обязано говорить, что делать или чем это грозит. «Ошибка»
     и «неверно» — это не замечание мастера, а отписка. */
  if (/^(ошибка|неверно|нельзя)[.!]?$/i.test(txt.trim())) P(`${where}: «${txt}» ничего не объясняет`);
  if (w.lvl && !LVL.has(w.lvl)) P(`${where}: уровень «${w.lvl}» не из ok/warn/bad`);
  /* Кнопка «почему» ведёт в энциклопедию, и ключ бывает двух родов: короткое
     имя повода из CONTEXT_HELP и прямой id статьи. Не разрешился ни так,
     ни так — кнопка есть, а нажатие не делает ничего. */
  if (w.help && !helpArticleId(w.help))
    P(`${where}: «почему» ведёт в «${w.help}» — ни повода такого, ни статьи`);
  /* Вкладка, которой нет ни в одной задаче, означает замечание, которое
     интерфейс спрячет всегда и у всех. */
  if (w.area && !TABS.has(w.area)) P(`${where}: вкладка «${w.area}» не входит ни в одну задачу`);
  if (!seen.has(txt)) seen.set(txt, where);
}

let total = 0, withHelp = 0;
for (const [name, over] of CASES) {
  Object.assign(state, JSON.parse(JSON.stringify(BASE)), JSON.parse(JSON.stringify(over)));
  state.points = PRESETS[1].pts.map(p => ({...p}));
  let list, gcode;
  try {
    const prod = computeProduction(state);
    list = computeWarnings(state, prod, computeStrength(state));
  } catch (e) { P(`«${name}»: замечания не посчитались вовсе — ${e.message}`); continue; }
  for (const w of list) { total++; if (w.help) withHelp++; check(`«${name}»`, w); }

  /* Слайсер говорит своим набором и своим форматом (cls вместо lvl) —
     но требования к тексту те же: это то же окно мастера. */
  try { gcode = sliceGCode(state); } catch (e) { P(`«${name}»: слайсер упал — ${e.message}`); continue; }
  for (const w of gcode.warnings) {
    total++;
    if (!['e', 'w'].includes(w.cls)) P(`«${name}» (G-code): уровень «${w.cls}» не из e/w`);
    check(`«${name}» (G-code)`, {txt: w.txt, lvl: w.cls === 'e' ? 'bad' : 'warn'});
  }

  /* Одно и то же дважды в одном списке — верный признак, что замечание
     собирают в двух местах. */
  const texts = list.map(w => w.txt);
  if (new Set(texts).size !== texts.length) P(`«${name}»: одно и то же замечание в списке дважды`);
  /* «Всё чисто» не уживается с замечаниями: либо одно, либо другое. */
  const ok = list.filter(w => w.lvl === 'ok').length;
  if (ok && list.length > ok) P(`«${name}»: «мастер одобряет» стоит рядом с ${list.length - ok} замечаниями`);
}

/* Глазурь: у каждой в реестре свой вердикт, и он тоже обязан быть внятным. */
Object.assign(state, JSON.parse(JSON.stringify(BASE)));
state.firing = 'glaze';
for (const g of GLAZES) {
  state.glazeId = g.id;
  const list = computeWarnings(state, computeProduction(state), computeStrength(state));
  for (const w of list) { total++; check(`глазурь «${g.name}»`, w); }
}

if (total < 40) P(`замечаний собралось всего ${total} — перебор ничего не задел`);
if (!withHelp) P('ни у одного замечания нет ссылки в энциклопедию');

console.log('\nПроверка замечаний мастера');
console.log(`  изделий в переборе: ${CASES.length + GLAZES.length} · замечаний: ${total} · разных текстов: ${seen.size}`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const t of problems) console.log('  ✗ ' + t);
  process.exit(1);
}
console.log('\nКаждое замечание объясняет, ведёт в существующую статью и попадает на живую вкладку.');
