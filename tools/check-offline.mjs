// Проверка автономности:
//   node tools/check-offline.mjs
//
// У КРУГа нет внешних запросов принципиально: он открывается с флешки, из папки,
// в мастерской без интернета. Это легко сломать одной строкой — подключить шрифт
// с CDN, иконку по ссылке, «временно» дёрнуть API. Ломается тихо: на машине
// разработчика всё грузится, у мастера в подвале — нет.
//
// Проверяются не комментарии, а то, что браузер действительно пойдёт грузить:
// src/href в разметке, importmap, url() в стилях, сеть в скриптах.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const P = t => problems.push(t);
const rd = p => readFileSync(join(root, p), 'utf-8');

const EXTERNAL = /^(https?:)?\/\//i;

/* ---------- разметка ---------- */
const html = rd('index.html');
// src грузится всегда; href опасен только у <link> — ссылка в тексте это
// переход по клику человека, а не запрос страницы
for (const m of html.matchAll(/\bsrc\s*=\s*"([^"]*)"/g))
  if (EXTERNAL.test(m[1])) P(`index.html тянет из сети: ${m[1]}`);
for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*"([^"]*)"/g))
  if (EXTERNAL.test(m[1])) P(`index.html подключает из сети: ${m[1]}`);

const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
if (!map) P('в index.html нет importmap — three и floating-ui не найдутся');
else {
  let imports = {};
  try { imports = JSON.parse(map[1]).imports || {}; }
  catch (e) { P('importmap не разбирается как JSON: ' + e.message); }
  for (const [k, v] of Object.entries(imports)) {
    if (EXTERNAL.test(v)) P(`importmap «${k}» указывает в сеть: ${v}`);
    const path = v.replace(/^\.\//, '');
    try { statSync(join(root, path)); }
    catch (_) { P(`importmap «${k}» указывает на несуществующий ${v}`); }
  }
  for (const need of ['three', '@floating-ui/dom', '@floating-ui/core'])
    if (!imports[need]) P(`в importmap нет «${need}» — модуль не разрешится в браузере`);
}

/* ---------- стили ---------- */
for (const css of ['styles.css', 'vendor/fonts/fonts.css']) {
  let text = '';
  try { text = rd(css); } catch (_) { P(`нет файла ${css}`); continue; }
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/g))
    if (EXTERNAL.test(m[1])) P(`${css} тянет из сети: ${m[1]}`);
  for (const m of text.matchAll(/@import\s+['"]([^'"]+)/g))
    if (EXTERNAL.test(m[1])) P(`${css} импортирует из сети: ${m[1]}`);
}

/* ---------- скрипты ---------- */
function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(rel);
  }
  return out;
}
const scripts = walk('js');
let vendored = 0;
for (const f of scripts) {
  const text = rd(f), name = f.replace(/\\/g, '/');
  /* В реестрах и энциклопедии внешние адреса — это источники: у каждого числа
     сказано, откуда оно взято, и ссылка показывается человеку для клика.
     Запроса она не делает. Везде, кроме данных, адрес в коде — это загрузка. */
  if (!name.startsWith('js/config/'))
    for (const m of text.matchAll(/['"`](https?:)?\/\/[^'"`\s]+['"`]/g))
      P(`${name}: внешний адрес в коде ${m[0].slice(0, 60)}`);
  for (const bad of ['XMLHttpRequest', 'navigator.sendBeacon', 'EventSource', 'new WebSocket'])
    if (text.includes(bad)) P(`${name}: ${bad} — сеть в браузере`);
}
// fetch у нас разрешён только для локальных файлов: их и проверяем отдельно
for (const f of scripts)
  for (const m of rd(f).matchAll(/fetch\(\s*['"`]([^'"`]*)/g))
    if (EXTERNAL.test(m[1])) P(`${f.replace(/\\/g, '/')}: fetch в сеть — ${m[1]}`);

/* ---------- лицензии вендоренного ---------- */
for (const dir of readdirSync(join(root, 'vendor'))) {
  const full = join(root, 'vendor', dir);
  if (!statSync(full).isDirectory()) continue;
  vendored++;
  try { statSync(join(full, 'LICENSE')); }
  catch (_) { P(`vendor/${dir}: нет LICENSE — чужой код без лицензии в репозитории`); }
}

console.log('Проверка автономности\n');
console.log(`  разметка, ${scripts.length} скриптов, стили и ${vendored} вендоренных пакета`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nВнешних запросов нет: КРУГ открывается без интернета.');
