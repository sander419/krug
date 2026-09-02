// Проверка слайсера: node --import ./tools/node-three.mjs tools/check-gcode.mjs
// G-code — единственная выгрузка, которую машина исполняет буквально. Ошибка
// здесь обнаруживается у принтера, а не на экране, поэтому проверяется отдельно.
import { state } from '../js/core/state.js';
import { sliceGCode } from '../js/core/slicer.js';
import { PRINTERS } from '../js/config/data.js';
import { PRESETS } from '../js/config/data.js';

const problems = [];
const P = m => problems.push(m);

function parse(text) {
  const pts = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('G1')) continue;
    const x = line.match(/X(-?[\d.]+)/), y = line.match(/Y(-?[\d.]+)/),
          z = line.match(/Z(-?[\d.]+)/), e = line.match(/E(-?[\d.]+)/);
    const v = {x: x && +x[1], y: y && +y[1], z: z && +z[1], e: e && +e[1]};
    for (const k of ['x', 'y', 'z', 'e']) if (v[k] !== null && !Number.isFinite(v[k])) bad++;
    pts.push(v);
  }
  return {pts, bad};
}

state.points = PRESETS[1].pts.map(p => ({...p}));
state.H = 200; state.hollow = true; state.wall = 5;

/* ---------- траектория лежит на столе ---------- */
for (let i = 0; i < PRINTERS.length; i++) {
  const pr = PRINTERS[i];
  if (!['corner', 'center'].includes(pr.origin)) { P(`${pr.name}: не задан ноль стола`); continue; }
  state.pr.printer = i;
  state.D = Math.min(pr.bed[0], pr.bed[1]) * 0.7;
  state.pr.nozzle = pr.nozzle; state.pr.lh = pr.lh; state.pr.cart = pr.cart;
  const g = sliceGCode(state);
  const {pts, bad} = parse(g.text);
  if (bad) P(`${pr.name}: ${bad} нечисловых координат`);

  const xs = pts.map(p => p.x).filter(v => v != null);
  const ys = pts.map(p => p.y).filter(v => v != null);
  // спираль — десятки тысяч точек, поэтому минимум и максимум считаем циклом:
  // Math.min(...xs) на таком массиве переполняет стек аргументов
  const box = [Infinity, -Infinity, Infinity, -Infinity];
  for (const v of xs) { if (v < box[0]) box[0] = v; if (v > box[1]) box[1] = v; }
  for (const v of ys) { if (v < box[2]) box[2] = v; if (v > box[3]) box[3] = v; }
  if (pr.origin === 'corner') {
    if (box[0] < -0.01 || box[2] < -0.01)
      P(`${pr.name}: отрицательные координаты (X от ${box[0].toFixed(1)}, Y от ${box[2].toFixed(1)}) — ноль стола в углу`);
    if (box[1] > pr.bed[0] + 0.01 || box[3] > pr.bed[1] + 0.01)
      P(`${pr.name}: траектория за столом (X до ${box[1].toFixed(1)} при ${pr.bed[0]})`);
    const cx = (box[0] + box[1]) / 2, cy = (box[2] + box[3]) / 2;
    if (Math.abs(cx - pr.bed[0] / 2) > 1 || Math.abs(cy - pr.bed[1] / 2) > 1)
      P(`${pr.name}: изделие не по центру стола (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
  } else {
    const cx = (box[0] + box[1]) / 2;
    if (Math.abs(cx) > 1) P(`${pr.name}: у дельты изделие должно стоять вокруг нуля, а стоит в ${cx.toFixed(0)}`);
  }

  /* подача только вперёд, слои только вверх */
  let lastE = -Infinity, lastZ = -Infinity, backE = 0, backZ = 0;
  for (const p of pts) {
    if (p.e != null) { if (p.e < lastE - 1e-9) backE++; lastE = p.e; }
    if (p.z != null) { if (p.z < lastZ - 0.01) backZ++; lastZ = p.z; }
  }
  if (backE) P(`${pr.name}: подача откатывается назад ${backE} раз — в LDM ретракций нет`);
  if (backZ > 1) P(`${pr.name}: сопло опускается ${backZ} раз, а спираль должна идти вверх`);

  const head = g.text.split('\n').slice(0, 14).join('\n');
  for (const need of ['G21', 'G90', 'G28', 'ноль стола'])
    if (!head.includes(need)) P(`${pr.name}: в шапке нет ${need}`);
  if (!g.text.trim().endsWith('M2')) P(`${pr.name}: файл не завершён M2`);
  if (!(g.stats.lenM > 0 && g.stats.grams > 0 && g.stats.mins > 0))
    P(`${pr.name}: статистика пути пустая`);
}

/* ---------- состояние по умолчанию печатается без ошибок ---------- */
{
  const fresh = (await import('../js/core/state.js?fresh')).state;
  const g = sliceGCode(fresh);
  const bad = g.warnings.filter(x => x.cls === 'e');
  if (bad.length) P('форма по умолчанию не слайсится: ' + bad.map(x => x.txt).join('; '));
}

/* ---------- предупреждения срабатывают там, где должны ---------- */
state.pr.printer = 0;
state.D = 300;                                   // заведомо больше стола 152
let w = sliceGCode(state).warnings;
if (!w.some(x => x.cls === 'e' && /камер/i.test(x.txt))) P('изделие шире стола — нет ошибки о камере');
state.D = 100;
state.pr.nozzle = 2; state.pr.lh = 2;            // слой равен соплу
w = sliceGCode(state).warnings;
if (!w.some(x => x.cls === 'e')) P('слой равен соплу — нет ошибки о склейке');
state.pr.lh = 0.3;                               // слой втрое тоньше нормы
w = sliceGCode(state).warnings;
if (!w.some(x => x.cls === 'w')) P('слишком тонкий слой — нет предупреждения');

/* ---------- время оборота слоя ---------- */
state.pr.printer = 1; state.D = 60; state.H = 300;
state.pr.nozzle = 4; state.pr.lh = 2.4; state.pr.feed = 3600;
const fast = sliceGCode(state);
if (!(fast.stats.layerSec > 0)) P('время оборота слоя не считается');
if (!fast.warnings.some(x => /оборот слоя/i.test(x.txt))) P('узкая быстрая форма — нет предупреждения о времени слоя');
/* Спираль идёт от дна одним ходом и крышку не печатает. Молчать об этом нельзя:
   в STL крышка уже уехала отдельной деталью, и человек ждёт её и в G-code. */
{
  const keep = state.lid;
  state.lid = {on: false};
  if (sliceGCode(state).warnings.some(x => /крышк/i.test(x.txt))) P('без крышки слайсер о ней предупреждает');
  state.lid = {on: true};
  if (!sliceGCode(state).warnings.some(x => /крышк/i.test(x.txt)))
    P('крышка есть, а слайсер молчит: в G-code её нет, и об этом надо сказать');
  state.lid = keep;
}
state.pr.feed = 300;
const slow = sliceGCode(state);
if (slow.warnings.some(x => /оборот слоя/i.test(x.txt))) P('на медленной подаче предупреждения о времени слоя быть не должно');
if (!(slow.stats.layerSec > fast.stats.layerSec)) P('медленнее подача — длиннее оборот слоя: зависимость нарушена');

console.log(`Слайсер: проверено ${PRINTERS.length} принтера`);
for (const pr of PRINTERS) console.log(`  ${pr.name.padEnd(24)} ноль ${pr.origin === 'center' ? 'в центре' : 'в углу'} · стол ${pr.bed.join('×')} мм`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nТраектория ложится на стол, подача идёт вперёд, предупреждения на месте.');
