// file: js/core/trace.js
// Линия, проведённая от руки, → рецепт из точек.
//
// Тянуть точки по одной удобно, когда форма почти готова, и мучительно, когда
// её ещё нет: силуэт в голове рисуется одним движением, а не восемью. Штрих
// переводится в тот же рецепт, что рисуют точками, — дальше его правят как
// обычно. Ничего нового в модель это не добавляет: линия лишь другой способ
// ввода, и ниже — вся разница между рукой и рецептом.
//
// Здесь чистая математика в миллиметрах: ни канвы, ни событий. Поэтому её
// можно проверить из командной строки — tools/check-trace.mjs.
import { clamp, round } from './util.js';

export const MIN_MM = 50, MAX_MM = 400;   // пределы высоты и диаметра, как у ползунков
const MIN_H = 20;                          // короче 2 см — это промах, а не профиль
const MIN_R = 5;                           // линия легла на ось: тела вращения не выйдет
const SAMPLES = 64;                        // переснимаем штрих равномерно по высоте
const MIN_GAP = 0.02;                      // зазор между точками, как ждёт перетаскивание
const MAX_PTS = 24;

/**
 * Рамер—Дуглас—Пекер: оставить точки, без которых силуэт заметно изменится.
 * Иначе рецепт распухает до шестидесяти точек и его нечем править.
 */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.r - a.r, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  let far = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].r - a.r) * dy - (pts[i].y - a.y) * dx) / len;
    if (d > dmax) { dmax = d; far = i; }
  }
  if (dmax <= tol) return [a, b];
  return simplify(pts.slice(0, far + 1), tol).slice(0, -1).concat(simplify(pts.slice(far), tol));
}

/**
 * Штрих в миллиметрах — в рецепт.
 * @param {{r:number,y:number}[]} mm точки штриха, в любом порядке
 * @returns {null|{points:{t:number,r:number}[], H:number, D:number, squeezed:boolean}}
 */
export function traceToRecipe(mm) {
  if (!mm || mm.length < 4) return null;

  /* Профиль — функция радиуса от высоты: на одной высоте одна точка. Рука
     такой гарантии не даёт (виляет, заворачивает назад), да и вести линию
     можно сверху вниз. Поэтому сортируем по высоте и переснимаем равномерно. */
  const src = mm.map(p => ({r: Math.max(0, p.r), y: p.y})).sort((a, b) => a.y - b.y);
  const y0 = src[0].y, H0 = src[src.length - 1].y - y0;
  if (!(H0 >= MIN_H)) return null;

  const samp = [];
  let j = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const y = y0 + H0 * i / SAMPLES;
    while (j < src.length - 2 && src[j + 1].y < y) j++;
    const a = src[j], b = src[j + 1] || src[j];
    const k = b.y > a.y ? (y - a.y) / (b.y - a.y) : 0;
    samp.push({y: y - y0, r: a.r + (b.r - a.r) * k});
  }

  let tol = 1.2, keep = simplify(samp, tol);
  while (keep.length > MAX_PTS && tol < 10) { tol *= 1.6; keep = simplify(samp, tol); }
  const rMax = Math.max(...keep.map(p => p.r));
  if (!(rMax >= MIN_R)) return null;

  /* Рисунок вне пределов ужимаем целиком, чтобы пропорция уцелела. Когда
     высота и диаметр тянут в разные стороны (пределы различаются в восемь раз),
     пропорцию сохранить нечем — тогда режем по каждому и говорим об этом. */
  const s = Math.min(1, MAX_MM / H0, MAX_MM / (rMax * 2))
          * Math.max(1, MIN_MM / H0, MIN_MM / (rMax * 2));
  const H = clamp(Math.round(H0 * s), MIN_MM, MAX_MM);
  const D = clamp(Math.round(rMax * 2 * s), MIN_MM, MAX_MM);

  const points = [];
  for (const p of keep) {
    const t = round(clamp(p.y / H0, 0, 1));
    if (points.length && t - points[points.length - 1].t < MIN_GAP) continue;
    points.push({t: round(t), r: round(clamp(p.r / rMax, 0, 1))});
  }
  if (points.length < 3) return null;
  points[0].t = 0;
  points[points.length - 1].t = 1;

  return {points, H, D, squeezed: Math.abs(s - 1) > 1e-3};
}
