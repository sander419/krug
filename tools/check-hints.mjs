// Проверка подсказок: node tools/check-hints.mjs
//
// Подсказка врёт двумя способами. Первый: она висит на селекторе, которого
// в интерфейсе больше нет, — тогда её просто никто не увидит, и об этом никто
// не узнает. Второй: она ведёт в статью, которой нет в базе знаний, — тогда
// «почему» упирается в пустоту.
//
// Оба ловятся тут. Заодно проверяется тон: подсказка обязана говорить, что это
// и что с этим делать, а не повторять подпись кнопки.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { HINTS } from '../js/config/hints.js';
import { TOUR } from '../js/config/tour.js';
import { articleById } from '../js/config/kb/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const P = t => problems.push(t);

/* Разметка живёт и в index.html, и в строках модулей: половина экранов
   собирается шаблонами. Ищем по обоим. */
function allSources() {
  const out = [readFileSync(resolve(root, 'index.html'), 'utf-8')];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) out.push(readFileSync(p, 'utf-8'));
    }
  };
  walk(resolve(root, 'js'));
  return out.join('\n');
}
const src = allSources();

const MIN = 40;                       // короче — это подпись, а не подсказка
const AT = ['top', 'bottom', 'left', 'right'];
const seen = new Set();

for (const h of HINTS) {
  if (!h.sel) { P('подсказка без селектора'); continue; }
  if (seen.has(h.sel)) P(`селектор «${h.sel}» встречается дважды — вторая подсказка не покажется`);
  seen.add(h.sel);

  /* Селектор должен на что-то указывать. Проверяем якоря: каждый #id и .класс
     обязан встретиться в разметке или в шаблоне модуля. */
  for (const m of h.sel.matchAll(/[#.]([\w-]+)/g)) {
    const name = m[1];
    const asId = new RegExp(`id="${name}"|id: '${name}'|getElementById\\('${name}'\\)|"${name}"`);
    const asClass = new RegExp(`class="[^"]*\\b${name}\\b|classList[^\\n]*['"\`]${name}`);
    if (!asId.test(src) && !asClass.test(src))
      P(`подсказка «${h.sel}»: в интерфейсе нет ни id, ни класса «${name}»`);
  }
  for (const m of h.sel.matchAll(/\[data-([\w-]+)/g))
    if (!src.includes(`data-${m[1]}`)) P(`подсказка «${h.sel}»: нет атрибута data-${m[1]}`);

  const t = String(h.tip || '');
  if (t.length < MIN) P(`подсказка «${h.sel}» короче ${MIN} знаков — это подпись, а не объяснение`);
  if (!/[.!?»]$/.test(t.trim())) P(`подсказка «${h.sel}» не заканчивается точкой`);
  if (/^Нажмите|^Кнопка |^Открыть /.test(t))
    P(`подсказка «${h.sel}» начинается с «нажмите» — человек и так видит кнопку`);
  if (h.at && !AT.includes(h.at)) P(`подсказка «${h.sel}»: сторона «${h.at}» не из ${AT.join('/')}`);
  if (h.kb && !articleById(h.kb)) P(`подсказка «${h.sel}» ведёт в статью «${h.kb}», которой нет`);
}

/* ---------- экскурсия ---------- */
/* Шаг, показывающий несуществующий элемент, молча пропускается в браузере —
   и человек недосчитается остановки, не узнав об этом. Ловим здесь. */
const tourSeen = new Set();
for (const s of TOUR) {
  if (!s.id || !s.sel || !s.title || !s.text) { P(`шаг экскурсии «${s.id || '?'}» неполон`); continue; }
  if (tourSeen.has(s.id)) P(`шаг экскурсии «${s.id}» повторяется`);
  tourSeen.add(s.id);
  for (const m of s.sel.matchAll(/[#.]([\w-]+)/g)) {
    const name = m[1];
    const asId = new RegExp(`id="${name}"|"${name}"`);
    const asClass = new RegExp(`class="[^"]*\\b${name}\\b`);
    if (!asId.test(src) && !asClass.test(src))
      P(`шаг экскурсии «${s.id}»: в интерфейсе нет «${name}»`);
  }
  if (s.text.length < 80) P(`шаг экскурсии «${s.id}» слишком короткий, чтобы что-то объяснить`);
  if (s.at && !AT.includes(s.at)) P(`шаг экскурсии «${s.id}»: сторона «${s.at}» не из ${AT.join('/')}`);
  if (s.go && s.go.screen && !['works', 'passport', 'settings'].includes(s.go.screen))
    P(`шаг экскурсии «${s.id}» открывает неизвестный экран «${s.go.screen}»`);
}
if (TOUR.length < 8) P(`в экскурсии всего ${TOUR.length} остановок — этого мало для такого инструмента`);

/* Экраны, которые человек видит первыми, обязаны быть покрыты: без подсказок
   там остаётся стена кнопок. Список — то, ради чего затевался инструмент. */
const MUST = ['#worksBtn', '#passportBtn', '#releaseBtn', '#settingsBtn', '#kbBtn',
              '#thickSl', '#heightSl', '#matList', '#kilnBody', '.pp-fact',
              '#sculptBtn', '#pointBar', '.pat-stack'];
for (const sel of MUST)
  if (!seen.has(sel)) P(`нет подсказки к ключевому месту ${sel}`);

console.log('\nПроверка подсказок');
console.log(`  подсказок: ${HINTS.length}, со статьёй обучения: ${HINTS.filter(h => h.kb).length}`);
console.log(`  остановок экскурсии: ${TOUR.length}`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nПодсказки и экскурсия указывают на живые элементы и ведут в существующие статьи.');
