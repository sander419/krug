// Проверка задач и вкладок:
//   node tools/check-routes.mjs
//
// Задача прячет вкладки, поэтому расхождение конфига с разметкой не падает
// ошибкой, а тихо оставляет человека без инструмента: вкладка есть в HTML,
// но ни одна задача её не включает — и найти её нельзя ничем. Здесь это ловится.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TABS, TAB_ORDER, ROUTES, DEFAULT_ROUTE, routeById, routeTabs } from '../js/config/routes.js';
import { ICONS } from '../js/config/icons.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf-8');
const problems = [];
const P = t => problems.push(t);
const all = s => [...html.matchAll(s)].map(m => m[1]);

const tabsInHtml = all(/class="tab[^"]*"[^>]*data-tab="([a-z]+)"/g);
const panesInHtml = all(/class="tabpane[^"]*"[^>]*data-pane="([a-z]+)"/g);
const keys = Object.keys(TABS);

for (const k of keys) {
  if (!tabsInHtml.includes(k)) P(`вкладка «${k}» описана в routes.js, но кнопки в index.html нет`);
  if (!panesInHtml.includes(k)) P(`вкладке «${k}» нечего показать: нет .tabpane[data-pane="${k}"]`);
  if (!TAB_ORDER.includes(k)) P(`вкладка «${k}» не попала в TAB_ORDER — её некуда поставить`);
  if (!ICONS[TABS[k].ico]) P(`иконки «${TABS[k].ico}» для вкладки «${k}» нет в config/icons.js`);
  if (!TABS[k].txt || TABS[k].txt.length < 30) P(`у вкладки «${k}» нет строки о том, что на ней делают`);
}
for (const t of tabsInHtml)
  if (!keys.includes(t)) P(`вкладка «${t}» есть в index.html, но задачи о ней не знают — её никто не включит`);
for (const p of panesInHtml)
  if (!keys.includes(p)) P(`панель «${p}» есть в index.html, но вкладки для неё не описано`);

const ids = new Set();
for (const r of ROUTES) {
  if (ids.has(r.id)) P(`задача «${r.id}» описана дважды`);
  ids.add(r.id);
  if (!ICONS[r.ico]) P(`иконки «${r.ico}» для задачи «${r.id}» нет в config/icons.js`);
  if (!r.tabs.length) P(`задача «${r.id}» не включает ни одной вкладки — панель будет пустой`);
  for (const t of r.tabs) if (!keys.includes(t)) P(`задача «${r.id}» просит вкладку «${t}», которой нет`);
  // порядок в конфиге должен совпадать с порядком в панели, иначе конфиг врёт
  if (r.tabs.join() !== routeTabs(r).join())
    P(`задача «${r.id}»: вкладки перечислены не в порядке панели (${r.tabs.join(' ')} против ${routeTabs(r).join(' ')})`);
  if (!r.lead || r.lead.length < 30) P(`у задачи «${r.id}» нет человеческого описания`);
}

const covered = new Set(ROUTES.flatMap(r => r.tabs));
for (const k of keys)
  if (!covered.has(k)) P(`вкладку «${k}» не включает ни одна задача — до неё не добраться`);

const def = routeById(DEFAULT_ROUTE);
if (!def) P(`умолчание «${DEFAULT_ROUTE}» не описано в ROUTES`);
else if (def.tabs.length !== keys.length)
  P(`умолчание «${DEFAULT_ROUTE}» прячет вкладки: до выбора задачи не должно пропадать ничего`);

/* Блок «Размер под усадку» переехал из оснастки в массу: усадка — свойство
   массы, и нужна она всем, а не только тем, кто считает тираж. */
const mat = html.slice(html.indexOf('data-pane="mat"'), html.indexOf('data-pane="print"'));
if (!mat.includes('data-block="shrinkfit"'))
  P('блок «Размер под усадку» не в панели массы: на задачах без оснастки до него не добраться');

console.log('Проверка задач и вкладок\n');
console.log(`  вкладок ${keys.length}, задач ${ROUTES.length}, умолчание «${DEFAULT_ROUTE}»`);
for (const r of ROUTES)
  console.log(`  ${r.name.padEnd(20)} ${routeTabs(r).map(t => TABS[t].name).join(' → ')}`);

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nЗадачи и вкладки сходятся.');
