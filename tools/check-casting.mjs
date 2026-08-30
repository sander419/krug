// Проверка расчёта литья:
//   node tools/check-casting.mjs
//
// По этим числам мастер ставит таймер и наливает шликер: ошибка стоит партии.
// Проверяется не правдоподобие, а то, что расчёт ведёт себя как физика —
// стенка растёт как корень из времени, вода из шликера сходится с водой,
// которую забрала форма, а форма не может принять воды больше своего запаса.
import { CAST_DEFAULTS, buildRate, holdMinutes, wallAfter, slipPerCast,
         mouldCapacity, castingPlan } from '../js/core/casting.js';

const problems = [];
const P = t => problems.push(t);
const D = CAST_DEFAULTS;

/* ---------- набор стенки ---------- */
// замер обязан воспроизводиться: сколько намеряли, столько и должно выйти
const back = wallAfter(D.calibMin, D);
if (Math.abs(back - D.calibMM) > 1e-9) P(`замер не воспроизводится: ${back.toFixed(2)} вместо ${D.calibMM} мм`);
if (Math.abs(holdMinutes(D.calibMM, D) - D.calibMin) > 1e-6) P('обратная задача не сходится с прямой');

// корень, а не прямая: вдвое толще — вчетверо дольше
const t3 = holdMinutes(3, D), t6 = holdMinutes(6, D);
if (Math.abs(t6 / t3 - 4) > 0.01) P(`удвоение стенки должно давать вчетверо дольше, вышло ×${(t6 / t3).toFixed(2)}`);
if (!(wallAfter(60, D) > wallAfter(30, D) && wallAfter(30, D) > wallAfter(5, D)))
  P('стенка обязана расти со временем');

// чужой замер меняет расчёт: медленная форма держит дольше
const slow = {...D, calibMin: 34};
if (!(holdMinutes(4, slow) > holdMinutes(4, D))) P('замер на медленной форме не удлинил выдержку');

/* ---------- шликер ---------- */
const cast = slipPerCast(500, 1.2, D);
if (!(cast.usedKg > 0.5 && cast.usedKg < 1.5)) P(`шликера на 500 г черепка вышло ${cast.usedKg.toFixed(2)} кг — вне здравого смысла`);
if (!(cast.usedKg > 0.5)) P('шликера не может уйти меньше сухой массы черепка');
if (Math.abs(cast.pourKg - 1.2 * D.slipDensity) > 1e-9) P('налив не равен объёму полости на плотность');
if (!(cast.backKg > 0)) P('при полом литье часть шликера обязана сливаться обратно');
if (Math.abs(cast.usedKg + cast.backKg - cast.pourKg) > 1e-9) P('налив не сходится с «ушло + вернулось»');

// вода: её не может быть больше, чем воды в ушедшем шликере
const waterInSlip = cast.usedKg * (1 - D.solidsPct / 100);
if (!(cast.waterKg > 0 && cast.waterKg < waterInSlip))
  P(`вода в форму ${cast.waterKg.toFixed(3)} кг вне диапазона (в шликере ${waterInSlip.toFixed(3)})`);

// гуще шликер — меньше воды отдавать
const thick = slipPerCast(500, 1.2, {...D, solidsPct: 75});
if (!(thick.waterKg < cast.waterKg)) P('густой шликер обязан отдавать меньше воды');
if (!(thick.usedKg < cast.usedKg)) P('густого шликера на тот же черепок нужно меньше');

// крупнее полость — больше налив, но черепок тот же
const big = slipPerCast(500, 2.4, D);
if (Math.abs(big.usedKg - cast.usedKg) > 1e-9) P('объём полости не должен менять расход на черепок');
if (!(big.backKg > cast.backKg)) P('из большей полости должно вернуться больше');

/* ---------- ресурс формы ---------- */
const cap = mouldCapacity(6, cast.waterKg, D, 10);
if (!(cap.capacityKg > 0)) P('запас формы не посчитан');
if (!(cap.inRow >= 1)) P('форма обязана принимать хотя бы одну отливку');
if (cap.inRow * cast.waterKg > cap.capacityKg + 1e-9) P('серия отливок отдала форме больше воды, чем та принимает');

const heavy = mouldCapacity(12, cast.waterKg, D, 10);
if (!(heavy.inRow > cap.inRow)) P('тяжёлая форма должна принимать больше отливок');
const wet = mouldCapacity(6, cast.waterKg, {...D, dryHours: 48}, 10);
if (!(wet.mouldsNeeded >= cap.mouldsNeeded)) P('долгая сушка обязана требовать больше форм');
if (mouldCapacity(6, cast.waterKg, D, 0).mouldsNeeded !== null) P('без дневного плана число форм неизвестно, а не ноль');

/* ---------- весь расчёт ---------- */
const plan = castingPlan({dryG: 500, cavityL: 1.2, wallMM: 4, plasterKg: 6, parts: 2, perDay: 10});
if (!(plan.hold > 0)) P('выдержка не посчиталась');
if (plan.table.length < 5) P('таблица выдержки слишком короткая, чтобы ставить по ней таймер');
for (let i = 1; i < plan.table.length; i++)
  if (!(plan.table[i].mm > plan.table[i - 1].mm)) P('таблица выдержки не монотонна');
if (!(plan.cap.mouldsNeeded >= 1)) P('на дневной план нужна хотя бы одна форма');

console.log('Проверка расчёта литья\n');
console.log(`  замер ${D.calibMM} мм за ${D.calibMin} мин → ${plan.rateMMperSqrtMin.toFixed(2)} мм за корень из минуты`);
console.log(`  стенка 4 мм: держать ${plan.hold.toFixed(0)} мин`);
console.log(`  черепок 500 г: налить ${plan.slip.pourKg.toFixed(2)} кг, уйдёт ${plan.slip.usedKg.toFixed(2)}, вернётся ${plan.slip.backKg.toFixed(2)}`);
console.log(`  форма 6 кг: ${plan.cap.inRow} отливок подряд, на 10 шт в день нужно ${plan.cap.mouldsNeeded} форм`);

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nЛитьё считается как физика: корень времени, баланс воды, запас формы.');
