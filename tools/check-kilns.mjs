// Проверка печей и садки:
//   node tools/check-kilns.mjs
//
// Садка — это число, по которому гончар решает, браться ли за заказ: цена
// обжига делится на то, что влезло. Ошибка здесь не видна на экране (кружки
// нарисуются любые), поэтому проверяется геометрией: не вылезло ли за камеру,
// не наехало ли друг на друга, сходится ли итог с рядами.
import { KILNS, KILNS_SCHEMA, GAPS, byKilnId, DUTY, BISQUE_C } from '../js/config/kilns.js';
import { kilnLoad, firingCost, kilnEconomy, firedSize } from '../js/core/kiln.js';
import { checkContract } from './registry-contract.mjs';

const problems = [];
const P = t => problems.push(t);
const FIELDS = ['innerMM', 'volumeL', 'powerKW', 'phase', 'maxC', 'shelves', 'shelfMM', 'note'];

if (KILNS_SCHEMA !== 1) P('версия схемы реестра печей изменилась — проверьте читателей');
if (KILNS.length < 3) P('в реестре меньше трёх печей: не из чего выбирать');

const ids = new Set();
for (const k of KILNS) {
  const L = `печь «${k.id}»`;
  if (ids.has(k.id)) P(`${L}: дубль id`);
  ids.add(k.id);
  checkContract(k, FIELDS, L, problems);
  if (!['round', 'box'].includes(k.form)) P(`${L}: неизвестная форма камеры «${k.form}»`);
  const need = k.form === 'round' ? 2 : 3;
  if (!Array.isArray(k.innerMM) || k.innerMM.length !== need)
    P(`${L}: у ${k.form === 'round' ? 'круглой' : 'камерной'} печи должно быть ${need} размера`);
  else if (k.innerMM.some(v => !(v > 50 && v < 3000))) P(`${L}: размер камеры вне здравого смысла`);
  if (!(k.powerKW > 0.5 && k.powerKW < 100)) P(`${L}: мощность ${k.powerKW} кВт неправдоподобна`);
  if (!(k.maxC >= 1000 && k.maxC <= 1400)) P(`${L}: предельная температура ${k.maxC} °C вне керамического диапазона`);
  if (!(k.shelfMM >= 8 && k.shelfMM <= 40)) P(`${L}: полка толщиной ${k.shelfMM} мм — это не полка`);

  /* Заявленный объём не должен спорить с размерами камеры: расхождение
     вдвое означает опечатку в одном из двух чисел. */
  const [a, b, c] = k.innerMM;
  const vol = k.form === 'round' ? Math.PI * (a / 2) ** 2 * b / 1e6 : a * b * c / 1e6;
  if (Math.abs(vol - k.volumeL) / k.volumeL > 0.45)
    P(`${L}: объём ${k.volumeL} л не сходится с камерой (${vol.toFixed(0)} л по размерам)`);
}

/* ---------- геометрия садки ---------- */
for (const k of KILNS) {
  for (const item of [{d: 80, h: 90}, {d: 140, h: 180}, {d: 200, h: 260}]) {
    const L = `${k.id} · изделие ⌀${item.d}×${item.h}`;
    const load = kilnLoad(k, item);
    if (load.total !== load.perShelf * load.tiers) P(`${L}: итог не равен «на полке × ярусов»`);
    if (load.pts.length !== load.perShelf) P(`${L}: нарисовано ${load.pts.length} мест, посчитано ${load.perShelf}`);

    // ни одно место не должно вылезать за полку
    const r = load.step / 2;
    for (const p of load.pts) {
      const out = load.shelf.form === 'round'
        ? Math.hypot(p.x, p.y) > load.shelf.w / 2 - r + 1e-6
        : Math.abs(p.x) > load.shelf.w / 2 - r + 1e-6 || Math.abs(p.y) > load.shelf.h / 2 - r + 1e-6;
      if (out) { P(`${L}: место вылезло за полку`); break; }
    }
    // и не должно наезжать на соседа
    for (let i = 0; i < load.pts.length; i++)
      for (let j = i + 1; j < load.pts.length; j++)
        if (Math.hypot(load.pts[i].x - load.pts[j].x, load.pts[i].y - load.pts[j].y) < load.step - 1e-6) {
          P(`${L}: два изделия наехали друг на друга`); i = load.pts.length; break;
        }
    // высота: ярус это изделие плюс полка плюс зазор
    const h = k.form === 'round' ? k.innerMM[1] : k.innerMM[2];
    if (load.tiers * (item.h + k.shelfMM + GAPS.tier) > h + 1e-6) P(`${L}: ярусы не помещаются по высоте`);
  }
}

