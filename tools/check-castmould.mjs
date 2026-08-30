// Проверка формы для литья:
//   node --import ./tools/node-three.mjs tools/check-castmould.mjs
//
// По этой модели льют гипс и печатают STL. Дырка в сетке или вывернутый
// треугольник ломают и то, и другое, а на глаз не видны: картинка рисуется
// одинаково. Поэтому считаются направленные рёбра — каждое обязано встретиться
// ровно раз вместе с обратным, — и сходится объём: блок минус половина изделия
// минус половина воронки.
import { state } from '../js/core/state.js';
import { castMouldGeometry, castMouldBlock, castMouldNumbers } from '../js/three/castMould.js';
import { tune, setTune, resetTune } from '../js/core/tuning.js';
import { PRESETS } from '../js/config/data.js';

const problems = [];
const P = t => problems.push(t);

function edgeAudit(geo) {
  const q = geo.attributes.position;
  const key = i => [q.getX(i), q.getY(i), q.getZ(i)].map(v => Math.round(v * 100) / 100).join(',');
  const dirs = new Map();
  for (let i = 0; i < q.count; i += 3) {
    const k = [key(i), key(i + 1), key(i + 2)];
    for (let e = 0; e < 3; e++) {
      const id = k[e] + '>' + k[(e + 1) % 3];
      dirs.set(id, (dirs.get(id) || 0) + 1);
    }
  }
  let open = 0, flipped = 0;
  for (const [id, n] of dirs) {
    if (n > 1) flipped++;
    const [a, b] = id.split('>');
    if (!dirs.has(b + '>' + a)) open++;
  }
  return {open, flipped};
}

function volume(geo) {
  const p = geo.attributes.position;
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    const a = [p.getX(i), p.getY(i), p.getZ(i)];
    const b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
    const c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v / 1e6;                                  // литры
}

/* ---------- на всех пресетах и обеих половинах ---------- */
for (const preset of PRESETS) {
  state.points = preset.pts.map(p => ({...p}));
  for (const half of ['bump', 'socket']) {
    const L = `${preset.name} · ${half === 'bump' ? 'бугорки' : 'лунки'}`;
    const m = castMouldGeometry(state, {half});
    const a = edgeAudit(m.geometry);
    if (a.open) P(`${L}: ${a.open} рёбер без пары — тело не замкнуто`);
    if (a.flipped) P(`${L}: ${a.flipped} рёбер повторяются — треугольники смотрят в разные стороны`);

    const vol = volume(m.geometry);
    if (!(vol > 0)) P(`${L}: нормали смотрят внутрь, STL уйдёт вывернутым`);
    if (Math.abs(vol - m.plasterL) > Math.abs(m.plasterL) * 0.06 + 0.02)
      P(`${L}: объём тела ${vol.toFixed(2)} л не сходится с расчётным ${m.plasterL.toFixed(2)} л`);
    if (!(m.plasterL > 0)) P(`${L}: гипса вышло ноль или меньше`);
    if (!(m.keys >= 2)) P(`${L}: замков ${m.keys} — половины не сцентрировать`);

    // половина не должна быть меньше изделия, которое в неё ложится
    if (!(m.boxL > m.wareL + m.funnelL)) P(`${L}: полость больше блока`);
    m.geometry.dispose();
  }
}

/* Половины различаются только замками: бугорки добавляют гипс, лунки убавляют. */
state.points = PRESETS[0].pts.map(p => ({...p}));
const bump = castMouldGeometry(state, {half: 'bump'});
const sock = castMouldGeometry(state, {half: 'socket'});
if (bump.keys !== sock.keys) P('у половин разное число замков');
if (!(bump.plasterL > sock.plasterL)) P('половина с бугорками должна весить больше, чем с лунками');
if (Math.abs((bump.plasterL - sock.plasterL) - 2 * bump.keysL) > 1e-6)
  P('разница половин не равна удвоенному объёму замков');
bump.geometry.dispose(); sock.geometry.dispose();

/* ---------- числа без меша совпадают с мешем ---------- */
const n = castMouldNumbers(state);
const g = castMouldGeometry(state, {half: 'socket'});
if (Math.abs(n.plasterL - (g.plasterL + g.keysL)) > 1e-6)
  P('панель и модель считают гипс по-разному');
if (n.keys !== g.keys) P('число замков в панели не совпадает с моделью');
g.geometry.dispose();

/* ---------- настройки формы действительно меняют её ---------- */
const base = castMouldNumbers(state);
setTune('castWall', 60);
const thick = castMouldNumbers(state);
if (!(thick.plasterL > base.plasterL)) P('толстая стенка формы не добавила гипса');
resetTune('castWall');
setTune('funnelR', 60);
const wide = castMouldNumbers(state);
if (!(wide.funnelL > base.funnelL)) P('широкий литник не увеличил объём воронки');
resetTune();

/* ---------- вырожденные случаи ---------- */
state.points = [{t: 0, r: 0.02}, {t: 0.5, r: 0.02}, {t: 1, r: 0.02}];   // почти нитка
const thin = castMouldGeometry(state, {half: 'bump'});
const at = edgeAudit(thin.geometry);
if (at.open || at.flipped) P(`тонкое изделие: ${at.open} открытых, ${at.flipped} вывернутых рёбер`);
thin.geometry.dispose();

state.points = PRESETS[0].pts.map(p => ({...p}));
const blk = castMouldBlock(state);
if (!(blk.blockMM.every(v => v > 20))) P('габарит блока подозрительно мал');

console.log('Проверка формы для литья\n');
const show = castMouldNumbers(state);
console.log(`  блок половины ${show.blockMM.map(v => Math.round(v)).join('×')} мм · ` +
  `гипса ${show.plasterL.toFixed(2)} л на половину · замков ${show.keys} · ` +
  `литник ⌀${show.funnelR * 2}×${show.funnelH} мм`);

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nОбе половины замкнуты, объёмы сходятся, замки на месте.');
