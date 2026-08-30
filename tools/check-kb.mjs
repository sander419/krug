// Проверка базы знаний: node tools/check-kb.mjs
import { ARTICLES, SECTIONS, CONTEXT_HELP, search } from '../js/config/kb/index.js';
import { readFileSync } from 'node:fs';

const problems = [];
const warn = [];
const ids = new Set();
const sectionIds = new Set(SECTIONS.map(s => s.id));
const BLOCK_KEYS = ['p', 'h', 'ul', 'ol', 'table', 'note', 'warn'];

for (const a of ARTICLES) {
  const id = a.id || '(без id)';
  if (!/^[a-z0-9-]+$/.test(a.id || '')) problems.push(`${id}: id должен быть kebab-case`);
  if (ids.has(a.id)) problems.push(`${id}: дублирующийся id`); else ids.add(a.id);
  if (!sectionIds.has(a.section)) problems.push(`${id}: неизвестный раздел "${a.section}"`);
  if (!a.title) problems.push(`${id}: нет заголовка`);
  if (!a.lead || a.lead.length < 40) problems.push(`${id}: lead короче 40 символов — в списке будет пусто`);
  if (!Array.isArray(a.tags) || !a.tags.length) warn.push(`${id}: нет тегов, хуже ищется`);
  if (!Array.isArray(a.body) || a.body.length < 2) problems.push(`${id}: тело статьи пустое`);
  for (const b of a.body || []) {
    const keys = Object.keys(b);
    if (keys.length !== 1) problems.push(`${id}: блок должен содержать ровно один ключ, найдено ${keys.join('+')}`);
    if (!BLOCK_KEYS.includes(keys[0])) problems.push(`${id}: неизвестный тип блока "${keys[0]}"`);
    if (b.table) {
      const w = b.table.head.length;
      b.table.rows.forEach((r, i) => {
        if (r.length !== w) problems.push(`${id}: таблица, строка ${i + 1}: ${r.length} ячеек вместо ${w}`);
      });
    }
  }
  for (const l of a.links || []) if (!ARTICLES.some(x => x.id === l)) problems.push(`${id}: битая ссылка на "${l}"`);
  for (const s of a.src || []) if (!/^https?:\/\//.test(s.u || '')) problems.push(`${id}: источник без ссылки`);
}

for (const [k, v] of Object.entries(CONTEXT_HELP))
  if (!ARTICLES.some(a => a.id === v)) problems.push(`CONTEXT_HELP.${k} ведёт в никуда: "${v}"`);

for (const s of SECTIONS)
  if (!ARTICLES.some(a => a.section === s.id)) warn.push(`раздел "${s.id}" пуст`);

// поиск должен что-то находить по ключевым словам
for (const q of ['цек', 'усадка', 'шамот', 'конус', 'осадка', 'пыль'])
  if (!search(q).length) problems.push(`поиск не находит ничего по запросу "${q}"`);

/* Кнопки «?» на панели и «почему» у замечаний ведут в статью по её id.
   Несуществующий id — молчащая кнопка: нажатие ничего не открывает, и заметить
   это можно только руками. Поэтому разметку сверяем с реестром. */
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
  const ids = new Set(ARTICLES.map(a => a.id));
  const used = [...new Set([...html.matchAll(/data-kb="([^"]+)"/g)].map(m => m[1]))];
  for (const id of used)
    if (!ids.has(id)) problems.push(`кнопка справки ведёт в несуществующую статью "${id}"`);
  if (used.length < 5) problems.push('на панели почти нет кнопок справки — разметку не разобрали');
}

console.log(`База знаний: ${ARTICLES.length} статей в ${SECTIONS.length} разделах`);
for (const s of SECTIONS) {
  const list = ARTICLES.filter(a => a.section === s.id);
  console.log(`  ${s.name.padEnd(16)} ${list.length} · ${list.map(a => a.id).join(', ')}`);
}
if (warn.length) { console.log('\nЗамечания:'); for (const w of warn) console.log('  · ' + w); }
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nВсе статьи целы, ссылки ведут внутрь базы.');
