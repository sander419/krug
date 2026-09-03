// Журнал замеров глазури:
//   node --import ./tools/node-three.mjs tools/check-glazelog.mjs
//
// Журнал существует ради одного числа, которого у инструмента нет и не будет:
// толщины плёнки в миллиметрах. Поэтому здесь опаснее обычного любая
// «помощь» модели данных — обрезать опечатку до правдоподобного, подставить
// среднее по чужой глазури, назвать один замер толщиной. Каждая такая
// любезность превращает журнал в тот же выдуманный расчёт, от которого
// он должен спасать.
import { blankEntry, sanitizeEntry, loadLog, saveLog, addEntry, removeEntry,
         summarize, APPLY_WAYS, OUTCOMES, LOG_LIMITS, wayById, outcomeById,
         GLAZE_LOG_SCHEMA } from '../js/core/glazeLog.js';

const problems = [];
const P = t => problems.push(t);

/* В Node хранилища нет, а журнал — часть работы мастерской. */
if (typeof localStorage === 'undefined') {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
  };
}

/* ---------- «не мерили» не превращается в число ---------- */
{
  const e = blankEntry();
  for (const k of ['densityGcm3', 'dipSec', 'tempC', 'dryMM', 'firedMM'])
    if (e[k] !== null) P(`у пустой записи «${k}» = ${e[k]}, а должно быть «не мерили»`);

  /* Опечатка не обрезается до правдоподобного: обрезав «−5 секунд» до половины,
     мы получили бы замер, которого никто не делал. */
  const typo = sanitizeEntry({dipSec: -5, coats: 99, densityGcm3: 12, firedMM: 0.42});
  if (typo.dipSec !== null) P(`«−5 секунд» превратилось в ${typo.dipSec} вместо «не записано»`);
  if (typo.coats !== null) P(`«99 слоёв» превратилось в ${typo.coats}`);
  if (typo.densityGcm3 !== null) P(`плотность 12 г/см³ превратилась в ${typo.densityGcm3}`);
  if (typo.firedMM !== 0.42) P(`настоящий замер 0,42 мм не сохранился (${typo.firedMM})`);

  /* Мусор любого рода не роняет запись и не выдумывает значений. */
  for (const junk of [null, undefined, 'строка', 42, {way: 'нет', outcome: 'нет', defects: 'нет'}]) {
    const r = sanitizeEntry(junk);
    if (!r || typeof r.id !== 'string') P(`из «${String(junk)}» не вышло записи`);
    if (!APPLY_WAYS.some(w => w.id === r.way)) P(`способ нанесения «${r.way}» не из списка`);
    if (!OUTCOMES.some(o => o.id === r.outcome)) P(`исход «${r.outcome}» не из списка`);
    if (!Array.isArray(r.defects)) P('дефекты перестали быть списком');
  }
  /* Числа в пределах сохраняются как есть — журнал не «округляет по-своему». */
  const exact = sanitizeEntry({firedMM: 0.37, dryMM: 1.05, dipSec: 4.5, densityGcm3: 1.55, tempC: 1240, coats: 2});
  for (const [k, v] of Object.entries({firedMM: 0.37, dryMM: 1.05, dipSec: 4.5, densityGcm3: 1.55, tempC: 1240, coats: 2}))
    if (exact[k] !== v) P(`замер «${k}» ${v} сохранился как ${exact[k]}`);
}

