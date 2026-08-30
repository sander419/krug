// Проверка себестоимости и тиража:
//   node --import ./tools/node-three.mjs tools/check-cost.mjs
//
// Смета — то, по чему человек назначает цену. Ошибка здесь не видна на экране:
// число красивое, а работа в минус. Поэтому проверяется арифметика (брак ложится
// на уцелевших, а не прибавляется процентом), честность (чего не знаем — то
// пусто, а не выдумано) и то, что тираж это та же штука, умноженная на N.
import { state } from '../js/core/state.js';
import { computeProduction, userProfileMM } from '../js/core/math.js';
import { COST_DEFAULTS, COST_LIMITS, sanitizeCost, glazedAreaCm2, pieceCost, batchPlan }
  from '../js/core/cost.js';
import { MATERIALS, byId as materialById } from '../js/config/materials.js';
import { tune } from '../js/core/tuning.js';

const problems = [];
const P = t => problems.push(t);
const prod = () => computeProduction(state);
const prof = () => userProfileMM(state);
const cost = (o = {}) => pieceCost(state, prod(), prof(), {firePerPiece: 30, ...o});

/* ---------- очистка входа ---------- */
const dirty = sanitizeCost({hourRate: -100, lossPct: 500, minPerPiece: 'ерунда', n: 0});
if (dirty.hourRate !== COST_LIMITS.hourRate[0]) P('отрицательная ставка не обрезалась');
if (dirty.lossPct !== COST_LIMITS.lossPct[1]) P('брак выше предела не обрезался');
if (dirty.minPerPiece !== COST_DEFAULTS.minPerPiece) P('нечисловые минуты не вернулись к умолчанию');
if (dirty.n !== COST_LIMITS.n[0]) P('нулевой тираж не обрезался до одного');

/* ---------- площадь под глазурь ---------- */
{
  const a = glazedAreaCm2(prof(), state.wall, true);
  const solid = glazedAreaCm2(prof(), state.wall, false);
  if (!(a > solid)) P('у полого изделия площадь под глазурь должна быть больше: его поливают и внутри');
  if (!(a > 100 && a < 20000)) P(`площадь ${a.toFixed(0)} см² вне здравого смысла`);
  const wasH = state.H;
  state.H = state.H * 2;
  const bigger = glazedAreaCm2(prof(), state.wall, true);
  state.H = wasH;
  if (!(bigger > a * 1.5)) P('вдвое более высокое изделие не дало заметно большей площади');
}

/* ---------- смета ---------- */
{
  const c = cost();
  const sum = c.clayRub + c.glazeRub + c.fireRub + c.labourRub + c.toolingRub + c.otherRub + c.lossRub;
  if (Math.abs(sum - c.total) > 0.01) P(`строки сметы не сходятся с итогом: ${sum.toFixed(2)} против ${c.total.toFixed(2)}`);
  if (!(c.total > 0)) P('себестоимость вышла нулевой');

  /* Брак делит, а не прибавляет: при 50 % брака цена уцелевших ровно вдвое
     выше, чем без брака, — из двух обожжённых продаётся одно. */
  const noLoss = cost({lossPct: 0});
  const half = cost({lossPct: 50});
  if (Math.abs(half.total - noLoss.total * 2) > 0.01)
    P(`брак 50 % обязан удваивать себестоимость: ${half.total.toFixed(2)} против ${(noLoss.total * 2).toFixed(2)}`);
  if (!(noLoss.lossRub === 0)) P('без брака строка брака должна быть нулевой');

  /* Наценка: минимальная цена и маржа — одно и то же число с двух сторон. */
  const m = cost({marginPct: 120});
  if (Math.abs(m.minPrice - m.total * 2.2) > 0.01) P('наценка считается не от себестоимости');
  if (Math.abs(m.marginRub - (m.minPrice - m.total)) > 1e-9) P('маржа не равна цене минус себестоимость');
  const zero = cost({marginPct: 0});
  if (Math.abs(zero.minPrice - zero.total) > 1e-9) P('без наценки цена обязана равняться себестоимости');

  /* Каждое поле обязано двигать итог — иначе это мёртвая ручка. */
  for (const [k, v] of [['minPerPiece', 90], ['hourRate', 3000], ['glazeRubPerKg', 5000],
                        ['otherPct', 60], ['toolingRub', 50000]]) {
    if (!(cost({[k]: v}).total > c.total + 0.01)) P(`поле «${k}» не влияет на себестоимость`);
  }
  /* Оснастка делится на тираж, а не ложится целиком. */
  const t1 = cost({toolingRub: 10000, toolingPieces: 10});
  const t2 = cost({toolingRub: 10000, toolingPieces: 100});
  if (!(t1.total > t2.total)) P('оснастка не размазывается по числу изделий');
}

