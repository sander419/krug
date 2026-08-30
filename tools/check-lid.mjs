// Проверка крышки:
//   node --import ./tools/node-three.mjs tools/check-lid.mjs
//
// Крышку бьют по двум причинам, и обе — арифметика, а не рукоделие: зазор
// посчитали до обжига (после он меньше на усадку) и заглазуровали посадку
// (спеклась с горловиной). Проверка держит обе.
import { state } from '../js/core/state.js';
import { userProfileMM, computeProduction } from '../js/core/math.js';
import { byId, density } from '../js/config/materials.js';
import { firedSize } from '../js/core/kiln.js';
import { articleById } from '../js/config/kb/index.js';
import { LID_DEFAULTS, LID_LIMITS, sanitizeLid, lidProfile, lidMetrics, lidWarnings, rimOf }
  from '../js/core/lid.js';

const problems = [];
const P = t => problems.push(t);
const prof = () => userProfileMM(state);
const mat = () => byId(state.mat);

/* ---------- очистка входа ---------- */
const dirty = sanitizeLid({on: 1, type: 'ерунда', h: 1e9, wall: -5, gap: 'x'});
if (dirty.type !== 'inset') P('неизвестный тип посадки не свёлся к посадке в горловину');
if (dirty.h !== LID_LIMITS.h[1]) P('высота выше предела не обрезалась');
if (dirty.wall !== LID_LIMITS.wall[0]) P('отрицательная толщина не обрезалась');
if (dirty.gap !== LID_DEFAULTS.gap) P('нечисловой зазор не вернулся к умолчанию');
if (sanitizeLid(null).on !== false) P('без данных крышки быть не должно');

/* ---------- геометрия ---------- */
for (const type of ['inset', 'over']) {
  const lid = sanitizeLid({on: true, type});
  const L = lidProfile(prof(), lid, state.wall);
  const rim = rimOf(prof());
  const T = `посадка «${type}»`;

  if (L.pts.length < 8) P(`${T}: профиль крышки слишком беден`);
  if (L.pts.some(p => !Number.isFinite(p.r) || !Number.isFinite(p.y))) P(`${T}: в профиле NaN`);
  if (L.pts.some(p => p.r < -1e-9)) P(`${T}: отрицательный радиус`);

  // купол обязан подниматься над кромкой, а не проваливаться внутрь
  const top = Math.max(...L.pts.map(p => p.y));
  if (!(top >= rim.y + lid.h - 0.01)) P(`${T}: купол не поднялся на заданную высоту`);
  // и не должен уходить ниже посадки
  const low = Math.min(...L.pts.map(p => p.y));
  if (low < rim.y - lid.seatH - 0.01) P(`${T}: крышка свисает ниже посадочного пояска`);

  /* Посадка: в горловину — уже внутреннего радиуса, внахлёст — шире кромки.
     Ошибка здесь означает крышку, которая физически не наденется. */
  if (type === 'inset') {
    if (!(L.seatR < L.inner + 1e-9)) P('посадка в горловину шире самой горловины');
    if (!(L.seatR > 0)) P('посадка в горловину вывернулась наизнанку');
  } else if (!(L.seatR > rim.r - 1e-9)) P('накладная крышка уже кромки — не наденется');
}

/* ---------- зазор садится вместе с деталями ---------- */
const lid = sanitizeLid({on: true, gap: 1});
const m = lidMetrics(prof(), lid, state.wall, density(mat()), mat().shrinkPct);
if (!(m.gapFired < m.gapRaw)) P('зазор после обжига обязан быть меньше заложенного');
const k = 1 - mat().shrinkPct / 100;
if (Math.abs(m.gapFired - m.gapRaw * k) > 1e-9) P('зазор садится не по усадке массы');
const wide = lidMetrics(prof(), sanitizeLid({on: true, gap: 3}), state.wall, density(mat()), mat().shrinkPct);
if (!(wide.gapFired > m.gapFired)) P('больший зазор не дал большего после обжига');

/* Крышка — цельное тело со стенкой, а не поверхность: толще стенка и выше
   купол — больше глины, но не в разы, потому что растёт и внутренняя полость. */
const thick = lidMetrics(prof(), sanitizeLid({on: true, wall: 10}), state.wall, density(mat()), mat().shrinkPct);
if (!(thick.massG > m.massG)) P('толстая крышка не потяжелела');
const tall = lidMetrics(prof(), sanitizeLid({on: true, h: 60}), state.wall, density(mat()), mat().shrinkPct);
if (!(tall.massG > m.massG)) P('высокий купол не потяжелел');
if (!(m.massG > 5 && m.massG < 5000)) P(`масса крышки ${m.massG.toFixed(0)} г вне здравого смысла`);

/* ---------- контур замкнут и сам себя не режет ---------- */
function crosses(a, b, c, d) {
  const s = (p, q, r) => Math.sign((q.r - p.r) * (r.y - p.y) - (q.y - p.y) * (r.r - p.r));
  const d1 = s(a, b, c), d2 = s(a, b, d), d3 = s(c, d, a), d4 = s(c, d, b);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}
function contourArea(pts) {
  let A = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    A += p.r * q.y - q.r * p.y;
  }
  return A / 2;
}
/* Крайние настройки — там, где контур и рвётся: стенка толще купола,
   кнопка уже стенки, поясок глубже самой крышки. */
