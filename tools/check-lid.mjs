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
import { LID_DEFAULTS, LID_LIMITS, sanitizeLid, lidProfile, lidMetrics, lidWarnings, rimOf,
         lidReliefWeights, lidWarpFn, lidPatternVolumeMl } from '../js/core/lid.js';
import { sanitizePattern } from '../js/core/pattern.js';
import { buildLathe } from '../js/core/lathe.js';

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

/* ---------- узор на куполе ---------- */
/* Крышку печатает то же сопло, и рельеф корпуса переходит на её купол. Но
   не весь: посадка обязана остаться гладкой, иначе крышка просто не сядет,
   а на вершине купола сегменты сходятся к оси и рельеф там сминается. */
{
  const pat = sanitizePattern({layers: [{id: 'flute', n: 16, depth: 2}]});
  const lid = sanitizeLid({on: true});
  const L = lidProfile(prof(), lid, state.wall);
  const w = lidReliefWeights(L);
  const rim = rimOf(prof());

  for (let j = 0; j < L.pts.length; j++) {
    const p = L.pts[j];
    if (!L.outerFlag[j] && w[j] > 0) P('рельеф попал на изнанку крышки');
    if (p.y <= rim.y + 0.01 && w[j] > 0) P('рельеф попал на посадочный поясок — крышка не сядет');
    if (p.r <= L.kr + 0.01 && w[j] > 0.01) P('рельеф попал на кнопку');
  }
  const domeW = Math.max(...Array.from(w));
  if (domeW < 0.99) P(`на куполе рельеф не набирает полной глубины (${domeW.toFixed(2)})`);

  /* Смещение считает та же стопка слоёв, что и у корпуса: разойдись они —
     на вазе была бы одна каннелюра, на крышке другая. */
  const warp = lidWarpFn(L, pat);
  if (!warp) P('узор есть, а рельефа крышки нет');
  else {
    let peak = 0;
    for (let j = 0; j < L.pts.length; j++)
      peak = Math.max(peak, Math.abs(warp(0, L.pts[j], j)));
    if (Math.abs(peak - 2) > 0.02) P(`рельеф крышки ${peak.toFixed(2)} мм вместо глубины 2 мм`);
    /* Повторов по кругу столько же, сколько на корпусе: считаем смены знака
       на самой рельефной точке купола. */
    let best = 0;
    for (let j = 0; j < L.pts.length; j++) if (w[j] > w[best]) best = j;
    let sign = Math.sign(warp(0, L.pts[best], best)), flips = 0;
    for (let i = 1; i <= 720; i++) {
      const v = Math.sign(warp(i / 720 * Math.PI * 2, L.pts[best], best));
      if (v && v !== sign) { flips++; sign = v; }
    }
    if (flips !== 32) P(`на крышке ${flips / 2} каннелюр вместо 16`);
  }
  if (lidWarpFn(L, sanitizePattern(null))) P('без узора у крышки всё равно есть рельеф');

  /* Глина на рельеф считается, а не приписывается: наружный узор её добавляет,
     режущий — убирает. «По модулю» здесь означало бы приписать вещи лишнее. */
  const up = lidPatternVolumeMl(L, sanitizePattern({layers: [{id: 'bump', n: 14, depth: 2, m: 6}]}));
  const down = lidPatternVolumeMl(L, sanitizePattern({layers: [{id: 'dimple', n: 14, depth: 2, m: 6}]}));
  if (!(up > 0)) P(`чешуя на крышке добавляет ${up.toFixed(2)} см³ — должна добавлять`);
  if (!(down < 0)) P(`лунки на крышке добавляют ${down.toFixed(2)} см³ — должны убирать`);
  if (Math.abs(up) > 60 || Math.abs(down) > 60) P('поправка объёма крышки неправдоподобно велика');

  /* Та же поправка обязана дойти до массы изделия и до самой крышки. */
  const keep = {pattern: state.pattern, lid: state.lid};
  state.lid = sanitizeLid({on: true});
  state.pattern = sanitizePattern(null);
  const smooth = computeProduction(state).lidMl;
  state.pattern = {layers: [{id: 'bump', n: 14, depth: 2, m: 6}]};
  const patterned = computeProduction(state).lidMl;
  if (!(patterned > smooth)) P('рельеф крышки не попал в массу изделия');
  /* Выключатель обязан выключать: гладкая крышка на рельефной вазе — законный выбор. */
  state.lid = sanitizeLid({on: true, pattern: false});
  if (Math.abs(computeProduction(state).lidMl - smooth) > 1e-9)
    P('«узор на крышке» выключен, а глина на него всё равно считается');
  state.pattern = keep.pattern; state.lid = keep.lid;

  /* Показанное = выгруженное: рельеф обязан дойти до самой сетки, а не остаться
     в функции. Собираем крышку тем же токарем, что и сцена с экспортом, и меряем
     разброс радиуса на кольце купола. */
  {
    const pts = L.pts.map(p => ({x: Math.max(p.r, 0.01), y: p.y}));
    /* Двенадцать каннелюр на семидесяти двух сегментах — по шесть отсчётов
       на период, и гребень с ложбиной попадают ровно на сегменты. При числе,
       которое не делится, ложбина падает между ними, и «недобор» глубины
       был бы не ошибкой рельефа, а огрублением сетки. */
    const wf = lidWarpFn(L, sanitizePattern({layers: [{id: 'flute', n: 12, depth: 3}]}));
    const geo = buildLathe(pts, 72, undefined, undefined, (phi, p, j) => wf(phi, L.pts[j], j));
    const flat = buildLathe(pts, 72);
    const spreadAt = (g, j) => {
      let lo = Infinity, hi = -Infinity;
      const A = g.attributes.position.array;
      for (let i = 0; i <= 72; i++) {
        const k = (i * L.pts.length + j) * 3;
        const r = Math.hypot(A[k], A[k + 2]);
        lo = Math.min(lo, r); hi = Math.max(hi, r);
      }
      return hi - lo;
    };
    let best = 0, partial = null;
    for (let j = 0; j < L.pts.length; j++) {
      if (spreadAt(flat, j) > 0.01) P('гладкая крышка и без узора гуляет по радиусу');
      const sp = spreadAt(geo, j);
      /* Там, где веса нет, рельефа в сетке быть не должно вовсе: на посадке
         борозда губит посадку, а на оси сминается в кашу. */
      if (!w[j] && sp > 0.01) P(`рельеф ${sp.toFixed(2)} мм там, где вес нулевой (r=${L.pts[j].r.toFixed(1)}, y=${L.pts[j].y.toFixed(1)})`);
      if (w[j] > 0.99) best = Math.max(best, sp);
      if (w[j] > 0.15 && w[j] < 0.85) partial = {sp, w: w[j]};
    }
    if (Math.abs(best - 6) > 0.15) P(`в сетке крышки рельеф ${best.toFixed(2)} мм вместо 6 мм от гребня до ложбины`);
    /* На переходе рельеф не обрывается ступенькой, а растёт вместе с весом:
       ступенька в рельефе — это шов, по которому крышка и треснет. */
    if (!partial) P('у рельефа крышки нет плавного перехода — только «есть» и «нет»');
    else if (Math.abs(partial.sp - 6 * partial.w) > 0.2)
      P(`на переходе рельеф ${partial.sp.toFixed(2)} мм вместо ${(6 * partial.w).toFixed(2)} по весу`);
  }

  /* Рельеф режет стенку крышки так же, как стенку корпуса, и порог тот же. */
  const deep = {...state, lid: sanitizeLid({on: true, wall: 3}),
                pattern: {layers: [{id: 'flute', n: 16, depth: 2.6}]}};
  if (!lidWarnings(deep, prof(), mat()).some(x => x.lvl === 'bad'))
    P('рельеф глубже стенки крышки не помечен красным');
  const calm = {...state, lid: sanitizeLid({on: true, wall: 8}),
                pattern: {layers: [{id: 'flute', n: 16, depth: 1.5}]}};
  if (lidWarnings(calm, prof(), mat()).some(x => x.lvl === 'bad'))
    P('спокойный узор на толстой крышке помечен красным');
}

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
