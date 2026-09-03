// Проверка интерфейса:
//   node tools/check-ui.mjs
//
// Дизайн держится не вкусом, а правилами, которые кто-то проверяет. Эти —
// из трёх сводов: механика интерфейса (Vercel Web Interface Guidelines),
// эвристики Крага и Нильсена и «пол ремесла» Impeccable. Здесь только то,
// что можно проверить машиной: остальное проверяется глазами.
//
// Каждое правило тут стоит потому, что мы уже на нём спотыкались или потому,
// что нарушение не видно на экране — а видно только пользователю.
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname, sep as sep2 } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const css = readFileSync(new URL('styles.css', root), 'utf-8');
const html = readFileSync(new URL('index.html', root), 'utf-8');
const problems = [];
const P = t => problems.push(t);

/* ---------- поверхности браузера ---------- */
/* Impeccable: части, которые мы не рисовали, всё равно принадлежат дизайну.
   Это самый дешёвый признак того, что страницу сделали, а не собрали. */
for (const [what, re] of [
  ['выделение текста (::selection)', /::selection\s*\{/],
  ['каретка (caret-color)', /caret-color\s*:/],
  ['галочки и ползунки (accent-color)', /accent-color\s*:/],
  ['маркеры списка (::marker)', /::marker\s*\{/],
  ['полосы прокрутки', /scrollbar-color\s*:|::-webkit-scrollbar\b/],
]) if (!re.test(css)) P(`не оформлено: ${what} — останется браузерное умолчание`);

/* Кольцо фокуса — одно на весь инструмент и видимое. */
if (!/:focus-visible[^{]*\{[^}]*outline\s*:\s*2px/.test(css))
  P('нет общего видимого кольца фокуса на :focus-visible');
if ((css.match(/^:focus-visible\s*\{/gm) || []).length > 1)
  P('кольцо фокуса объявлено дважды — версии разойдутся при первой правке');
if ((css.match(/^::selection\s*\{/gm) || []).length > 1)
  P('::selection объявлен дважды');

/* ---------- запрещённые приёмы ---------- */
if (/transition\s*:\s*all/.test(css)) P('transition: all — анимируется и то, что не должно');
/* Impeccable: цветная полоса слева толще волоса — украшение, которое кричит
   громче собственного заголовка. Их было девять, панель читалась как забор. */
{
  /* Смотрим правило целиком: те же border-right делают галочку-стрелку
     из квадрата 8×8 — это нарисованный глиф, а не полоса на карточке. */
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const m = body.match(/border-(left|right)\s*:\s*(\d+(?:\.\d+)?)px\s+solid\s+var\(--(?!line\b)([a-zA-Z0-9-]+)/);
    if (!m || +m[2] <= 1) continue;
    if (/transform\s*:\s*rotate|width\s*:\s*\d?\dpx/.test(body)) continue;   // глиф, не полоса
    const where = sel.replace(/\/\*[\s\S]*?\*\//g, '').trim().split('\n').pop().slice(0, 40);
    P(`цветная боковая полоса ${m[2]}px var(--${m[3]}) в «${where}» — Impeccable запрещает её как украшение`);
  }
}
/* Капслок в микрокегле — «эйбрау»: этикетка на этикетке. Заголовок несёт вес
   размером, а не тем, что он накричал. */
{
  const caps = (css.match(/text-transform\s*:\s*uppercase/g) || []).length;
  if (caps) P(`капслок в стилях (${caps}) — подписи должны быть сентенс-кейсом`);
}
if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(html))
  P('зум страницы запрещён — это лишает зрения тех, кому он нужен');

/* ---------- шкала размеров ---------- */
/* Шаги обязаны быть заметны: 12 → 13 → 14 читается как одна каша. */
{
  const sizes = [...css.matchAll(/--fs-([a-z]+)\s*:\s*calc\((\d+(?:\.\d+)?)px/g)]
    .map(m => ({name: m[1], px: +m[2]}));
  const order = ['micro', 'xs', 'sm', 'md', 'lg', 'xl', 'display'];
  const have = order.map(n => sizes.find(s => s.name === n)).filter(Boolean);
  if (have.length < 6) P(`в шкале всего ${have.length} ступеней — крупному нечем отличаться от мелкого`);
  for (let i = 1; i < have.length; i++) {
    const k = have[i].px / have[i - 1].px;
    if (k < 1.06) P(`ступени --fs-${have[i - 1].name} и --fs-${have[i].name} почти совпадают (${have[i - 1].px} → ${have[i].px} px)`);
  }
  const body = have.find(h => h.name === 'sm');
  if (body && body.px < 13) P(`тело интерфейса ${body.px} px — мелко для длинного чтения`);
}

/* ---------- цели нажатия ---------- */
/* Палец толще курсора: под касанием всё, во что целятся, — не мельче 44 px. */
{
  /* Правило может стоять и по типу указателя, и по ширине — телефон узнаётся
     и так, и так. Ищем любое из мест, где под касание поднимают высоту. */
  const blocks = css.split(/@media \(pointer:coarse\)[^{]*\{|@media \(max-width:940px\)\{/).slice(1);
  const ok = blocks.some(b => /min-height\s*:\s*(4[4-9]|[5-9]\d)px/.test(b.slice(0, 1200)));
  if (!ok) P('нигде под касание не поднята цель нажатия до 44 px');
}

/* ---------- разметка ---------- */
/* Тест ствола Крага: «что это за инструмент» должно читаться с первого экрана. */
{
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) P(`на странице ${h1} заголовков h1 — должен быть ровно один`);
}
/* Кнопка-иконка без подписи — «загадочное мясо»: понятно только тому,
   кто её нарисовал. */
{
  const btns = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  let mute = 0;
  for (const [, attrs, inner] of btns) {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    const labelled = /aria-label=|title=/.test(attrs);
    if (!text && !labelled) mute++;
  }
  if (mute) P(`кнопок без подписи и без aria-label: ${mute}`);
}
/* Поле без подписи — форма, которую заполняют наугад. */
{
  /* Имя полю даёт любое из трёх: обёртка <label>, label[for] или aria-label. */
  const wrapped = at => {
    const open = html.lastIndexOf('<label', at), close = html.lastIndexOf('</label>', at);
    return open > -1 && open > close;
  };
  const bad = [];
  for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
    const a = m[1];
    if (/type="(hidden|file|range|checkbox|radio)"/.test(a)) continue;
    const id = (a.match(/id="([^"]+)"/) || [])[1];
    if (/aria-label=/.test(a)) continue;
    if (id && html.includes(`for="${id}"`)) continue;
    if (wrapped(m.index)) continue;
    bad.push(id || '(без id)');
  }
  if (bad.length) P(`поля без подписи: ${bad.join(', ')}`);
}
/* Ссылки и кнопки — разными тегами: <div onclick> не берёт ни клавиатура,
   ни читалка экрана. */
if (/<div[^>]*\son[cC]lick=/.test(html)) P('<div> с обработчиком клика вместо кнопки');

/* Поиск умеет только то, что есть в разметке: действие с несуществующей
   кнопкой он молча выбрасывает из выдачи. Так пропала «Схема изделия
   для производства» — id кнопки поменялся, а реестр действий остался прежним. */
{
  const finder = readFileSync(new URL('js/ui/finder.js', root), 'utf-8');
  for (const m of finder.matchAll(/btn: '([^']+)'/g))
    if (!new RegExp('id="' + m[1] + '"').test(html))
      P('поиск зовёт кнопку «' + m[1] + '», которой нет в разметке — пункт не покажется');
}

/* ---------- всё вообще разбирается ---------- */
/* Синтаксическая ошибка в любом файле интерфейса кладёт приложение целиком:
   модуль не загружается, вкладка пустая. Проверки этого не видели — они
   импортируют ядро, а не интерфейс, и оставались зелёными при мёртвом экране.
   Случилось ровно это: скрипт правки превратил «\n» в настоящий перевод
   строки внутри строкового литерала.

   Поэтому каждый файл проекта проверяется разбором — тем же node --check,
   которым его прочитает браузер. */
{
  const files = [];
  const walk = dir => {
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  };
  const rootDir = fileURLToPath(root);
  walk(join(rootDir, 'js'));
  let broken = 0;
  /* `node --check` на файле с расширением .js разбирает его как CommonJS
     и молча проглатывает даже «const x = ;» — проверка выглядела рабочей
     и не ловила ничего. Браузер читает эти файлы как модули, поэтому и здесь
     они разбираются как модули: содержимое кладётся во временный .mjs. */
  const tmp = join(tmpdir(), 'krug-parse-' + process.pid + '.mjs');
  for (const f of files) {
    writeFileSync(tmp, readFileSync(f));
    const r = spawnSync(process.execPath, ['--check', tmp], {encoding: 'utf8'});
    if (r.status !== 0) {
      broken++;
      const msg = String(r.stderr || '').split('\n').find(l => /Error|error/.test(l)) || 'не разбирается';
      problems.push(`${f.replace(fileURLToPath(root), '')}: ${msg.trim()}`);
    }
  }
  try { rmSync(tmp, {force: true}); } catch (_) {}
  if (files.length < 40) problems.push(`файлов проекта нашлось ${files.length} — похоже, искали не там`);
  if (!broken) console.log(`  разбор: ${files.length} файлов, все читаются браузером`);
}


console.log('Проверка интерфейса\n');
{
  const sizes = [...css.matchAll(/--fs-[a-z]+\s*:\s*calc\((\d+(?:\.\d+)?)px/g)].map(m => m[1]);
  console.log(`  шкала: ${sizes.join(' → ')} px · правил в styles.css ${(css.match(/\{/g) || []).length}`);
  console.log(`  поверхности браузера, кольцо фокуса, цели под касание, тест ствола — на месте`);
}

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nИнтерфейс держит правила: ничего запрещённого, ничего немаркированного.');
