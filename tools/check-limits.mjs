// Крайние значения и битые данные:
//   node --import ./tools/node-three.mjs tools/check-limits.mjs
//
// Расчёт ломается двумя способами. Первый громкий: исключение, деление
// на ноль, NaN — его видно сразу. Второй тихий и опаснее: **арифметика
// прошла, а ответ физически бессмыслен** — отрицательная масса, вместимость
// больше габарита, стенка толще радиуса, запас прочности в тысячу раз.
// По такому числу человек примет решение, а узнает о нём у печи.
//
// Здесь перебираются крайние и заведомо злые входы: пределы ползунков,
// профили в одну точку, самопересечения, отрицательные числа, NaN, Infinity,
// пустые массивы и мусор вместо записей. Требование: **очистка приводит вход
// к схеме, расчёт не падает, а каждое число остаётся числом в своих пределах.**
import { state } from '../js/core/state.js';
import { PRESETS } from '../js/config/data.js';
import { MATERIALS, byId, density } from '../js/config/materials.js';
import { computeProduction, computeStrength, computeWarnings, userProfileMM } from '../js/core/math.js';
import { sanitizePart } from '../js/core/parts.js';
import { PART_KINDS } from '../js/config/parts.js';
import { sanitizeLid, LID_LIMITS, lidMetrics } from '../js/core/lid.js';
import { sanitizePattern, LIMITS as PAT_LIMITS, MAX_LAYERS, patternOffset, LAYER_DEFAULTS,
         patternVolumeMl, patternMetrics, PATTERNS } from '../js/core/pattern.js';
import { sliceGCode } from '../js/core/slicer.js';
import { buildPot } from '../js/core/geometry.js';
import { sanitizeCost, pieceCost } from '../js/core/cost.js';
import { byGlazeId } from '../js/config/glazes.js';
import { sanitizeTune } from '../js/core/tuning.js';

const problems = [];
const P = t => problems.push(t);
const fin = v => Number.isFinite(v);

/* Злые числа: каждое из них когда-нибудь приходит из поля ввода, из старой
   ссылки или из чужого рецепта. */
const EVIL = [NaN, Infinity, -Infinity, undefined, null, '', 'ерунда', -1, -1e9, 1e9, 0, 0.0001, '12abc', [], {}];

