// Проверка фактических замеров: node tools/check-fact.mjs
//
// Факт — единственное место, где человек вписывает свои числа в готовый расчёт,
// и единственное, где ошибка не видна по картинке: подпись поля не влияет
// ни на геометрию, ни на деньги. Так и вышло — восемь полей ввода подписались
// словом «undefined», потому что шаблон читал `f.n`, а в реестре лежит `name`.
//
// Поэтому здесь проверяется не только арифметика отклонений, но и то, что
// разметка спрашивает у реестра существующие поля.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FACT_FIELDS, sanitizeFact, compareFact, factLevel, hasFact } from '../js/core/fact.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const P = t => problems.push(t);

/* ---------- реестр ---------- */
for (const f of FACT_FIELDS) {
  for (const key of ['k', 'name', 'unit', 'step', 'dec']) {
    if (f[key] === undefined) P(`поле «${f.k || '?'}» без ${key}`);
  }
  if (typeof f.name !== 'string' || !f.name.trim()) P(`поле ${f.k}: пустая подпись`);
  if (typeof f.unit !== 'string') P(`поле ${f.k}: единица не строка`);
}

/* Разметка паспорта берёт у реестра только те имена, которые в нём есть.
   Именно этот промах и подписал все поля словом «undefined». */
{
  const src = readFileSync(resolve(root, 'js/ui/passport.js'), 'utf-8');
  const start = src.indexOf('FACT_FIELDS.map(');
  if (start < 0) P('в паспорте нет разбора FACT_FIELDS — проверка устарела');
  else {
    const chunk = src.slice(start, start + 700);
    const known = new Set(Object.keys(FACT_FIELDS[0]));
    for (const m of chunk.matchAll(/\bf\.([a-zA-Z]\w*)/g))
      if (!known.has(m[1])) P(`паспорт читает у поля факта «${m[1]}» — такого в реестре нет`);
    /* Разбор по именам: любое несуществующее имя тогда падает, а не молчит. */
    const dest = /FACT_FIELDS\.map\(\(?\{([^}]+)\}/.exec(chunk);
    if (!dest) P('поля факта разбираются не по именам — опечатка снова пройдёт молча');
    else for (const nm of dest[1].split(',').map(x => x.trim().split(':')[0].trim()))
      if (nm && !known.has(nm)) P(`паспорт разбирает несуществующее поле «${nm}»`);
  }
}

/* ---------- очистка ---------- */
{
  const f = sanitizeFact({H: '232', D: '', massG: null, shrinkPct: 99, lossPcs: -3,
                          note: 'x'.repeat(3000), lossWhy: 'трещина', чужое: 5});
  if (f.H !== 232) P('строка с числом не превращается в число');
  if ('D' in f || 'massG' in f) P('пустое поле стало значением — «не мерил» это не ноль');
  if (f.shrinkPct !== 40) P('усадка не прижата к верхней границе');
  if (f.lossPcs !== 0) P('отрицательный брак не прижат к нулю');
  if (f.note.length !== 2000) P('заметка не обрезана');
  if ('чужое' in f) P('санитайзер пропускает чужие поля');
  if (hasFact({}) || !hasFact({H: 1})) P('hasFact путает пустой замер с непустым');
  if (hasFact({note: 'есть'})) P('одна заметка без единого замера считается замером');
}

/* ---------- сравнение ---------- */
{
  const calc = {H: 200, D: 150, massG: 800, shrinkPct: 9, glazeG: 100, workMin: 30, fireH: 8};
  const rows = compareFact(calc, {H: 196, massG: 900, lossPcs: 1});
  if (rows.length !== 3) P(`сравниваются не только замеренные величины: ${rows.length} строк`);
  const h = rows.find(r => r.k === 'H');
  if (h.delta !== -4) P(`отклонение высоты ${h.delta} вместо −4`);
  if (Math.abs(h.pct + 2) > 1e-9) P(`процент высоты ${h.pct} вместо −2`);
  if (factLevel(h) !== 'ok') P('промах в 2 % помечен как проблема');
  const m = rows.find(r => r.k === 'massG');
  if (factLevel(m) !== 'bad') P('промах массы в 12,5 % не помечен красным');
  const l = rows.find(r => r.k === 'lossPcs');
  if (l.calc !== null || l.pct !== null) P('у брака взялся расчёт, которого нет');
  if (factLevel(l) !== 'warn') P('ненулевой брак не помечен');
  if (factLevel({k: 'lossPcs', fact: 0, pct: null}) !== 'ok') P('нулевой брак помечен');
  /* Порядок строк идёт за реестром: человек читает таблицу и форму рядом. */
  const order = rows.map(r => r.k).join(',');
  const want = FACT_FIELDS.map(f => f.k).filter(k => order.includes(k)).join(',');
  if (order !== want) P(`порядок строк ${order} расходится с реестром ${want}`);
}

/* Расчёт, с которым сравнивают, обязан покрывать все величины, кроме брака:
   его инструмент не обещает. */
{
  const src = readFileSync(resolve(root, 'js/ui/passport.js'), 'utf-8');
  const chunk = src.slice(src.indexOf('export function calcForFact'), src.indexOf('const src ='));
  for (const f of FACT_FIELDS) {
    const has = new RegExp(`\\b${f.k}:`).test(chunk);
    if (!has && f.k !== 'lossPcs') P(`в расчёте для факта нет величины «${f.name}»`);
    if (has && f.k === 'lossPcs') P('брак попал в расчёт — его никто не обещает');
  }
}

console.log('\nПроверка фактических замеров');
console.log(`  величин в реестре: ${FACT_FIELDS.length}`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nФакт считается верно, а паспорт спрашивает у реестра то, что в нём есть.');
