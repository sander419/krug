// file: js/core/kiln.js
// Садка и цена обжига.
//
// Печь берёт киловатты за цикл, а не за штуку: поставить в неё три чашки или
// двенадцать — разница в себестоимости вчетверо. Поэтому цена обжига на изделие
// это не прайс, а геометрия — сколько влезает на полку и сколько полок войдёт
// по высоте.
//
// Раскладка считается рядами, как ставят руками: квадратной сеткой и сеткой
// со сдвигом через ряд, берётся та, где помещается больше. Это не оптимальная
// упаковка кругов — оптимальную никто и не выкладывает у горячей печи.

import { tune } from './tuning.js';

/* Зазоры и режим печи — из настроек расчёта; умолчания те же, что в реестре. */
const gap = () => ({item: tune('gapItem'), wall: tune('gapWall'), tier: tune('gapTier')});

/** Габарит изделия после обжига: диаметр с прилепами и высота, мм.
    Крышку обжигают на изделии — она поднимает высоту садки и может быть шире
    кромки. Забыть её значит недосчитаться яруса на полке. */
export function firedSize(prof, parts, shrinkPct, lidPts) {
  const k = 1 - shrinkPct / 100;
  let r = 0, h = 0;
  for (const p of prof) { r = Math.max(r, p.r); h = Math.max(h, p.y); }
  for (const q of parts || []) r = Math.max(r, q.reach || 0);   // ручка торчит за габарит
  for (const p of lidPts || []) { r = Math.max(r, p.r); h = Math.max(h, p.y); }
  return {d: 2 * r * k, h: h * k};
}

/* Сколько кругов диаметра d влезает в круг диаметра D.
   Сетку двигаем: ряд по центру и ряд со сдвигом на полшага дают разное число,
   и разница не мелочь — на кружках это два изделия из четырёх. Перебираем
   восемь раскладок (сдвиг по обеим осям × ряды вразбежку) и берём лучшую:
   так же поступает человек, переставляя первый ряд туда-сюда. */
function inCircle(D, d) {
  const R = D / 2, r = d / 2;
  if (d > D) return {n: 0, pts: []};
  const grid = (offX, offY, stagger) => {
    const pts = [];
    const stepY = stagger ? d * Math.sqrt(3) / 2 : d;
    const rows = Math.ceil(D / stepY) + 2, cols = Math.ceil(D / d) + 2;
    for (let j = -rows; j <= rows; j++) {
      const y = j * stepY + offY * stepY / 2;
      const dx = (stagger && (j & 1) ? d / 2 : 0) + offX * d / 2;
      for (let i = -cols; i <= cols; i++) {
        const x = i * d + dx;
        if (Math.hypot(x, y) <= R - r + 1e-6) pts.push({x, y});
      }
    }
    return pts;
  };
  let best = [];
  for (const stagger of [false, true])
    for (const offX of [0, 1])
      for (const offY of [0, 1]) {
        const pts = grid(offX, offY, stagger);
        if (pts.length > best.length) best = pts;
      }
  return {n: best.length, pts: best};
}

/* Прямоугольная полка: обычная сетка, ряды и столбцы. */
function inBox(W, H, d) {
  const cols = Math.floor(W / d), rows = Math.floor(H / d);
  const pts = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      pts.push({x: -W / 2 + d / 2 + i * d, y: -H / 2 + d / 2 + j * d});
  return {n: pts.length, pts};
}

/**
 * Садка: сколько изделий войдёт в печь за один обжиг.
 * @returns {{perShelf:number, tiers:number, total:number, pts:Array, shelf:{form:string,w:number,h:number}, why:string}}
 */
export function kilnLoad(kiln, item) {
  const g = gap();
  const step = item.d + g.item;                          // пятно изделия с зазором
  const tierH = item.h + kiln.shelfMM + g.tier;
  const [a, b, c] = kiln.innerMM;

  let fit, shelf;
  if (kiln.form === 'round') {
    const D = a - 2 * g.wall;
    fit = inCircle(D, step);
    shelf = {form: 'round', w: D, h: D};
  } else {
    const W = a - 2 * g.wall, Dp = b - 2 * g.wall;
    fit = inBox(W, Dp, step);
    shelf = {form: 'box', w: W, h: Dp};
  }
  const height = kiln.form === 'round' ? b : c;
  const tiers = Math.max(0, Math.min(kiln.shelves + 1, Math.floor(height / tierH)));

  let why = '';
  if (!fit.n) why = 'изделие шире камеры';
  else if (!tiers) why = 'изделие выше камеры';

  return {perShelf: fit.n, tiers, total: fit.n * tiers, pts: fit.pts, step, shelf, why};
}

/**
 * Цена обжига. Энергия считается как мощность × время × доля под нагрузкой:
 * печь греет ступенями и держит выдержку, а не жрёт паспортные киловатты
 * все часы подряд. Доля грубая и помечена как оценка — точную даёт счётчик.
 */
export function firingCost(kiln, {topC, glaze, rampCH = 150, soakMin = 20, priceKWh = 6}) {
  const cycle = t => (t / Math.max(rampCH, 20)) + soakMin / 60;   // ч: подъём и выдержка
  const runs = glaze
    ? [{name: 'утильный', c: tune('bisqueC')}, {name: 'политой', c: topC}]
    : [{name: 'единственный', c: topC}];
  let hours = 0, kWh = 0;
  for (const r of runs) {
    const h = cycle(r.c);
    hours += h;
    kWh += kiln.powerKW * h * tune('duty');
  }
  return {runs: runs.length, hours, kWh, rub: kWh * priceKWh, names: runs.map(r => r.name)};
}

/** Всё вместе: садка, энергия и цена на изделие. */
export function kilnEconomy(kiln, item, opts) {
  const load = kilnLoad(kiln, item);
  const cost = firingCost(kiln, opts);
  const per = load.total ? cost.rub / load.total : null;
  return {load, cost, perItem: per};
}