/* ---------- очистка не пропускает мусор ---------- */
{
  for (const v of EVIL) {
    const p = sanitizePattern({layers: [{id: v, n: v, depth: v, m: v, twist: v, phase: v,
                                         from: v, to: v, edge: v, mute: v}]});
    /* Слой без узнаваемой формы рельефа выбрасывается целиком — и это верно:
       выдумывать за человека, какой узор он имел в виду, инструмент не вправе.
       А вот слой с настоящей формой и мусором в числах обязан выжить
       на умолчаниях: стёртое поле не повод терять слой. */
    if (!p.layers.length) {
      const kept = sanitizePattern({layers: [{id: 'flute', n: v, depth: v, m: v, twist: v,
                                              phase: v, from: v, to: v, edge: v}]});
      if (!kept.layers.length) P(`узор: слой с настоящей формой пропал из-за «${String(v)}» в числах`);
      else for (const [k, [lo, hi]] of Object.entries(PAT_LIMITS)) {
        const val = kept.layers[0][k];
        if (!fin(val)) P(`узор: поле «${k}» из «${String(v)}» стало ${val}`);
        else if (val < lo || val > hi) P(`узор: поле «${k}» = ${val} вне пределов ${lo}…${hi}`);
      }
      continue;
    }
    const l = p.layers[0];
    if (!PATTERNS.some(x => x.id === l.id)) P(`узор: из «${String(v)}» вышла форма рельефа «${l.id}»`);
    for (const [k, [lo, hi]] of Object.entries(PAT_LIMITS)) {
      if (!fin(l[k])) { P(`узор: поле «${k}» из «${String(v)}» стало ${l[k]}`); continue; }
      if (l[k] < lo || l[k] > hi) P(`узор: поле «${k}» = ${l[k]} вне пределов ${lo}…${hi}`);
    }
    if (typeof l.mute !== 'boolean') P('узор: выключатель слоя перестал быть булевым');

    const lid = sanitizeLid({on: v, type: v, h: v, wall: v, seatH: v, gap: v,
                             knobH: v, knobD: v, over: v, pattern: v});
    for (const [k, [lo, hi]] of Object.entries(LID_LIMITS)) {
      if (!fin(lid[k])) { P(`крышка: поле «${k}» из «${String(v)}» стало ${lid[k]}`); continue; }
      if (lid[k] < lo || lid[k] > hi) P(`крышка: поле «${k}» = ${lid[k]} вне пределов ${lo}…${hi}`);
    }
    if (!['inset', 'over'].includes(lid.type)) P(`крышка: посадка «${lid.type}» не из двух видов`);

    for (const kind of Object.keys(PART_KINDS)) {
      const part = sanitizePart({kind, az: v, top: v, bot: v, out: v, thick: v, wide: v,
                                 at: v, len: v, rise: v, bore: v, tip: v, mesh: v, width: v, drop: v});
      if (part.kind !== kind) P(`прилеп: вид «${kind}» подменился на «${part.kind}»`);
      for (const [k, val] of Object.entries(part))
        if (typeof val === 'number' && !fin(val)) P(`прилеп «${kind}»: поле «${k}» стало ${val}`);
    }

    const cost = sanitizeCost({rate: v, hourRate: v, minPerPiece: v, lossPct: v, marginPct: v, n: v});
    for (const [k, val] of Object.entries(cost))
      if (typeof val === 'number' && !fin(val)) P(`деньги: поле «${k}» из «${String(v)}» стало ${val}`);
    const tune = sanitizeTune({partMaxKg: v, thinWallRatio: v});
    for (const [k, val] of Object.entries(tune))
      if (typeof val === 'number' && !fin(val)) P(`настройки: порог «${k}» стал ${val}`);
  }
  /* Стопка слоёв не растёт бесконечно: иначе чужая ссылка кладёт в неё сотню
     и пересчёт вешает вкладку. */
  const many = sanitizePattern({layers: Array(50).fill({id: 'flute', n: 12, depth: 1})});
  if (many.layers.length > MAX_LAYERS) P(`в стопку влезло ${many.layers.length} слоёв при пределе ${MAX_LAYERS}`);
  /* Пояс наизнанку (от больше до) не должен давать отрицательную высоту. */
  const flip = sanitizePattern({layers: [{id: 'flute', n: 12, depth: 2, from: 0.9, to: 0.1}]}).layers[0];
  if (flip.to <= flip.from) P(`пояс наизнанку остался наизнанку: ${flip.from}…${flip.to}`);
  /* Пустое поле — «не задано», а не ноль: `+null` и `+''` дают ноль, и поле,
     из которого стёрли число, молча превращало пояс в полоску у дна. */
  const blanked = sanitizePattern({layers: [{id: 'flute', n: '', depth: null, m: undefined,
                                             from: '', to: null, edge: ''}]}).layers[0];
  if (!blanked) P('слой пропал из-за пустых полей');
  else {
    if (blanked.to !== 1 || blanked.from !== 0) P(`пустой пояс стал ${blanked.from}…${blanked.to} вместо всей высоты`);
    if (blanked.depth !== LAYER_DEFAULTS.depth) P(`пустая глубина стала ${blanked.depth} вместо умолчания`);
    if (blanked.n !== LAYER_DEFAULTS.n) P(`пустые повторы стали ${blanked.n} вместо умолчания`);
  }
  const blankLid = sanitizeLid({on: true, gap: '', h: null, wall: undefined});
  if (blankLid.gap !== 1 || blankLid.h !== 22 || blankLid.wall !== 5)
    P(`пустые поля крышки дали ${blankLid.gap}/${blankLid.h}/${blankLid.wall} вместо умолчаний`);
}

/* ---------- рельеф на крайних числах ---------- */
{
  const H = 220;
  for (const p of PATTERNS) {
    const pat = sanitizePattern({layers: [{id: p.id, n: PAT_LIMITS.n[1], depth: PAT_LIMITS.depth[1],
                                           m: PAT_LIMITS.m[1], twist: PAT_LIMITS.twist[1]}]});
    for (const y of [0, 0.001, H / 2, H - 0.001, H])
      for (const th of [0, 1, 3.14159, 6.28]) {
        const d = patternOffset(pat, th, y, H);
        if (!fin(d)) { P(`рельеф «${p.id}»: смещение ${d} на y=${y}`); break; }
        if (Math.abs(d) > PAT_LIMITS.depth[1] * 4)
          P(`рельеф «${p.id}»: смещение ${d.toFixed(1)} мм — больше четырёх глубин`);
      }
    /* Высота ноль и профиль в одну точку — законный вход: так бывает на первом
       кадре «Кинотеатра» и на пустом рецепте. */
    if (!fin(patternOffset(pat, 1, 0, 0))) P(`рельеф «${p.id}»: на нулевой высоте вышло не число`);
    if (patternVolumeMl(pat, []) !== 0) P(`рельеф «${p.id}»: на пустом профиле объём не ноль`);
    if (patternVolumeMl(pat, [{r: 10, y: 0}]) !== 0) P(`рельеф «${p.id}»: на профиле из одной точки объём не ноль`);
  }
  /* Метрики на вырожденной вещи: диаметр ноль — шага по кругу нет, а не ∞. */
  const m0 = patternMetrics(sanitizePattern({layers: [{id: 'flute', n: 12, depth: 2}]}), {D: 0, H: 0});
  if (m0.stepMM !== null && !fin(m0.stepMM)) P(`метрики: шаг на нулевом диаметре ${m0.stepMM}`);
}