const CASES = [{}, {wall: 20}, {wall: 20, h: 4}, {h: 4}, {h: 120}, {knobH: 0},
  {knobD: 6, wall: 20}, {knobD: 90}, {seatH: 40}, {gap: 6}, {over: 40},
  {type: 'over'}, {type: 'over', wall: 20, h: 4}, {type: 'over', over: 1, gap: 6}];
for (const c of CASES) {
  const L = lidProfile(prof(), sanitizeLid({on: true, ...c}), state.wall);
  const T = 'контур ' + (JSON.stringify(c) === '{}' ? 'по умолчанию' : JSON.stringify(c));
  const A = contourArea(L.pts);
  if (!(A > 0)) P(`${T}: обход по часовой или нулевая площадь — STL выйдет вывернутым`);
  if (L.pts.some(p => p.r < 0)) P(`${T}: контур ушёл за ось вращения`);
  let hits = 0;
  for (let i = 0; i < L.pts.length; i++)
    for (let j = i + 2; j < L.pts.length; j++) {
      if (i === 0 && j === L.pts.length - 1) continue;
      if (crosses(L.pts[i], L.pts[(i + 1) % L.pts.length], L.pts[j], L.pts[(j + 1) % L.pts.length])) hits++;
    }
  if (hits) P(`${T}: контур пересекает сам себя в ${hits} местах`);
  const v = lidMetrics(prof(), sanitizeLid({on: true, ...c}), state.wall, 1.92, mat().shrinkPct);
  if (!(v.volMl > 0)) P(`${T}: объём вышел нулевым`);
}

/* ---------- крышка попадает в общий расчёт глины ---------- */
state.lid = {on: false};
const without = computeProduction(state).volMl;
state.lid = sanitizeLid({on: true});
const withLid = computeProduction(state);
if (!(withLid.lidMl > 0)) P('объём крышки не попал в расчёт изделия');
if (Math.abs(withLid.volMl - without - withLid.lidMl) > 1e-6)
  P('глина на крышку посчитана дважды или потеряна');
if (Math.abs(computeProduction(state).capMl - (state.lid = {on: false}, computeProduction(state).capMl)) > 1e-6)
  P('крышка изменила вместимость — она закрывает объём, а не добавляет его');

/* ---------- крышка занимает место в печи ---------- */
state.lid = {on: false};
const bare = firedSize(prof(), [], mat().shrinkPct);
state.lid = sanitizeLid({on: true});
const withL = firedSize(prof(), [], mat().shrinkPct,
  lidProfile(prof(), sanitizeLid(state.lid), state.wall).pts);
if (!(withL.h > bare.h + 1)) P('крышка не подняла высоту садки — ярус в печи посчитается неверно');
state.lid = {on: false};

/* ---------- замечания ---------- */
state.lid = {on: false};
if (lidWarnings(state, prof(), mat()).length) P('у выключенной крышки замечаний быть не должно');

state.lid = sanitizeLid({on: true, gap: 0});
const tight = lidWarnings(state, prof(), mat());
if (!tight.some(w => /застрянет/.test(w.txt))) P('нулевой зазор не дал замечания о заклинившей крышке');

state.lid = sanitizeLid({on: true, gap: 5});
if (!lidWarnings(state, prof(), mat()).some(w => /болтать/.test(w.txt)))
  P('огромный зазор не дал замечания о болтающейся крышке');

state.lid = sanitizeLid({on: true, gap: 1});
state.firing = 'glaze';
if (!lidWarnings(state, prof(), mat()).some(w => /не глазуруется/.test(w.txt)))
  P('под глазурью не сказано, что посадку не глазуруют — это главная причина боя');
state.firing = 'raw';

/* Тонкая крышка при толстом корпусе — предупреждение, а не молчание. */
state.lid = sanitizeLid({on: true, wall: 2});
state.wall = 8;
if (!lidWarnings(state, prof(), mat()).some(w => /тоньше корпуса/.test(w.txt)))
  P('тонкая крышка при толстом корпусе не отмечена');
state.wall = 5;
state.lid = {on: false};

/* Кнопка «почему» ведёт в энциклопедию: несуществующая статья — молчащая кнопка. */
{
  const seen = new Set();
  for (const c of [{gap: 0}, {gap: 5}, {wall: 2}, {seatH: 40}]) {
    state.lid = sanitizeLid({on: true, ...c});
    state.wall = 8;
    for (const w of lidWarnings(state, prof(), mat())) if (w.help) seen.add(w.help);
  }
  state.firing = 'glaze';
  for (const w of lidWarnings(state, prof(), mat())) if (w.help) seen.add(w.help);
  state.firing = 'raw'; state.wall = 5; state.lid = {on: false};
  for (const id of seen)
    if (!articleById(id)) P(`замечание ведёт в несуществующую статью «${id}»`);
  if (seen.size < 3) P('у замечаний крышки почти нет ссылок на энциклопедию');
}

console.log('Проверка крышки\n');
const show = lidMetrics(prof(), sanitizeLid({on: true}), state.wall, density(mat()), mat().shrinkPct);
console.log(`  посадка ⌀${(show.seatR * 2).toFixed(1)} мм сырая → ⌀${show.firedSeatMM.toFixed(1)} после обжига · ` +
  `зазор ${show.gapRaw} → ${show.gapFired.toFixed(2)} мм · глины ${show.massG.toFixed(0)} г`);

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nКрышка садится: зазор считается после обжига, посадка не глазуруется.');
