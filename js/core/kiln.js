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
import { sanitizePattern, patternOn, patternOutline, patternRelief } from './pattern.js';

/* Зазоры и режим печи — из настроек расчёта; умолчания те же, что в реестре. */
const gap = () => ({item: tune('gapItem'), wall: tune('gapWall'), tier: tune('gapTier')});

/** Габарит изделия после обжига: диаметр с прилепами и высота, мм.
    Крышку обжигают на изделии — она поднимает высоту садки и может быть шире
    кромки. Забыть её значит недосчитаться яруса на полке. */
export function firedSize(prof, parts, shrinkPct, lidPts, opt = {}) {
  const k = 1 - shrinkPct / 100;
  let r = 0, h = 0;
  /* Рельеф, растущий наружу (чешуя, кладка, жгут), делает вещь шире гладкого
     профиля — а по этому числу считают, влезет ли она в печь и сколько штук
     станет на полку. Считать садку «как у гладкой» значит недосчитаться
     зазора и поставить соседние изделия впритык. Берётся гребень в каждой
     точке профиля, а не средний размах: касаются друг друга именно гребни. */
  const pat = sanitizePattern(opt.pattern);
  const band = patternOn(pat) ? patternOutline(pat, prof) : null;
  prof.forEach((p, i) => {
    r = Math.max(r, p.r + (band ? Math.max(0, band[i].hi) : 0));
    h = Math.max(h, p.y);
  });
  for (const q of parts || []) r = Math.max(r, q.reach || 0);   // ручка торчит за габарит
  /* У крышки рельеф считается по её собственной высоте, и точный максимум
     по кругу здесь не нужен: для габарита берётся верхняя оценка — гребень
     стопки. Занизить габарит хуже, чем завысить: занижение ставит вещи впритык. */
  const lidHi = opt.lidPattern && patternOn(pat) ? patternRelief(pat, 100).raise : 0;
  for (const p of lidPts || []) { r = Math.max(r, p.r + lidHi); h = Math.max(h, p.y); }
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
 * Общая садка: сколько обжигов нужно на несколько разных работ вместе.
 *
 * Считать обжиги по каждой работе отдельно и складывать — значит греть печь
 * ради неполной полки. Мастерская так не делает: она ставит в одну садку
 * несколько наименований. Но и валить всё в кучу нельзя — на одну полку
 * ставят изделия близкой высоты, иначе следующая полка встаёт по самому
 * высокому и место под низкими пропадает.
 *
 * Поэтому модель полочная и ровно такая, как в мастерской:
 *   • полка отдаётся одному наименованию — сколько его влезает по площади
 *     (это уже считает kilnLoad), столько на полке и стоит;
 *   • полки складываются в обжиг, пока хватает высоты камеры и самих полок;
 *   • высота полки — по её изделию, а не по самому высокому в печи.
 *
 * Чего модель не делает: не мешает два наименования на одной полке, даже если
 * они влезли бы. Это осознанный запас в большую сторону — обещать садку плотнее
 * той, что человек соберёт руками, нечестно.
 *
 * И последнее, чего нельзя обойти: **вместе обжигают только то, что горит
 * на одну температуру**. Фаянс на 1050 и каменная масса на 1250 в одну садку
 * не идут — первый расплывётся или второй не спечётся. Поэтому работы сначала
 * разбиваются по температуре, и полки складываются внутри каждой группы.
 *
 * @param items [{d, h, n, topC}] — габарит после обжига, сколько штук, до скольки греем
 * @returns {{firings, shelves, spare, why, apart, groups}}
 */
export function mixedFirings(kiln, items) {
  const g = gap();
  const height = kiln.form === 'round' ? kiln.innerMM[1] : kiln.innerMM[2];
  const maxShelves = kiln.shelves + 1;

  /* Группы по температуре: смешивать их нельзя, считаем каждую отдельно. */
  const byTemp = new Map();
  let apart = 0;
  for (const it of items) {
    if (!(it.n > 0)) continue;
    const load = kilnLoad(kiln, it);
    if (!load.perShelf || !load.tiers)
      return {firings: null, why: load.why || 'изделие не входит в печь', apart: null, groups: []};
    const key = Math.round(+it.topC || 0);
    if (!byTemp.has(key)) byTemp.set(key, []);
    const need = Math.ceil(it.n / load.perShelf);
    const list = byTemp.get(key);
    for (let i = 0; i < need; i++) list.push({h: it.h + kiln.shelfMM + g.tier});
    apart += Math.ceil(it.n / load.total);
  }
  if (!byTemp.size) return {firings: 0, shelves: 0, spare: 0, why: '', apart: 0, groups: []};

  const groups = [];
  let firingsAll = 0, shelvesAll = 0, spareAll = 0;
  for (const [topC, shelves] of byTemp) {
    /* Полки повыше ставим первыми: так остаток обжига заполняется низкими,
       а не наоборот. Это же делает и человек, собирая садку. */
    shelves.sort((a, b) => b.h - a.h);
    let firings = 1, used = 0, count = 0, spare = 0;
    for (const sh of shelves) {
      if (count >= maxShelves || used + sh.h > height) {
        spare += height - used;
        firings++; used = 0; count = 0;
      }
      used += sh.h; count++;
    }
    spare += height - used;
    groups.push({topC, firings, shelves: shelves.length, spare});
    firingsAll += firings; shelvesAll += shelves.length; spareAll += spare;
  }
  groups.sort((a, b) => b.topC - a.topC);
  return {firings: firingsAll, shelves: shelvesAll, spare: spareAll, why: '', apart, groups};
}

/**
 * Счёт за обжиг всей партии: сколько энергии и сколько это стоит на самом деле.
 *
 * Цена обжига на изделие (`kilnEconomy`) считается при полной садке: столько
 * стоит штука, когда печь набита этим изделием. Мастерская же топит печь целиком
 * даже ради половины полки, и по её плану цена штуки другая. Оба числа честные —
 * они отвечают на разные вопросы, и панель показывает оба, а не подменяет одно
 * другим.
 *
 * @param items [{d, h, n, topC}]
 * @param opts  {priceKWh, glaze} — цена киловатт-часа и нужен ли утильный обжиг
 */
export function firingBill(kiln, items, opts = {}) {
  const mix = mixedFirings(kiln, items);
  if (!mix.firings) return {...mix, rub: null, kWh: null, perPiece: null, pieces: 0};
  const pieces = items.reduce((s, it) => s + (+it.n > 0 ? it.n : 0), 0);
  let rub = 0, kWh = 0;
  for (const gr of mix.groups) {
    const c = firingCost(kiln, {topC: gr.topC || 1050, glaze: !!opts.glaze,
                                priceKWh: opts.priceKWh || 6});
    rub += c.rub * gr.firings;
    kWh += c.kWh * gr.firings;
  }
  return {...mix, rub, kWh, pieces, perPiece: pieces ? rub / pieces : null};
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