/* ---------- изделие на пределах ползунков ---------- */
{
  const base = () => Object.assign(state, {
    points: PRESETS[1].pts.map(p => ({...p})), H: 220, D: 160, segments: 72, rings: 0.4,
    hollow: true, wall: 5, footH: 6, footK: 62, allow: 20, mat: MATERIALS[0].id, firing: 'raw',
    parts: [], lid: {on: false}, pattern: {layers: []}, stage: 6, glazeId: 'clear-gloss',
    glaze: {al: 0.3, si: 3.6, ca: 0.7}, pr: {printer: 1, nozzle: 4, lh: 2.4, feed: 1800,
    cart: 20, flow: 100, tau: 8}, kiln: {id: 'studio-60', kwh: 6}, cast: {}, cost: {}, tune: {},
    plaster: {id: 'gvvs-16', wr: 70},
  });

  const CASES = [
    ['минимум всего', {H: 50, D: 50, wall: 2, footH: 0, segments: 24, rings: 0}],
    ['максимум всего', {H: 400, D: 400, wall: 12, footH: 12, segments: 128, rings: 1.5}],
    ['стенка толще радиуса', {H: 200, D: 30, wall: 12}],
    ['профиль в одну точку', {points: [{t: 0, r: 0.5}, {t: 1, r: 0.5}]}],
    ['профиль с нулём', {points: [{t: 0, r: 0}, {t: 0.5, r: 1}, {t: 1, r: 0}]}],
    ['профиль наизнанку', {points: [{t: 1, r: 0.9}, {t: 0, r: 0.2}, {t: 0.5, r: 0.5}]}],
    ['сплошная без полости', {hollow: false}],
    ['все материалы', {}],
  ];
  for (const [name, over] of CASES) {
    base();
    Object.assign(state, JSON.parse(JSON.stringify(over)));
    const mats = name === 'все материалы' ? MATERIALS.map(m => m.id) : [state.mat];
    for (const mat of mats) {
      state.mat = mat;
      let prod, str;
      try {
        prod = computeProduction(state);
        str = computeStrength(state);
      } catch (e) { P(`«${name}» (${mat}): расчёт упал — ${e.message}`); continue; }
      for (const [k, v] of Object.entries(prod))
        if (typeof v === 'number' && !fin(v)) P(`«${name}» (${mat}): ${k} = ${v}`);
      if (prod.volMl < 0) P(`«${name}»: объём глины отрицательный (${prod.volMl.toFixed(1)})`);
      if (prod.capMl < 0) P(`«${name}»: вместимость отрицательная`);
      if (prod.massF < 0 || prod.massN < 0) P(`«${name}»: масса отрицательная`);
      /* Стенка толще радиуса — законный ввод: полости просто нет, но вещь
         не может стать при этом «отрицательно полой». */
      if (prod.capMl > 0 && state.wall * 2 >= state.D)
        P(`«${name}»: у вещи со стенкой ${state.wall} при ⌀${state.D} нашлась вместимость`);
      if (!fin(str.minSF)) P(`«${name}» (${mat}): запас прочности ${str.minSF}`);
      try { computeWarnings(state, prod, str); }
      catch (e) { P(`«${name}» (${mat}): замечания упали — ${e.message}`); }
      try {
        const geo = buildPot(state).geometry;
        const a = geo.attributes.position.array;
        for (let i = 0; i < a.length; i++) if (!fin(a[i])) { P(`«${name}»: в сетке NaN`); break; }
      } catch (e) { P(`«${name}»: сетка не собралась — ${e.message}`); }
    }
  }

  /* Слайсер на крайних режимах печати: сопло тоньше слоя, огромное сопло,
     подача на пределе. G-code должен либо получиться, либо честно сказать. */
  base();
  for (const pr of [{nozzle: 0.4, lh: 0.2, feed: 300, cart: 10, flow: 60, tau: 1},
                    {nozzle: 10, lh: 5, feed: 3600, cart: 75, flow: 160, tau: 10},
                    {nozzle: 3, lh: 3, feed: 1800, cart: 20, flow: 100, tau: 8}]) {
    state.pr = {printer: 1, ...pr};
    let g;
    try { g = sliceGCode(state); } catch (e) { P(`слайсер упал на сопле ${pr.nozzle}: ${e.message}`); continue; }
    if (/NaN|Infinity/.test(g.text)) P(`сопло ${pr.nozzle}: в G-code NaN или Infinity`);
    if (!fin(g.stats.grams) || g.stats.grams < 0) P(`сопло ${pr.nozzle}: пасты ${g.stats.grams}`);
    if (pr.lh >= pr.nozzle && !g.warnings.some(w => w.cls === 'e'))
      P(`слой ${pr.lh} ≥ сопла ${pr.nozzle}, а красной ошибки нет`);
  }

  /* Деньги на нулевых и запредельных вводах: цена не уходит в NaN и в минус. */
  base();
  const prof = userProfileMM(state);
  const prod = computeProduction(state);
  for (const c of [{}, {hourRate: 0, minPerPiece: 0}, {lossPct: 100}, {marginPct: 0},
                   {n: 1}, {n: 100000}, {hourRate: -5, minPerPiece: -5}]) {
    const per = pieceCost(state, prod, prof, {...sanitizeCost(c), glaze: byGlazeId(state.glazeId)});
    for (const [k, v] of Object.entries(per))
      if (typeof v === 'number' && !fin(v)) P(`деньги ${JSON.stringify(c)}: ${k} = ${v}`);
    if (per.total < 0) P(`деньги ${JSON.stringify(c)}: себестоимость отрицательная`);
  }

  /* Крышка без корпуса и на вырожденном профиле. */
  for (const prof2 of [[{r: 0.01, y: 0}, {r: 0.01, y: 1}], [{r: 60, y: 0}, {r: 60, y: 0}]]) {
    try {
      const m = lidMetrics(prof2, sanitizeLid({on: true}), 5, density(byId(MATERIALS[0].id)), 9, null);
      if (!fin(m.volMl) || m.volMl < 0) P(`крышка на вырожденном профиле: объём ${m.volMl}`);
    } catch (e) { P(`крышка на вырожденном профиле упала: ${e.message}`); }
  }
}

