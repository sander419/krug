// Проверка перевода нарисованной линии в рецепт:
//   node tools/check-trace.mjs
//
// Рука рисует как попало: снизу вверх и сверху вниз, виляя, заезжая за ось
// и мимо пределов. Рецепт при этом обязан оставаться рецептом — иначе форма
// молча съедет, а виноватой будет казаться модель, а не ввод.
import { traceToRecipe, simplify, MIN_MM, MAX_MM } from '../js/core/trace.js';

const problems = [];
const P = t => problems.push(t);

/* силуэт кувшина: узкое дно, пузо на трети высоты, шейка, развёрнутая кромка */
const jug = (n = 60, H = 210, R = 52) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({y: t * H, r: 14 + R * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - t * 0.55) + 9 * Math.pow(t, 6)});
  }
  return out;
};

/** Радиус рецепта на доле высоты t — линейно между точками. */
function rAt(rec, t) {
  const p = rec.points;
  for (let i = 1; i < p.length; i++)
    if (t <= p[i].t) {
      const k = p[i].t > p[i - 1].t ? (t - p[i - 1].t) / (p[i].t - p[i - 1].t) : 0;
      return (p[i - 1].r + (p[i].r - p[i - 1].r) * k) * rec.D / 2;
    }
  return p[p.length - 1].r * rec.D / 2;
}

function contract(rec, tag) {
  if (!rec) { P(`${tag}: рецепт не получился`); return; }
  const p = rec.points;
  if (p.length < 3) P(`${tag}: точек ${p.length} — из двух точек формы не выйдет`);
  if (p.length > 24) P(`${tag}: точек ${p.length} — рецепт распух, его нечем править`);
  if (p[0].t !== 0) P(`${tag}: первая точка не на дне (t=${p[0].t})`);
  if (p[p.length - 1].t !== 1) P(`${tag}: последняя точка не на кромке (t=${p[p.length - 1].t})`);
  for (let i = 1; i < p.length; i++)
    if (!(p[i].t - p[i - 1].t >= 0.02 - 1e-9))
      P(`${tag}: точки ${i - 1} и ${i} ближе 0.02 по высоте — перетаскивание их слепит`);
  for (const q of p)
    if (!(q.r >= 0 && q.r <= 1)) P(`${tag}: радиус ${q.r} вне 0…1`);
  if (Math.abs(Math.max(...p.map(q => q.r)) - 1) > 1e-9)
    P(`${tag}: самая широкая точка не равна 1 — диаметр разойдётся с рисунком`);
  for (const [k, v] of [['высота', rec.H], ['диаметр', rec.D]])
    if (!(v >= MIN_MM && v <= MAX_MM)) P(`${tag}: ${k} ${v} мм вне пределов ползунков`);
}

/* 1. Силуэт узнаётся: рецепт повторяет рисунок, а не своё представление о нём. */
const rec = traceToRecipe(jug());
contract(rec, 'кувшин');
if (rec) {
  if (Math.abs(rec.H - 210) > 2) P(`кувшин: высота ${rec.H} вместо 210 мм`);
  let worst = 0, at = 0;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const want = jug()[Math.round(t * 60)].r;
    const d = Math.abs(rAt(rec, t) - want);
    if (d > worst) { worst = d; at = t; }
  }
  if (worst > 3.5) P(`кувшин: рецепт расходится с рисунком на ${worst.toFixed(1)} мм (t=${at.toFixed(2)})`);
  console.log(`  кувшин: точек ${rec.points.length}, ${rec.H}×${rec.D} мм, расхождение ${worst.toFixed(1)} мм`);
}

/* 2. Сверху вниз — тот же рецепт: рука ведёт линию как ей удобно. */
const down = traceToRecipe(jug().slice().reverse());
contract(down, 'сверху вниз');
if (rec && down && JSON.stringify(rec) !== JSON.stringify(down))
  P('линия сверху вниз даёт другой рецепт, чем снизу вверх');

/* 3. Виляние по высоте не ломает функцию r(y): точки переснимаются по высоте. */
const wobbly = jug().map((p, i) => ({...p, y: p.y + (i % 3 === 0 ? -4 : 3)}));
contract(traceToRecipe(wobbly), 'с вилянием');

/* 4. Заезд за ось: отрицательного радиуса не бывает. */
const across = jug().map(p => ({...p, r: p.r - 30}));
const rc = traceToRecipe(across);
contract(rc, 'за осью');
if (rc && rc.points.some(q => q.r < 0)) P('за осью: радиус ушёл в минус');

/* 5. Пределы: огромный рисунок ужимается целиком, пропорция цела. */
const big = traceToRecipe(jug(60, 2000, 500));
contract(big, 'огромный');
if (big) {
  if (!big.squeezed) P('огромный: рисунок обрезали молча, не сказав об этом');
  const drawn = 2000 / (2 * Math.max(...jug(60, 2000, 500).map(p => p.r)));
  const got = big.H / big.D;
  if (Math.abs(got - drawn) / drawn > 0.25)
    P(`огромный: пропорция уехала — было ${drawn.toFixed(2)}, стало ${got.toFixed(2)}`);
  console.log(`  огромный рисунок: ужат до ${big.H}×${big.D} мм`);
}

/* 6. Промах вместо линии: короткий штрих и линия по самой оси — не рецепт. */
if (traceToRecipe([{r: 20, y: 0}, {r: 21, y: 5}, {r: 22, y: 9}, {r: 23, y: 12}]))
  P('штрих в 12 мм принят за профиль');
if (traceToRecipe(jug().map(p => ({...p, r: 1}))))
  P('линия по оси принята за профиль — тела вращения из неё не выйдет');
if (traceToRecipe([{r: 10, y: 0}, {r: 20, y: 100}])) P('две точки приняты за штрих');
if (traceToRecipe(null) || traceToRecipe([])) P('пустой штрих не отбит');

/* 7. Упрощение не выкидывает крайние точки — на них держится вся высота. */
const line = Array.from({length: 20}, (_, i) => ({y: i * 10, r: 10 + i}));
const kept = simplify(line, 1.2);
if (kept[0] !== line[0] || kept[kept.length - 1] !== line[line.length - 1])
  P('упрощение потеряло концы линии');

console.log('\nПроверка нарисованной линии');
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nЛиния переводится в рецепт без потерь.');