/* ---------- отсутствие данных — это ответ ---------- */
{
  saveLog([]);
  if (summarize(loadLog(), {glazeId: 'tenmoku'}) !== null)
    P('по пустому журналу нашлась толщина — значит, она откуда-то выдумана');

  addEntry({matId: 'gzhel-red', glazeId: 'tenmoku', way: 'dip', firedMM: 0.4, dryMM: 1.1});
  addEntry({matId: 'gzhel-red', glazeId: 'tenmoku', way: 'dip', firedMM: 0.6, dryMM: 1.3});
  addEntry({matId: 'pg-75', glazeId: 'celadon', way: 'spray', firedMM: 0.2});

  const mine = summarize(loadLog(), {matId: 'gzhel-red', glazeId: 'tenmoku', way: 'dip'});
  if (!mine) P('свои же два замера не нашлись');
  else {
    if (mine.n !== 2) P(`замеров ${mine.n} вместо двух`);
    if (Math.abs(mine.firedMM - 0.5) > 1e-9) P(`среднее ${mine.firedMM} вместо 0,5`);
    /* Разброс важнее среднего: два замера 0,4 и 0,6 — это «пока не умеем
       повторять», а не «0,5 мм». */
    if (Math.abs(mine.spread - 0.2) > 1e-9) P(`разброс ${mine.spread} вместо 0,2`);
  }
  /* Чужая глазурь не подмешивается: целадон на фарфоре не отвечает
     за тенмоку на гжели. */
  const other = summarize(loadLog(), {matId: 'gzhel-red', glazeId: 'celadon'});
  if (other) P('замеры другой глазури засчитаны этой');
  const noWay = summarize(loadLog(), {glazeId: 'tenmoku', way: 'spray'});
  if (noWay) P('замеры маканием засчитаны пульверизатору — расход у них разный');

  /* Один замер — это один замер: среднее есть, разброса нет, и число замеров
     сказано рядом, чтобы человек сам решил, верить ли. */
  saveLog([]);
  addEntry({matId: 'gzhel-red', glazeId: 'shino', way: 'dip', firedMM: 0.5});
  const single = summarize(loadLog(), {glazeId: 'shino'});
  if (!single || single.n !== 1) P('одиночный замер не нашёлся');
  else if (single.spread !== null) P(`у одного замера появился разброс ${single.spread}`);
}

/* ---------- хранилище ---------- */
{
  saveLog([]);
  const rec = addEntry({matId: 'gzhel-red', glazeId: 'tenmoku', firedMM: 0.45, note: 'проба'});
  if (rec.length !== 1) P('запись не сохранилась');
  const back = loadLog()[0];
  if (!back || back.firedMM !== 0.45 || back.note !== 'проба') P('запись прочиталась не той');
  removeEntry(back.id);
  if (loadLog().length) P('запись не удалилась');

  /* Мусор в хранилище не роняет журнал: у мастерской он копится годами. */
  for (const junk of ['не json', '{}', '[1,2,3]', '[{"firedMM":"ерунда"}]']) {
    localStorage.setItem('krug.glazeLog', junk);
    let list;
    try { list = loadLog(); } catch (e) { P(`мусор «${junk}» уронил журнал: ${e.message}`); continue; }
    if (!Array.isArray(list)) P(`из мусора «${junk}» вышел не список`);
    for (const e of list) if (e.firedMM !== null && !Number.isFinite(e.firedMM)) P('в журнале не-число');
  }
  saveLog([]);
}

/* ---------- справочники журнала ---------- */
{
  if (GLAZE_LOG_SCHEMA !== 1) P('схема журнала изменилась — старые записи надо мигрировать');
  for (const w of APPLY_WAYS) {
    if (!w.id || !w.name || !w.what) P(`способ «${w.id}» описан не полностью`);
    if (wayById(w.id).id !== w.id) P(`способ «${w.id}» не находится по своему id`);
  }
  for (const o of OUTCOMES) {
    if (!o.id || !o.name || !o.tone) P(`исход «${o.id}» описан не полностью`);
    if (!['ok', 'warn', 'bad'].includes(o.tone)) P(`у исхода «${o.id}» тон «${o.tone}»`);
    if (outcomeById(o.id).id !== o.id) P(`исход «${o.id}» не находится по своему id`);
  }
  if (!OUTCOMES.some(o => o.tone === 'ok')) P('в списке исходов нет ни одного удачного');
  for (const [k, [lo, hi]] of Object.entries(LOG_LIMITS))
    if (!(lo < hi) || lo < 0) P(`пределы поля «${k}» бессмысленны: ${lo}…${hi}`);
}

console.log('\nЖурнал замеров глазури');
console.log(`  способов нанесения: ${APPLY_WAYS.length} · исходов: ${OUTCOMES.length} · полей замера: ${Object.keys(LOG_LIMITS).length}`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const t of problems) console.log('  ✗ ' + t);
  process.exit(1);
}
console.log('\nЖурнал не выдумывает чисел: опечатка не замер, пустой журнал — «неизвестно».');