/* ---------- цена кадра ---------- */
/* «Кинотеатр» пересобирает форму каждый кадр, и рельеф считается по вершинам.
   Замерено: гладкая 0,7 мс, один слой 1,4, четыре слоя на 96 сегментах 3,7,
   худший мыслимый набор на 128 сегментах 5,1. Потолок в 9 мс держит запас
   до кадра в 16 мс: перешагнём — «Кинотеатр» начнёт дёргаться, и виноват
   будет не браузер. */
{
  const frame = (segments, layers) => {
    Object.assign(state, {
      points: PRESETS[1].pts.map(p => ({...p})), H: 220, D: 160, segments,
      wall: 5, hollow: true, footH: 6, footK: 62, stage: 6, rings: 0.4,
      parts: [], lid: {on: false}, pattern: {layers},
    });
    let g = null;
    const once = () => { g = buildPot(state, g).geometry; };
    once();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 30; i++) once();
    return Number(process.hrtime.bigint() - t0) / 1e6 / 30;
  };
  const plain = frame(72, []);
  if (plain > 3) P(`гладкая форма собирается ${plain.toFixed(2)} мс за кадр — это уже заметно`);
  const heavy = frame(128, [
    {id: 'bark', n: 40, depth: 2, m: 30}, {id: 'weave', n: 40, depth: 2, m: 30},
    {id: 'chevron', n: 40, depth: 2, m: 30}, {id: 'brick', n: 40, depth: 2, m: 30}]);
  if (heavy > 9) P(`худший узор собирается ${heavy.toFixed(2)} мс за кадр — «Кинотеатр» будет дёргаться`);
  /* И не должно быть так, что рельеф дороже самой формы на порядок: это
     означало бы, что где-то потерялся кэш. */
  if (heavy > plain * 20) P(`рельеф дороже гладкой формы в ${(heavy / plain).toFixed(0)} раз — похоже, кэш не сработал`);
}


console.log('\nКрайние значения');
console.log(`  злых входов: ${EVIL.length} · форм рельефа: ${PATTERNS.length} · видов прилепов: ${Object.keys(PART_KINDS).length}`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const t of problems) console.log('  ✗ ' + t);
  process.exit(1);
}
console.log('\nМусор приводится к схеме, крайние числа не роняют расчёт, бессмысленных ответов нет.');
