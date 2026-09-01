// Проверка источников: node tools/check-sources.mjs
//
// «Ни одного числа без объяснения его происхождения» — обещание, которое легко
// дать и незаметно потерять: достаточно один раз дописать в реестр
// правдоподобное значение без ссылки. Здесь это ловится машиной.
//
// Правила и иерархия источников — в docs/DATA-SOURCES.md. Проверка следит
// за тем, что записано в реестрах, и отдельно печатает то, о чём стоит помнить:
// сколько записей висит на вторичных источниках и у скольких нет даты сверки.
import { MATERIALS } from '../js/config/materials.js';
import { GLAZES } from '../js/config/glazes.js';
import { PLASTERS } from '../js/config/plasters.js';
import { KILNS } from '../js/config/kilns.js';

const problems = [];
const P = t => problems.push(t);
const KINDS = ['vendor', 'dealer', 'ref', 'practice'];

/* Числа, которые уходят в расчёт и показываются человеку. Имена — те же,
   что в реестрах: выдуманное поле проверка «не найдёт» и промолчит, а это
   ровно тот случай, ради которого она и написана. */
const COUNTED = {
  mat: ['shrinkPct', 'absorption', 'grog', 'firing', 'packKg', 'priceRub'],
  glaze: ['cone', 'tempC', 'family', 'form', 'packKg', 'priceRub'],
  plaster: ['strengthMPa', 'setMin', 'waterRatio', 'packKg', 'priceRub'],
  kiln: ['innerMM', 'volumeL', 'powerKW', 'maxC', 'shelves', 'shelfMM'],
};

/* Поле реестра существует хотя бы у одной записи — иначе имя в списке выше
   опечатка, и проверка ничего не проверяет. */
function fieldsExist(name, list, fields) {
  for (const f of fields)
    if (!list.some(r => r[f] !== undefined))
      P(`${name}: поля «${f}» нет ни у одной записи — проверка смотрит не туда`);
}

const marked = (r, f) =>
  (r.est || []).includes(f) || (r.unknown || []).includes(f) || (r.na || []).includes(f);

let вторичных = 0, безДаты = 0, безКласса = 0, всегоСсылок = 0;

/** Реестры с паспортами: источник обязателен. */
function checkPassport(name, list, fields) {
  for (const r of list) {
    const src = r.src || [];
    if (!src.length) { P(`${name}: «${r.name || r.id}» без единого источника`); continue; }
    const seen = new Set();
    for (const s of src) {
      всегоСсылок++;
      if (!s.t || !String(s.t).trim()) P(`${name}: «${r.name}» — ссылка без подписи`);
      let url = null;
      try { url = new URL(s.u); } catch (_) { P(`${name}: «${r.name}» — ссылка не разбирается: ${s.u}`); continue; }
      if (!/^https?:$/.test(url.protocol)) P(`${name}: «${r.name}» — ссылка не http(s)`);
      if (seen.has(s.u)) P(`${name}: «${r.name}» — ссылка повторяется: ${s.u}`);
      seen.add(s.u);
      /* Ссылка на главную страницу через год ничего не докажет: числа лежат
         на карточке товара, а не на витрине. */
      if (url.pathname === '/' && !url.search)
        P(`${name}: «${r.name}» — ссылка ведёт на главную, а не на страницу с числами`);
      if (s.kind && !KINDS.includes(s.kind))
        P(`${name}: «${r.name}» — класс источника «${s.kind}» не из ${KINDS.join('/')}`);
      if (!s.kind) безКласса++;
      if (s.kind === 'dealer') вторичных++;
      if (!s.checked) безДаты++;
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(s.checked))
        P(`${name}: «${r.name}» — дата сверки не в виде ГГГГ-ММ-ДД: ${s.checked}`);
      else if (new Date(s.checked) > new Date())
        P(`${name}: «${r.name}» — дата сверки из будущего: ${s.checked}`);
    }
    for (const f of fields)
      if (r[f] === undefined && !marked(r, f))
        P(`${name}: «${r.name}» — нет ${f} и нет пометки est/unknown/na`);
  }
}

/** Реестры типовых классов: паспорта нет, зато всё обязано стоять в est. */
function checkTypical(name, list, fields) {
  for (const r of list) {
    if ((r.src || []).length) continue;      // источник есть — тем лучше
    for (const f of fields)
      if (r[f] !== undefined && !marked(r, f))
        P(`${name}: «${r.name}» — ${f} без источника и без пометки est: ` +
          'типовой класс обязан быть помечен оценкой');
  }
}

fieldsExist('массы', MATERIALS, COUNTED.mat);
fieldsExist('глазури', GLAZES, COUNTED.glaze);
fieldsExist('гипсы', PLASTERS, COUNTED.plaster);
fieldsExist('печи', KILNS, COUNTED.kiln);

checkPassport('массы', MATERIALS, COUNTED.mat);
checkPassport('глазури', GLAZES, COUNTED.glaze);
checkPassport('гипсы', PLASTERS, COUNTED.plaster);
checkTypical('печи', KILNS, COUNTED.kiln);

console.log('\nПроверка источников');
console.log(`  ссылок в реестрах: ${всегоСсылок}` +
  ` · на вторичных источниках: ${вторичных}` +
  ` · без класса: ${безКласса} · без даты сверки: ${безДаты}`);
if (безДаты || безКласса)
  console.log('  (класс и дата обязательны для новых записей; у старых их может не быть —\n' +
    '   выдумывать дату, которой не было, хуже, чем её отсутствие)');
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nКаждое число либо со ссылкой, либо помечено оценкой. Правила — docs/DATA-SOURCES.md.');