/* ---------- честность: чего не знаем, то пусто ---------- */
{
  const noPrice = MATERIALS.find(m => !(m.priceRub && m.packKg));
  if (!noPrice) P('в реестре не осталось массы без цены — проверку честности не на чем прогнать');
  else {
    const was = state.mat;
    state.mat = noPrice.id;
    const c = cost();
    if (c.clayRub !== null) P('цена массы не опубликована, а глина в смете посчитана');
    if (c.complete) P('смета с неизвестной ценой массы не может считаться полной');
    if (!c.est.some(e => /цена массы/.test(e))) P('в смете не сказано, что цена массы неизвестна');
    state.mat = was;
  }
  const noFire = pieceCost(state, prod(), prof(), {firePerPiece: 0});
  if (noFire.fireRub !== null) P('печь не посчитана, а обжиг в смете есть');
  if (noFire.complete) P('смета без обжига не может считаться полной');
}

/* ---------- расход глазури идёт из настроек ---------- */
{
  const c = cost();
  const expect = c.areaCm2 * tune('glazeGperCm2') / 1000;
  if (Math.abs(c.glazeKg - expect) > 1e-9) P('масса глазури считается не по порогу расхода');
}

/* ---------- тираж ---------- */
{
  const per = cost();
  const one = batchPlan(per, {n: 1, perFiring: 4, mouldLifePieces: 50});
  const many = batchPlan(per, {n: 100, perFiring: 4, mouldLifePieces: 50});
  if (Math.abs(many.total - one.total * 100) > 0.01) P('партия не равна штуке, умноженной на тираж');
  if (Math.abs(many.clayKg - per.clayKg * 100) > 1e-9) P('глина на партию считается неверно');
  if (many.firings !== 25) P(`обжигов на 100 шт по 4 в садку должно быть 25, а вышло ${many.firings}`);
  if (many.moulds !== 2) P(`форм на 100 шт при ресурсе 50 должно быть 2, а вышло ${many.moulds}`);
  if (batchPlan(per, {n: 101, perFiring: 4}).firings !== 26)
    P('неполная садка обязана считаться за целый обжиг');
  if (batchPlan(per, {n: 10}).firings !== null) P('без садки число обжигов должно быть неизвестно, а не нулём');
  if (Math.abs(many.margin - (per.minPrice - per.total) * 100) > 0.01) P('маржа партии не сходится');
  if (many.perPiece !== per.total) P('себестоимость штуки в партии разошлась со сметой');
}

console.log('Проверка себестоимости\n');
{
  const c = cost();
  const mat = materialById(state.mat);
  console.log(`  ${mat.name}: глина ${c.clayRub == null ? '—' : c.clayRub.toFixed(0)} ₽ · ` +
    `глазурь ${c.glazeRub.toFixed(0)} ₽ (${c.areaCm2.toFixed(0)} см²) · обжиг ${c.fireRub.toFixed(0)} ₽ · ` +
    `работа ${c.labourRub.toFixed(0)} ₽ → итого ${c.total.toFixed(0)} ₽, цена от ${c.minPrice.toFixed(0)} ₽`);
}

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nСмета сходится: брак ложится на уцелевших, неизвестное не выдумано, тираж это штука × N.');
