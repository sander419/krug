// Проверка листа для производства:
//   node tools/check-sheet.mjs
//
// Лист уходит из мастерской в чужие руки: по нему делают форму и режут гипс.
// Ошибка в нём не видна на экране — файл открывается, картинка рисуется, а размер
// стоит не тот. Поэтому проверяется разметка (SVG обязан быть валидным XML),
// полнота (три вида, размеры, таблица, ДНК) и то, что числа на листе совпадают
// с числами модели.
import { buildSheet } from '../js/core/sheet.js';

const problems = [];
const P = t => problems.push(t);

const prof = [];
for (let i = 0; i <= 40; i++) {
  const t = i / 40;
  prof.push({y: t * 220, r: 20 + 60 * Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - t * 0.4)});
}
const model = {
  name: 'Кувшин «Проба»', date: '30.08.2026', dna: '#dna=abc',
  prof, wall: 5, footH: 6, footR: 45, H: 220, D: 160,
  firedH: 200, firedD: 145, shrinkPct: 9.1,
  parts: [
    {name: 'Ручка', az: 180, reach: 118, pts: [{x: 78, y: 170}, {x: 118, y: 120}, {x: 74, y: 74}]},
    {name: 'Носик', az: 0, reach: 132, pts: [{x: 76, y: 136}, {x: 132, y: 168}]},
  ],
  rows: [['Высота на круге', '220 мм'], ['Диаметр', '160 мм'], ['Стенка', '5 мм'],
         ['Масса сырца', '1,09 кг'], ['После обжига', '200×145 мм'], ['Усадка', '9,1 %'],
         ['Частей формы', '2'], ['Гипса на форму', '6,4 кг']],
  notes: ['Прилепы на видах спереди и в разрезе развёрнуты в плоскость листа.',
          'Размеры сырые, до обжига.'],
};

const svg = buildSheet(model);

/* ---------- разметка ---------- */
if (!svg.startsWith('<svg')) P('файл не начинается с <svg>');
if (!svg.trimEnd().endsWith('</svg>')) P('файл не закрыт тегом </svg>');
if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) P('без xmlns SVG не откроется как картинка');
if (/NaN|Infinity|undefined/.test(svg)) P('в разметке есть NaN, Infinity или undefined');

// теги обязаны сойтись: незакрытый тег даёт пустую страницу в браузере
const opens = [...svg.matchAll(/<([a-z]+)(?=[\s>])/g)].map(m => m[1]);
const closes = [...svg.matchAll(/<\/([a-z]+)>/g)].map(m => m[1]);
const selfClosed = [...svg.matchAll(/<([a-z]+)[^>]*\/>/g)].map(m => m[1]);
for (const tag of new Set(opens)) {
  const need = opens.filter(t => t === tag).length - selfClosed.filter(t => t === tag).length;
  const got = closes.filter(t => t === tag).length;
  if (need !== got) P(`тег <${tag}>: открыт ${need} раз, закрыт ${got}`);
}

/* ---------- полнота ---------- */
for (const must of ['Вид спереди', 'Разрез', 'Вид сверху'])
  if (!svg.includes(must)) P(`на листе нет вида «${must}»`);
if (!svg.includes(model.name)) P('на листе нет названия изделия');
if (!svg.includes(model.date)) P('на листе нет даты');
if (!svg.includes(model.dna)) P('на листе нет ДНК — лист нечем воспроизвести');
for (const [l, v] of model.rows) {
  if (!svg.includes(l)) P(`в таблице нет строки «${l}»`);
  if (!svg.includes(v)) P(`в таблице нет значения «${v}»`);
}
for (const n of model.notes) if (!svg.includes(n)) P('на листе нет пояснения к видам');
for (const p of model.parts) if (!svg.includes(`${p.name} ${p.az}°`)) P(`на виде сверху нет «${p.name}»`);

/* ---------- размеры ---------- */
if (!svg.includes('⌀160')) P('размер диаметра на листе не совпадает с моделью');
if (!svg.includes('>220<')) P('размер высоты на листе не совпадает с моделью');
if (!svg.includes('масштаб 1:')) P('на листе не указан масштаб');

/* Виды в одном масштабе: иначе их нельзя сравнивать. Проверяем через ширину
   листа — при вдвое большем изделии масштаб обязан стать вдвое мельче. */
const scale = s => parseFloat(/масштаб 1:([\d.]+)/.exec(s)[1]);
const twice = buildSheet({...model, H: 440, D: 320, prof: prof.map(p => ({r: p.r * 2, y: p.y * 2})),
  parts: model.parts.map(p => ({...p, reach: p.reach * 2, pts: p.pts.map(q => ({x: q.x * 2, y: q.y * 2}))}))});
/* Точной пропорции требовать нельзя: масштаб ограничивает то поле, которому
   тесаее всех, и у разных изделий это разные поля. Требуем, чтобы вдвое большее
   изделие рисовалось примерно вдвое мельче и уж точно не крупнее. */
const ratio = scale(twice) / scale(svg);
if (!(ratio > 1.7 && ratio < 2.3))
  P(`масштаб не следует за размером изделия: 1:${scale(svg).toFixed(1)} → 1:${scale(twice).toFixed(1)}`);

/* Изделие без прилепов — тоже лист, а не ошибка. */
const bare = buildSheet({...model, parts: []});
if (!bare.includes('Вид сверху') || /NaN/.test(bare)) P('лист без прилепов не собрался');

/* Экранирование: имя из чужих рук не должно ломать разметку. */
const evil = buildSheet({...model, name: 'Ваза <script>&"'});
if (evil.includes('<script>')) P('имя изделия не экранируется — лист можно сломать названием');

console.log('Проверка листа для производства\n');
console.log(`  ${(svg.length / 1024).toFixed(1)} КБ · масштаб 1:${scale(svg).toFixed(1)} · ` +
  `видов 3, строк таблицы ${model.rows.length}, прилепов ${model.parts.length}`);

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nЛист собирается целиком и совпадает с моделью.');