/* Изделие больше камеры — это ноль и объяснение, а не пустая таблица. */
const huge = kilnLoad(KILNS[0], {d: 900, h: 90});
if (huge.total || !huge.why) P('изделие шире камеры: должно быть 0 и причина');
const tall = kilnLoad(KILNS[0], {d: 80, h: 5000});
if (tall.total || !tall.why) P('изделие выше камеры: должно быть 0 и причина');

/* ---------- цена ---------- */
const k = byKilnId('studio-60');
const one = firingCost(k, {topC: 1050, glaze: false, priceKWh: 6});
const two = firingCost(k, {topC: 1050, glaze: true, priceKWh: 6});
if (!(two.kWh > one.kWh)) P('с глазурью обжигов два — энергии должно быть больше');
if (two.runs !== 2 || one.runs !== 1) P('число обжигов считается неверно');
if (!(one.kWh > 0 && one.kWh < 200)) P(`киловатт-часы вне здравого смысла: ${one.kWh.toFixed(1)}`);
const slow = firingCost(k, {topC: 1050, glaze: false, rampCH: 60, priceKWh: 6});
if (!(slow.kWh > one.kWh)) P('медленный подъём должен стоить дороже быстрого');
const dear = firingCost(k, {topC: 1050, glaze: false, priceKWh: 12});
if (Math.abs(dear.rub - one.rub * 2) > 0.01) P('цена не пропорциональна тарифу');

const eco = kilnEconomy(k, {d: 120, h: 140}, {topC: 1050, glaze: true, priceKWh: 6});
if (!(eco.perItem > 0)) P('цена обжига на изделие не посчиталась');
const ecoBig = kilnEconomy(k, {d: 240, h: 300}, {topC: 1050, glaze: true, priceKWh: 6});
if (ecoBig.perItem !== null && !(ecoBig.perItem > eco.perItem))
  P('крупное изделие обязано выходить дороже: его влезает меньше');

/* Габарит после обжига: усадка и торчащая ручка. */
const prof = [{r: 0, y: 0}, {r: 60, y: 100}, {r: 40, y: 200}];
const f0 = firedSize(prof, [], 0);
if (Math.abs(f0.d - 120) > 0.01 || Math.abs(f0.h - 200) > 0.01) P('габарит без усадки посчитан неверно');
const f1 = firedSize(prof, [], 10);
if (Math.abs(f1.d - 108) > 0.01) P('усадка не применилась к габариту');
const f2 = firedSize(prof, [{reach: 90}], 0);
if (Math.abs(f2.d - 180) > 0.01) P('ручка за габаритом корпуса не учтена');

console.log('Проверка печей и садки\n');
for (const kk of KILNS) {
  const l = kilnLoad(kk, {d: 120, h: 140});
  console.log(`  ${kk.name.padEnd(26)} ⌀120×140: ${String(l.perShelf).padStart(2)} на полке × ${l.tiers} яруса = ${l.total} шт`);
}
console.log(`\n  доля под нагрузкой ${DUTY}, утильный обжиг ${BISQUE_C} °C, зазоры ${GAPS.item}/${GAPS.wall}/${GAPS.tier} мм`);

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nСадка сходится: ничего не вылезает за камеру и не наезжает на соседа.');
