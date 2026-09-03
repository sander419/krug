// Замер производительности:
//   node --import ./tools/node-three.mjs tools/bench.mjs
//
// Это не проверка, а замер: он ничего не роняет и ничего не требует. Нужен он
// затем, что «стало медленнее» — самое незаметное изменение из всех. Кадр
// вырос с одной миллисекунды до восьми, и вкладка начала дёргаться там, где
// вчера не дёргалась; никакая проверка этого не увидит, а мастер увидит сразу.
//
// Потолки, за которыми становится плохо, стоят в `tools/check-limits.mjs` —
// там они и роняют сборку. Здесь просто цифры, чтобы было с чем сравнивать.
//
// Мерится то, что человек делает руками: тянет ползунок (пересборка кадра),
// смотрит массу, режет G-code, выгружает файлы.
import { state } from '../js/core/state.js';
import { PRESETS } from '../js/config/data.js';
import { computeProduction, computeStrength, computeWarnings, userProfileMM } from '../js/core/math.js';
import { buildPot } from '../js/core/geometry.js';
import { sliceGCode } from '../js/core/slicer.js';
import { modelFiles, objText } from '../js/three/exporters.js';
import { sanitizePart } from '../js/core/parts.js';
import { patternCurvature, sanitizePattern } from '../js/core/pattern.js';
import { buildSheet } from '../js/core/sheet.js';
import { byId } from '../js/config/materials.js';

const BASE = () => Object.assign(state, {
  points: PRESETS[1].pts.map(p => ({...p})), H: 220, D: 160, segments: 72, rings: 0.4,
  hollow: true, wall: 5, footH: 6, footK: 62, allow: 20, mat: 'gzhel-red', firing: 'raw',
  stage: 6, parts: [], lid: {on: false}, pattern: {layers: []}, glazeId: 'clear-gloss',
  glaze: {al: 0.3, si: 3.6, ca: 0.7},
  pr: {printer: 1, nozzle: 4, lh: 2.4, feed: 1800, cart: 20, flow: 100, tau: 8},
  kiln: {id: 'studio-60', kwh: 6}, cast: {}, cost: {}, tune: {}, plaster: {id: 'gvvs-16', wr: 70},
});

/* Медиана, а не среднее: один случайный тормоз от сборщика мусора не должен
   портить картину. */
function ms(fn, iterations = 30) {
  fn();                                    // прогрев: первый вызов всегда дороже
  const runs = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)];
}

const LAYERS = {
  'гладкая': [],
  'один слой': [{id: 'flute', n: 16, depth: 2}],
  'два слоя': [{id: 'flute', n: 16, depth: 2}, {id: 'bump', n: 12, depth: 1.5, m: 6}],
  'четыре слоя': [{id: 'flute', n: 16, depth: 2}, {id: 'bump', n: 12, depth: 1.5, m: 6},
                  {id: 'wave', depth: 0.8, m: 4}, {id: 'bark', n: 20, depth: 0.6, m: 12}],
  'предел повторов': [{id: 'flute', n: 64, depth: 2}, {id: 'bark', n: 64, depth: 1, m: 40},
                      {id: 'weave', n: 64, depth: 1, m: 40}, {id: 'brick', n: 64, depth: 1, m: 40}],
};

console.log('\nЗамер производительности КРУГа');
console.log(`  ${process.version} · профиль 90 точек · сегментов 72\n`);

console.log('  Сборка кадра (ползунок и «Кинотеатр»)');
for (const [name, layers] of Object.entries(LAYERS)) {
  BASE();
  state.pattern = {layers};
  let g = null;
  const t = ms(() => { g = buildPot(state, g).geometry; }, 40);
  console.log(`    ${name.padEnd(18)} ${t.toFixed(2).padStart(6)} мс`);
}

BASE();
console.log('\n  Сложный профиль (24 точки, 128 сегментов, четыре слоя)');
{
  state.points = Array.from({length: 24}, (_, i) => ({t: i / 23, r: 0.35 + 0.4 * Math.abs(Math.sin(i * 1.7))}));
  state.segments = 128;
  state.pattern = {layers: LAYERS['четыре слоя']};
  let g = null;
  console.log(`    сборка кадра      ${ms(() => { g = buildPot(state, g).geometry; }, 30).toFixed(2).padStart(6)} мс`);
}

console.log('\n  Расчёт');
BASE();
state.pattern = {layers: LAYERS['два слоя']};
state.parts = [sanitizePart({kind: 'handle', az: 90})];
state.lid = {on: true};
console.log(`    масса и объём     ${ms(() => computeProduction(state)).toFixed(2).padStart(6)} мс`);
console.log(`    прочность         ${ms(() => computeStrength(state)).toFixed(2).padStart(6)} мс`);
console.log(`    кривизна рельефа  ${ms(() => patternCurvature(sanitizePattern(state.pattern), {D: state.D, H: state.H, bead: 4.2})).toFixed(2).padStart(6)} мс`);
{
  const prod = computeProduction(state), str = computeStrength(state);
  console.log(`    замечания         ${ms(() => computeWarnings(state, prod, str)).toFixed(2).padStart(6)} мс`);
}

console.log('\n  Выгрузка');
console.log(`    G-code            ${ms(() => sliceGCode(state), 5).toFixed(1).padStart(6)} мс`);
console.log(`    STL + крышка      ${ms(() => modelFiles(state), 5).toFixed(1).padStart(6)} мс`);
console.log(`    OBJ               ${ms(() => objText(state), 5).toFixed(1).padStart(6)} мс`);
{
  const prof = userProfileMM(state), mat = byId(state.mat);
  const model = {name: 'bench', date: '', dna: '', prof: prof.map(q => ({r: q.r, y: q.y})),
                 wall: state.wall, footH: state.footH, footR: state.D / 2 * state.footK / 100,
                 H: state.H, D: state.D, shrinkPct: mat.shrinkPct, parts: [], rows: [['x', '1']], notes: []};
  console.log(`    лист A3           ${ms(() => buildSheet(model), 10).toFixed(1).padStart(6)} мс`);
}

/* GLB собирается в сцене (three + WebGL), которой в командной строке нет.
   Врать про его время нельзя, поэтому здесь честный пропуск. */
console.log('    GLB               — меряется только в браузере: собирается из сцены');

console.log('\n  Память');
{
  BASE();
  state.pattern = {layers: LAYERS['четыре слоя']};
  const before = process.memoryUsage().heapUsed;
  let g = null;
  for (let i = 0; i < 400; i++) { state.stage = 1 + (i % 50) / 10; g = buildPot(state, g).geometry; }
  const grew = (process.memoryUsage().heapUsed - before) / 1048576;
  console.log(`    400 пересборок    ${grew >= 0 ? '+' : ''}${grew.toFixed(1)} МБ кучи`);
}
console.log('');
