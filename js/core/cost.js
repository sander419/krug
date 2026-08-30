// file: js/core/cost.js
// Во сколько обходится одно изделие — и почём его тогда продавать.
//
// Это не бухгалтерия. Мастеру нужен один ответ: «глина, глазурь, обжиг, работа —
// итого столько; продавать дешевле такой-то цены нельзя». Экономика тиража
// (js/core/economics.js) отвечает на другой вопрос — «оснастка или руки, и с
// какого тиража», — и остаётся там, где была.
//
// Правило то же, что и во всех реестрах: чего мы не знаем, то помечено.
// Цена массы берётся из паспорта поставщика, если он её публикует; цена глазури,
// ставка мастера и минуты на изделие — числа мастерской, инструмент их не знает
// и подставляет ориентир с пометкой «оценка», а не выдаёт за факт.
import { byId as materialById } from '../config/materials.js';
import { tune } from './tuning.js';

export const COST_DEFAULTS = {
  minPerPiece: 20,        // минут ручной работы на изделие (формовка + подрезка + сборка)
  hourRate: 700,          // ₽/ч мастера с накладными
  glazeRubPerKg: 1200,    // ₽/кг сухой глазурной смеси — ориентир розницы, не паспорт
  otherPct: 12,           // упаковка, расходники, электричество помимо печи
  lossPct: 10,            // брак: трещины, сколы, непрокрас
  marginPct: 100,         // наценка к себестоимости для минимальной цены
  toolingRub: 0,          // оснастка на серию (гипс, время на форму)
  toolingPieces: 50,      // на сколько изделий она рассчитана
  n: 50,                  // тираж: сколько изделий делаем
};

/** Что из чисел — ориентир, а не паспорт. Панель обязана это показывать. */
export const COST_ESTIMATED = ['glazeRubPerKg', 'minPerPiece', 'hourRate', 'otherPct', 'lossPct'];

const clampNum = (v, lo, hi, def) => {
  const n = +v;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

export const COST_LIMITS = {
  minPerPiece: [1, 600], hourRate: [0, 20000], glazeRubPerKg: [0, 20000],
  otherPct: [0, 200], lossPct: [0, 80], marginPct: [0, 2000],
  toolingRub: [0, 10000000], toolingPieces: [1, 1000000], n: [1, 1000000],
};

export function sanitizeCost(raw) {
  const o = {...COST_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {})};
  for (const [k, [lo, hi]] of Object.entries(COST_LIMITS))
    o[k] = clampNum(o[k], lo, hi, COST_DEFAULTS[k]);
  return o;
}

/**
 * Поверхность изделия под глазурь, см².
 * Тело вращения: площадь боковой поверхности это 2π·∫r·ds. Считаем наружную
 * целиком и внутреннюю выше дна — так изделие и поливают. Дно снизу не
 * глазуруют (иначе прикипит к полке), поэтому его в счёт не берём.
 */
export function glazedAreaCm2(prof, wallMM, hollow) {
  const side = pts => {
    let a = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      a += Math.PI * (p.r + q.r) * Math.hypot(q.r - p.r, q.y - p.y);
    }
    return a;                                   // мм²
  };
  const outer = side(prof);
  const inner = hollow
    ? side(prof.map(p => ({r: Math.max(p.r - wallMM, 0), y: p.y})).filter(p => p.r > 0))
    : 0;
  return (outer + inner) / 100;                 // мм² → см²
}

/**
 * Себестоимость одного изделия.
 * @param prod  результат computeProduction: массы в граммах
 * @param opt   {...COST_DEFAULTS, firePerPiece} — числа мастерской
 * @returns строки сметы, итог, минимальная цена и что из этого оценка
 */
export function pieceCost(state, prod, prof, opt = {}) {
  const o = sanitizeCost(opt);
  const mat = materialById(state.mat);
  const est = [];

  /* Глина: платят за сырьё, а не за черепок — считаем по массе с припуском
     на подрезку (massN), а не по готовому изделию. */
  const clayKg = prod.massN / 1000;
  const clayPerKg = mat.priceRub && mat.packKg ? mat.priceRub / mat.packKg : null;
  if (clayPerKg == null) est.push('цена массы: поставщик не публикует');
  const clayRub = clayPerKg == null ? null : clayKg * clayPerKg;

  /* Глазурь: площадь под поливку на расход сухой смеси. Расход — порог
     инструмента (js/config/tuning.js), цена — число мастерской. */
  const areaCm2 = glazedAreaCm2(prof, state.wall, state.hollow);
  const glazeKg = areaCm2 * tune('glazeGperCm2') / 1000;
  const glazeRub = o.glazeRubPerKg > 0 ? glazeKg * o.glazeRubPerKg : null;
  if (glazeRub != null) est.push('расход и цена глазури: оценка');

  /* Обжиг: ₽ на изделие приходит из садки печи — сколько влезло, столько
     и делит киловатт-часы. Печь не выбрана или изделие не влезло — пусто. */
  const fireRub = opt.firePerPiece > 0 ? opt.firePerPiece : null;
  if (fireRub == null) est.push('обжиг: изделие не входит в выбранную печь или печь не задана');

  const labourRub = (o.minPerPiece / 60) * o.hourRate;
  const toolingRub = o.toolingRub > 0 ? o.toolingRub / Math.max(1, o.toolingPieces) : 0;

  const direct = (clayRub || 0) + (glazeRub || 0) + (fireRub || 0) + labourRub + toolingRub;
  const otherRub = direct * o.otherPct / 100;
  /* Брак ложится на цену уцелевших: из десяти обожжённых продаются девять,
     и десятое оплачивают те девять. Поэтому делим, а не прибавляем процент. */
  const beforeLoss = direct + otherRub;
  const total = beforeLoss / Math.max(0.2, 1 - o.lossPct / 100);
  const lossRub = total - beforeLoss;

  const minPrice = total * (1 + o.marginPct / 100);
  return {
    clayKg, clayPerKg, clayRub,
    areaCm2, glazeKg, glazeRub,
    fireRub, labourRub, toolingRub, otherRub, lossRub,
    total, minPrice, marginRub: minPrice - total,
    complete: clayRub != null && fireRub != null,   // всё ли посчитано по факту
    est, input: o,
  };
}

/**
 * Тираж: «хочу сделать N изделий».
 * Ничего нового не считает — раскладывает штуку на партию и добавляет то,
 * что имеет смысл только на партии: сколько обжигов и сколько форм.
 * @param per   результат pieceCost
 * @param opt   {n, perFiring, mouldLifePieces}
 */
export function batchPlan(per, opt = {}) {
  const n = Math.max(1, Math.round(+opt.n || 1));
  const perFiring = +opt.perFiring > 0 ? Math.floor(opt.perFiring) : null;
  const life = +opt.mouldLifePieces > 0 ? opt.mouldLifePieces : null;
  return {
    n,
    clayKg: per.clayKg * n,
    glazeKg: per.glazeKg * n,
    firings: perFiring ? Math.ceil(n / perFiring) : null,
    perFiring,
    moulds: life ? Math.ceil(n / life) : null,
    mouldLifePieces: life,
    total: per.total * n,
    perPiece: per.total,
    revenue: per.minPrice * n,
    margin: (per.minPrice - per.total) * n,
  };
}
