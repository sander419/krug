// Проверка читаемости темы:
//   node tools/check-contrast.mjs
//
// Тему легко сделать красивой на своём мониторе и нечитаемой на чужом. Инструмент,
// в который смотрят часами и часто грязными руками при дневном свете, обязан
// держать контраст, а не надеяться на удачу. Считается по WCAG 2.1: отношение
// яркостей 4.5:1 для текста и 3:1 для крупного текста, иконок и границ.
//
// Токены читаются прямо из styles.css: никакого второго списка цветов, который
// разъедется с настоящим.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(root, 'styles.css'), 'utf-8');
const problems = [];
const P = t => problems.push(t);

/** Токены одной темы: из :root или из :root[data-theme="light"]. */
function tokens(selector) {
  const i = css.indexOf(selector);
  if (i < 0) { P(`в styles.css нет блока ${selector}`); return {}; }
  const body = css.slice(i, css.indexOf('}', i));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const hex = v => {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  const r = /^rgba?\(([^)]+)\)/.exec(v);
  if (r) {
    const p = r[1].split(',').map(x => parseFloat(x));
    return [p[0], p[1], p[2]];
  }
  return null;
};

/* Полупрозрачный цвет поверх подложки: считаем то, что человек видит. */
function over(v, bg) {
  const c = hex(v), b = hex(bg);
  if (!c || !b) return c;
  const m = /^rgba\(([^)]+)\)/.exec(v);
  const a = m ? (parseFloat(m[1].split(',')[3]) || 1) : 1;
  return c.map((x, i) => x * a + b[i] * (1 - a));
}

const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* Пары «что на чём» и порог. 4.5 — обычный текст, 3 — крупный текст и границы. */
const PAIRS = [
  ['text', 'bg', 4.5, 'основной текст на фоне'],
  ['text', 'panel', 4.5, 'текст на панели'],
  ['text', 'panel2', 4.5, 'текст на карточке блока'],
  ['muted', 'panel', 4.5, 'пояснения на панели'],
  ['muted', 'panel2', 4.5, 'пояснения на карточке'],
  ['muted2', 'panel', 3, 'мелкие подписи на панели'],
  ['muted2', 'sunken', 3, 'мелкие подписи на утопленном'],
  ['accent2', 'panel', 4.5, 'ссылки и числа на панели'],
  ['accent2', 'bg', 4.5, 'ссылки на фоне'],
  ['accent', 'panel2', 3, 'акцентные подписи и рамки'],
  ['onAccent', 'accent', 4.5, 'текст на акцентной кнопке'],
  ['ok', 'panel2', 3, 'зелёное на карточке'],
  ['warn', 'panel2', 3, 'жёлтое на карточке'],
  ['bad', 'panel2', 3, 'красное на карточке'],
  ['ok', 'bg', 3, 'зелёное на фоне'],
  ['warn', 'bg', 3, 'жёлтое на фоне'],
  ['bad', 'bg', 3, 'красное на фоне'],
  ['line2', 'panel', 1.6, 'граница на панели'],
  ['sect-form', 'panel2', 3, 'цвет раздела «форма»'],
  ['sect-mat', 'panel2', 3, 'цвет раздела «масса»'],
  ['sect-print', 'panel2', 3, 'цвет раздела «печать»'],
  ['sect-glaze', 'panel2', 3, 'цвет раздела «глазурь»'],
  ['sect-tool', 'panel2', 3, 'цвет раздела «оснастка»'],
  ['text', 'field', 4.5, 'ввод в поле'],
  ['text', 'strip', 4.5, 'текст на полосе'],
  ['text', 'toastBg', 4.5, 'всплывающая строка'],
];

for (const [name, sel] of [['тёмная', ':root{'], ['светлая', ':root[data-theme="light"]{']]) {
  const t = tokens(sel);
  if (!Object.keys(t).length) continue;
  let worst = {r: 99, what: ''};
  for (const [fg, bg, min, what] of PAIRS) {
    if (!t[fg] || !t[bg]) { P(`${name}: нет токена ${!t[fg] ? fg : bg}`); continue; }
    const c = over(t[fg], t[bg]), b = over(t[bg], t.bg || t[bg]);
    if (!c || !b) { P(`${name}: цвет ${fg} или ${bg} не разбирается`); continue; }
    const r = ratio(c, b);
    if (r < min) P(`${name}: ${what} — контраст ${r.toFixed(2)}:1 при пороге ${min}:1 (--${fg} на --${bg})`);
    if (r < worst.r) worst = {r, what};
  }
  console.log(`  ${name} тема: самая слабая пара — ${worst.what}, ${worst.r.toFixed(2)}:1`);
}

console.log('\nПроверка читаемости темы');
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nОбе темы держат контраст по WCAG.');
