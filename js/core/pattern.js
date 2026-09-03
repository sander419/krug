// file: js/core/pattern.js
// Узор на стенке: рельеф, который печатает машина и не вытянуть руками.
//
// На круге стенка получается гладким телом вращения — руки не умеют иначе.
// Машина умеет: сопло ходит по спирали, и если радиус чуть менять по углу
// и по высоте, из той же вазы выходит каннелюра, витой жгут, плетёнка, кладка
// или кора. Это не украшение поверх модели, а сама форма: тот же рельеф уезжает
// в STL и в G-code, иначе картинка на экране врала бы про напечатанное.
//
// Второе, ради чего это затевалось: **тонкая стенка светится**. Рельеф снаружи
// при гладкой стенке изнутри делает толщину переменной, и фарфоровая ваза на
// просвет показывает узор — тот же приём, что в литофании.
//
// ## Узор — стопка слоёв
//
// Один узор на всю вещь — это ровно то, что умеет и рука с гребёнкой: одна
// борозда, повторённая по кругу. Печать умеет больше, и умеет ровно потому,
// что радиус на каждом шаге спирали задаётся числом, а числа складываются.
// Поэтому узор здесь — **стопка слоёв**, а смещения слоёв суммируются:
//
//     d(θ, y) = Σ dᵢ(θ, y)
//
// Сумма — единственное честное смешивание для рельефа: сопло кладёт бусину
// на радиус, а не «накладывает текстуру с прозрачностью». Каннелюры на всю
// высоту плюс пояс чешуи посередине плюс кольца сверху — это три слоя, и
// машина исполнит их буквально так же, как показано на экране.
//
// У каждого слоя своё:
//   • форма рельефа (`id`) и её повторы по кругу (`n`) и по высоте (`m`);
//   • глубина в миллиметрах (`depth`) и закрутка по высоте (`twist`);
//   • **сдвиг по кругу** (`phase`) — чтобы совместить слои между собой
//     и увести гребень от ручки;
//   • **пояс по высоте** (`from`…`to` в долях высоты) с мягкостью края
//     (`edge`) — узор не обязан идти от дна до кромки.
//
// Границы честности:
//   • узор ложится только на **внешнюю** стенку; полость остаётся гладкой,
//     иначе изделие нечем мыть, а вместимость пришлось бы считать заново;
//   • у дна и у кромки узор гасится поверх всех поясов: на посадочном пояске
//     рельеф мешает стоять, на кромке — пить;
//   • масса, сечение и замечания считаются по **настоящей** сумме слоёв,
//     а не по глубине самого глубокого: два слоя в одном поясе режут стенку
//     вместе, и узнать это арифметикой по одному слою нельзя.

import { clamp } from './util.js';
import { reliefCoat } from './glazeCoat.js';

const TAU = Math.PI * 2;
const frac = x => x - Math.floor(x);

/* Треугольная волна: даёт грани вместо синусоидальных валиков. */
const tri = x => 2 * Math.abs(2 * (x / TAU - Math.floor(x / TAU + 0.5))) - 1;
/* Узкий гребень в долях периода: 1 на гребне, 0 между. */
const ridge = (x, w) => {
  const u = frac(x / TAU) - 0.5;
  return Math.exp(-(u * u) / (2 * w * w));
};
const sstep = t => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
/* Площадка со сглаженным краем: 1 посреди клетки, 0 на её границе. Так
   печатают накладной рельеф — сопло кладёт пятно, а не синусоиду. */
const pad = (x, e = 0.18) => { const u = frac(x); return sstep(u / e) * sstep((1 - u) / e); };

/* Шум по клеткам. Детерминированный: одна и та же ваза, напечатанная дважды,
   обязана выйти одинаковой, поэтому Math.random здесь не годится. */
const cellRnd = (i, j) => {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
/* Билинейный шум с обязательным швом: клетка n совпадает с клеткой 0,
   иначе на стыке первого и последнего сегмента видна вертикальная полоса. */
function noise(x, y, nx) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = sstep(x - i), fy = sstep(y - j);
  const w = k => ((k % nx) + nx) % nx;
  const a = cellRnd(w(i), j), b = cellRnd(w(i + 1), j);
  const c = cellRnd(w(i), j + 1), d = cellRnd(w(i + 1), j + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/**
 * Реестр форм рельефа. `f(a)` — форма в долях глубины (±1), где
 * `a.th` — угол с уже учтёнными закруткой и сдвигом, `a.n` — повторов
 * по кругу, `a.v` — доля высоты 0…1, `a.m` — повторов по высоте.
 *
 * `outward: true` — рельеф лежит **поверх** стенки и её не режет.
 * `thin: true` — тонкая стенка и есть цель (просвет), пороги мягче.
 */
export const PATTERNS = [
  {id: 'flute', name: 'Каннелюры', what: 'вертикальные валики и ложбины, как на колонне',
   uses: ['n', 'depth', 'twist'],
   f: a => Math.cos(a.th * a.n)},

  {id: 'facet', name: 'Грани', what: 'плоские грани вместо круга — свет ломается рёбрами',
   uses: ['n', 'depth', 'twist'],
   f: a => tri(a.th * a.n)},

  {id: 'star', name: 'Звезда', what: 'острые лучи: узкая ложбина, широкий гребень',
   uses: ['n', 'depth', 'twist'],
   /* Резкость даёт степень: |cos|³ прижимает ложбину в узкую щель, которую
      руки не вытянут, а сопло проходит одним движением. */
   f: a => 2 * Math.pow(Math.abs(Math.cos(a.th * a.n / 2)), 3) - 1},

  {id: 'wave', name: 'Кольца', what: 'горизонтальные волны по всей высоте',
   uses: ['depth', 'm'],
   f: a => Math.sin(a.v * TAU * a.m)},

  {id: 'weave', name: 'Плетёнка', what: 'ромбическая сетка: два встречных семейства борозд',
   uses: ['n', 'depth', 'm', 'twist'],
   f: a => Math.sin(a.th * a.n) * Math.cos(a.v * TAU * a.m)},

  {id: 'chevron', name: 'Ёлочка', what: 'борозды идут зигзагом: вверх-вправо, вверх-влево',
   uses: ['n', 'depth', 'm', 'twist'],
   /* Гребень не прямой и не винтовой, а ломаный: угол наклона меняет знак
      m раз по высоте. Рукой такое не протянуть — гребёнка ведёт прямо. */
   f: a => Math.cos(a.n * (a.th + 0.6 * tri(a.v * TAU * a.m)))},

  {id: 'bump', name: 'Чешуя', outward: true, what: 'бугорки рядами — держатся в руке и играют на свету',
   uses: ['n', 'depth', 'm', 'twist'],
   /* Бугорки растут наружу от гладкой стенки, а не «вся стенка вдавлена, кроме
      бугорков»: иначе глубина 2 мм срезала бы со всей вазы четверть объёма. */
   f: a => Math.max(0, Math.sin(a.th * a.n) * Math.sin(a.v * TAU * a.m))},

  {id: 'brick', name: 'Кладка', outward: true, what: 'прямоугольные площадки рядами вразбежку',
   uses: ['n', 'depth', 'm', 'twist'],
   /* Ряды сдвинуты на полкамня — как кладут кирпич. Резкий край площадки
      это и есть примета печати: сопло делает ступеньку, рука — валик. */
   f: a => {
     const row = Math.floor(a.v * a.m);
     const x = a.th / TAU * a.n + (row % 2 ? 0.5 : 0);
     return pad(x) * pad(a.v * a.m);
   }},

  {id: 'dimple', name: 'Лунки', what: 'вдавленные ямки рядами — рельеф внутрь, стенка целая между ними',
   uses: ['n', 'depth', 'm', 'twist'],
   f: a => -Math.pow(Math.max(0, Math.sin(a.th * a.n) * Math.sin(a.v * TAU * a.m)), 1.5)},

  {id: 'bark', name: 'Кора', what: 'неровная поверхность без повторов — шум, а не орнамент',
   uses: ['n', 'depth', 'm', 'twist'],
   /* Шум одинаков при каждой печати, но не повторяется по кругу: глазу
      не за что зацепиться, и вещь выглядит не машинной, а природной. */
   f: a => clamp(2.4 * (noise(a.th / TAU * a.n, a.v * a.m, Math.max(1, Math.round(a.n))) - 0.5), -1, 1)},

  {id: 'spiral', name: 'Спиральное ребро', outward: true, what: 'один жгут, идущий по спирали снизу вверх',
   uses: ['n', 'depth', 'twist'],
   /* Жгут налеплен поверх стенки — так его и делают руками, и печатают. */
   f: a => ridge(a.th * a.n, 0.12)},

  {id: 'window', name: 'Окна на просвет', what: 'вырезы почти на всю стенку: тонкое дно окна светится',
   thin: true, uses: ['n', 'depth', 'm', 'twist'],
   /* Окно — не дыра, а ложбина почти на всю стенку. Сквозное отверстие сгубило
      бы и вещь (воду не нальёшь), и печать: LDM кладёт бусину непрерывно
      и разрыв слоя заканчивается обрывом жгута. Тонкое дно окна на просвет
      светится — тот же приём, что в литофании. */
   f: a => {
     const g = Math.sin(a.th * a.n) * Math.sin(a.v * TAU * a.m);
     const t = clamp((g - 0.35) / 0.25, 0, 1);
     return -(t * t * (3 - 2 * t));
   }},
];

export const patternById = id => PATTERNS.find(p => p.id === id) || null;

export const MAX_LAYERS = 4;

export const LIMITS = {
  n: [3, 64], depth: [0, 14], twist: [-720, 720], m: [1, 40],
  phase: [0, 355], from: [0, 0.95], to: [0.05, 1], edge: [0.01, 0.4],
};

/** Умолчания слоя. Ими же заполняются недостающие поля старых записей. */
export const LAYER_DEFAULTS = {
  id: 'flute', n: 12, depth: 2, twist: 0, m: 8, phase: 0, from: 0, to: 1, edge: 0.08,
  /* Выключенный слой остаётся в стопке со всеми своими числами, но в рельеф
     не входит. Иначе сравнить «с ним и без» можно было бы только выставив
     глубину в ноль и потом вспоминая, какая она была. */
  mute: false,
};

/* Короткие имена полей для ДНК: рецепт уезжает ссылкой, и четыре слоя
   полными именами раздували бы её вдвое. */
const SHORT = {id: 'i', n: 'n', m: 'm', depth: 'd', twist: 't', phase: 'p', from: 'a', to: 'b',
               edge: 'e', mute: 'x'};

/* Запись узора считается неизменяемой: её заменяют целиком, а не правят
   по месту. Метка «уже очищено» скрыта за символом — в JSON, в ДНК и в отмену
   она не попадает, а горячий цикл не пересобирает стопку на каждый вызов. */
const READY = Symbol('pattern');

const numIn = (v, key, def) => {
  const n = +v;
  return Number.isFinite(n) ? clamp(n, LIMITS[key][0], LIMITS[key][1]) : def;
};

/** Привести один слой к схеме. `null`, если формы рельефа такой нет. */
export function sanitizeLayer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  /* Слой из ДНК приходит короткими именами; из состояния — полными. */
  const src = raw.i !== undefined
    ? {id: raw.i, n: raw.n, m: raw.m, depth: raw.d, twist: raw.t,
       phase: raw.p, from: raw.a, to: raw.b, edge: raw.e, mute: raw.x}
    : raw;
  const p = patternById(src.id);
  if (!p) return null;                       // «нет такого узора» значит «узора нет»
  const D = LAYER_DEFAULTS;
  const from = numIn(src.from, 'from', D.from);
  /* Пояс не может быть короче мягкости своих краёв: иначе слой гасит сам себя
     и человек крутит ползунок, не видя рельефа. */
  const to = Math.max(numIn(src.to, 'to', D.to), from + 0.05);
  return {
    id: p.id,
    n: Math.round(numIn(src.n, 'n', D.n)),
    depth: numIn(src.depth, 'depth', D.depth),
    twist: numIn(src.twist, 'twist', D.twist),
    m: Math.round(numIn(src.m, 'm', D.m)),
    phase: numIn(src.phase, 'phase', D.phase),
    from, to: Math.min(to, 1),
    edge: numIn(src.edge, 'edge', D.edge),
    mute: !!src.mute,
  };
}

/**
 * Привести запись узора к схеме `{layers: [...]}`.
 *
 * Принимает и старую плоскую запись `{id, n, depth, twist, m}` — она же
 * лежит во всех ссылках, выпущенных до слоёв, и обязана открываться тем же
 * узором, а не «примерно похожим».
 */
export function sanitizePattern(raw) {
  if (raw && raw[READY]) return raw;
  const src = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(src) ? src
    : Array.isArray(src.layers) ? src.layers
    : Array.isArray(src.L) ? src.L
    : src.id !== undefined ? [src]                     // старая запись: один слой
    : [];
  const layers = [];
  for (const raw of list) {
    const l = sanitizeLayer(raw);
    if (l) layers.push(l);
    if (layers.length >= MAX_LAYERS) break;
  }
  const out = {layers};
  Object.defineProperty(out, READY, {value: true, enumerable: false});
  return out;
}

/** Запись для ДНК: короткие имена, умолчания опущены. */
export function packPattern(pat) {
  const p = sanitizePattern(pat);
  if (!p.layers.length) return null;
  return {L: p.layers.map(l => {
    const o = {};
    for (const k of Object.keys(LAYER_DEFAULTS)) {
      const v = k === 'depth' ? Math.round(l[k] * 100) / 100 : l[k];
      if (v !== LAYER_DEFAULTS[k] || k === 'id') o[SHORT[k]] = v;
    }
    return o;
  })};
}

export const patternLayers = pat => sanitizePattern(pat).layers;

export const layerOn = l => !!(l && l.depth > 0.01 && !l.mute);
export const patternOn = pat => patternLayers(pat).some(layerOn);

/** Есть ли в стопке слой, который лепится наружу и стенку не режет. */
export const layerOutward = l => !!(patternById(l.id) || {}).outward;

/* Затухание у дна и у кромки — общее для всей стопки. Рельеф на посадочном
   пояске мешает стоять, на кромке — пить и держать крышку. Зона гашения —
   доля высоты, но не меньше пары миллиметров: на низкой вещи иначе гасится всё. */
function fade(y, H) {
  const z = Math.max(3, H * 0.06);
  return Math.min(1, clamp(y / z, 0, 1) * clamp((H - y) / z, 0, 1));
}

/* Пояс слоя по высоте. Слой на всю высоту не гасится вовсе: иначе стопка из
   одного слоя вела бы себя не так, как тот же узор до появления слоёв. */
function band(l, v) {
  if (l.from <= 0 && l.to >= 1) return 1;
  const e = Math.max(l.edge, 1e-4);
  return clamp((v - l.from) / e, 0, 1) * clamp((l.to - v) / e, 0, 1);
}

/**
 * Смещение радиуса в миллиметрах — сумма всех слоёв.
 * @param pat очищенная запись узора
 * @param th угол, радианы
 * @param y высота, мм
 * @param H полная высота, мм
 */
export function patternOffset(pat, th, y, H) {
  const layers = patternLayers(pat);
  if (!layers.length) return 0;
  const v = H > 0 ? clamp(y / H, 0, 1) : 0;
  const g = fade(y, H);
  if (!g) return 0;
  let sum = 0;
  const a = {th: 0, n: 0, v, m: 0};
  for (const l of layers) {
    if (!layerOn(l)) continue;
    const b = band(l, v);
    if (!b) continue;
    /* Закрутка задаётся в градусах на всю высоту: так число понятно мастеру
       («ваза повёрнута на пол-оборота»), а не в радианах на миллиметр. */
    a.th = th + (l.phase + l.twist * v) * Math.PI / 180;
    a.n = l.n; a.m = l.m;
    sum += patternById(l.id).f(a) * l.depth * b;
  }
  return sum * g;
}

/**
 * Поправка объёма от рельефа, см³. Считается численно по сетке: у синусоид
 * средний радиус не меняется, но объём — меняется, потому что в объём радиус
 * входит квадратом. «Как у гладкой» здесь было бы враньём на несколько
 * процентов массы.
 *
 * @param out профиль изделия [{r, y}] снизу вверх
 */
export function patternVolumeMl(pat, out) {
  if (!patternOn(pat) || !out || out.length < 2) return 0;
  const p = sanitizePattern(pat);
  const H = out[out.length - 1].y;
  const NA = 96;                                   // шагов по кругу
  let sum = 0;
  for (let i = 1; i < out.length; i++) {
    const dy = out[i].y - out[i - 1].y;
    if (dy <= 0) continue;
    const y = (out[i].y + out[i - 1].y) / 2;
    const r = (out[i].r + out[i - 1].r) / 2;
    let ring = 0;
    for (let k = 0; k < NA; k++) {
      const th = k / NA * TAU;
      const d = patternOffset(p, th, y, H);
      ring += ((r + d) * (r + d) - r * r) / 2;
    }
    sum += ring * (TAU / NA) * dy;
  }
  return sum / 1000;                               // мм³ → см³
}

/**
 * Готовая функция рельефа для горячего цикла.
 *
 * `patternOffset` удобен снаружи, но внутри он на каждый вызов ищет узоры
 * в реестре и пересчитывает пояса. При сборке тела вращения таких вызовов
 * четырнадцать тысяч на кадр, и в «Кинотеатре» это заметно. Здесь всё, что
 * не зависит от точки, вычисляется один раз.
 *
 * @returns null, если узора нет; иначе (th, v, fadeVal) → смещение в мм,
 *          где `v` — доля высоты, `fadeVal` — уже посчитанное гашение.
 */
export function patternFn(pat) {
  const layers = patternLayers(pat).filter(layerOn);
  if (!layers.length) return null;
  const pre = layers.map(l => ({
    f: patternById(l.id).f, depth: l.depth, n: l.n, m: l.m,
    ph: l.phase * Math.PI / 180, tw: l.twist * Math.PI / 180,
    full: l.from <= 0 && l.to >= 1, from: l.from, to: l.to,
    e: Math.max(l.edge, 1e-4),
    a: {th: 0, n: l.n, v: 0, m: l.m},
  }));
  return (th, v, fadeVal) => {
    let sum = 0;
    for (const p of pre) {
      const b = p.full ? 1
        : clamp((v - p.from) / p.e, 0, 1) * clamp((p.to - v) / p.e, 0, 1);
      if (!b) continue;
      p.a.th = th + p.ph + p.tw * v;
      p.a.v = v;
      sum += p.f(p.a) * p.depth * b;
    }
    return sum * fadeVal;
  };
}

/** Гашение у дна и кромки как отдельная функция: её считают по точкам контура. */
export const patternFade = (y, H) => fade(y, H);

/**
 * Границы, между которыми гуляет стенка на этой высоте, мм: {lo, hi}.
 * Чертежу нужны не сами борозды (сечение проходит по одной точке круга),
 * а огибающие. Границы несимметричны: чешуя и кладка растут только наружу,
 * лунки и окна — только внутрь, и рисовать их зеркально значило бы врать.
 */
export function patternBand(pat, y, H) {
  const p = sanitizePattern(pat);
  if (!patternOn(p)) return {lo: 0, hi: 0};
  let lo = 0, hi = 0;
  for (let k = 0; k < 96; k++) {
    const d = patternOffset(p, k / 96 * TAU, y, H);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return {lo, hi};
}

/** Насколько рельеф вообще уходит от гладкой стенки на этой высоте, мм. */
export function patternAmp(pat, y, H) {
  const {lo, hi} = patternBand(pat, y, H);
  return Math.max(Math.abs(lo), hi);
}

/**
 * Самое глубокое и самое высокое место рельефа на всей вещи, мм:
 * `{carve, raise}` — сколько срезано в ложбине и сколько налеплено на гребне.
 *
 * Считается перебором, а не арифметикой по слоям: два слоя в одном поясе
 * режут стенку вместе, а в разных — порознь, и узнать это иначе нельзя.
 * По этому числу говорится «в ложбине останется столько-то стенки».
 */
const reliefMemo = new WeakMap();
export function patternRelief(pat, H = 220) {
  const p = sanitizePattern(pat);
  if (!patternOn(p)) return {carve: 0, raise: 0};
  /* Перебор стоит миллисекунды, а спрашивают его несколько раз за пересчёт:
     панель, замечания, техкарта. Запись узора неизменяемая, поэтому ответ
     кэшируется прямо по ней — правка узора создаёт новую запись, и кэш
     промахивается сам.

     Высот при этом несколько: у корпуса своя, у крышки своя, и спрашивают их
     вперемешку. Кэш на одну высоту в такой очереди не попадает ни разу —
     замерено 7,2 мс на пару вместо 0,3. Поэтому здесь маленькая таблица
     по высотам, а не одно значение. */
  let by = reliefMemo.get(p);
  const key = Math.round(H * 10) / 10;
  if (by && by.has(key)) return by.get(key);
  let carve = 0, raise = 0;
  /* Сетка берётся по самому частому слою, а не круглым числом: у шестнадцати
     каннелюр редкая сетка попадает мимо ложбины и занижает срез на десятые
     миллиметра — ровно там, где решается «стенка прорвётся» или «нет». */
  const maxN = Math.max(3, ...p.layers.map(l => l.n));
  const maxM = Math.max(1, ...p.layers.map(l => l.m));
  const NA = clamp(4 * maxN, 128, 512), NV = clamp(4 * maxM, 64, 200);
  for (let i = 0; i <= NV; i++) {
    const y = i / NV * H;
    for (let k = 0; k < NA; k++) {
      const d = patternOffset(p, k / NA * TAU, y, H);
      if (-d > carve) carve = -d;
      if (d > raise) raise = d;
    }
  }
  const v = {carve, raise};
  if (!by) reliefMemo.set(p, by = new Map());
  /* Высот у одной вещи единицы — корпус, крышка, разве что предпросмотр.
     Разрастись таблице не с чего, но потолок держим: неограниченный кэш
     внутри модуля однажды становится утечкой. */
  if (by.size > 8) by.clear();
  by.set(key, v);
  return v;
}

/**
 * Огибающие рельефа по точкам профиля: [{r, y, lo, hi}] в миллиметрах.
 *
 * Их спрашивает и чертёж, и лист для производства, а чертёж перерисовывается
 * на каждое движение камеры: считать по точке на кадр — четыре миллисекунды
 * на ровном месте. Ответ кэшируется по самой выборке профиля (она тоже живёт
 * до следующей правки) и по записи узора.
 */
const outlineMemo = new WeakMap();
export function patternOutline(pat, out) {
  if (!out || !out.length) return [];
  const p = sanitizePattern(pat);
  const hit = outlineMemo.get(out);
  if (hit && hit.pat === p) return hit.v;
  const H = out[out.length - 1].y;
  const v = out.map(o => ({r: o.r, y: o.y, ...patternBand(p, o.y, H)}));
  outlineMemo.set(out, {pat: p, v});
  return v;
}

/**
 * Прирост площади кольцевого сечения от рельефа, мм².
 *
 * Сечение стенки при узоре переменное: в ложбине тоньше, на гребне толще.
 * Среднее смещение у синусоид равно нулю, но площадь всё равно растёт —
 * радиус входит в неё квадратом. Для запаса прочности это важно: сжатие
 * сырой стенки держит вся площадь сечения, а не самое тонкое место.
 */
export function patternAreaMM2(pat, r, y, H) {
  const p = sanitizePattern(pat);
  if (!patternOn(p)) return 0;
  const NA = 48;
  let sum = 0;
  for (let k = 0; k < NA; k++) {
    const d = patternOffset(p, k / NA * TAU, y, H);
    sum += ((r + d) * (r + d) - r * r) / 2;
  }
  return sum * (TAU / NA);
}

/**
 * Развёртка рельефа: стенка, разрезанная по образующей и разложенная в лист.
 *
 * Модель показывает половину вазы и ту в перспективе: пояс на задней стороне,
 * сдвиг слоя по кругу и место, где два слоя накладываются, на ней просто
 * не видны. Развёртка показывает всё сразу и в настоящих пропорциях —
 * лист шириной πD и высотой H.
 *
 * Здесь только числа: строка 0 — дно, столбец 0 — угол 0. Как это красить,
 * знает интерфейс.
 *
 * @param opt {H, D, cols, rows}
 * @returns {cols, rows, H, widthMM, mm: Float32Array, lo, hi}
 */
export function patternMap(pat, opt = {}) {
  const H = +opt.H > 0 ? +opt.H : 220;
  const D = +opt.D > 0 ? +opt.D : 160;
  const cols = Math.max(8, Math.round(opt.cols || 200));
  const rows = Math.max(2, Math.round(opt.rows || 90));
  const p = sanitizePattern(pat);
  const mm = new Float32Array(cols * rows);
  let lo = 0, hi = 0;
  if (patternOn(p)) {
    for (let i = 0; i < rows; i++) {
      const y = i / (rows - 1) * H;
      for (let j = 0; j < cols; j++) {
        const d = patternOffset(p, j / cols * TAU, y, H);
        mm[i * cols + j] = d;
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
  }
  return {cols, rows, H, widthMM: Math.PI * D, mm, lo, hi};
}

/** Название узора: одно имя или стопка через плюс. */
export function patternTitle(pat) {
  const on = patternLayers(pat).filter(layerOn);
  if (!on.length) return 'без узора';
  return on.map(l => patternById(l.id).name).join(' + ');
}

/** Строка про один слой: имя и всё, что о нём стоит знать в цехе. */
export function layerText(l) {
  const p = patternById(l.id);
  if (!p) return '';
  const bits = [`${l.depth} мм`];
  if (p.uses.includes('n')) bits.push(`${l.n} по кругу`);
  if (p.uses.includes('m')) bits.push(`${l.m} по высоте`);
  if (l.twist) bits.push(`закрутка ${l.twist}°`);
  if (l.phase) bits.push(`сдвиг ${l.phase}°`);
  if (l.from > 0 || l.to < 1)
    bits.push(`пояс ${Math.round(l.from * 100)}–${Math.round(l.to * 100)} % высоты`);
  return `${p.name}: ${bits.join(', ')}`;
}

/** Описание всей стопки строками — для паспорта, техкарты и рецепта. */
export const patternSummary = pat => patternLayers(pat).filter(layerOn).map(layerText);

/**
 * Рельеф под корнями прилепов, мм: [{name, az, d}].
 *
 * Ручку и носик лепят на стенку — и если корень попадает в ложбину, шов
 * держится на её дне: площадь приклейки меньше, а сохнет такой шов иначе,
 * чем остальная стенка. Это ровно то, ради чего у слоя есть сдвиг по кругу:
 * гребень уводят от прилепа, а не наоборот.
 *
 * Угол сегмента и азимут детали связаны как phi = π/2 − az — тот же порядок,
 * в каком прилепы поворачиваются в сцене.
 *
 * @param parts [{kind, az, top, bot, at}] — доли высоты, как в конструкторе
 */
export function patternUnderParts(pat, parts, H) {
  const p = sanitizePattern(pat);
  if (!patternOn(p) || !parts || !parts.length) return [];
  const NAME = {handle: 'ручка', spout: 'носик', lip: 'слив'};
  const out = [];
  for (const part of parts) {
    if (part.kind === 'lip') continue;            // слив не приклеивают, а отгибают
    const th = Math.PI / 2 - (+part.az || 0) * Math.PI / 180;
    /* У ручки два корня, у носика один: смотрим каждый и берём худший.
       Высота корня хранится долей высоты, а не процентами: проценты стоят
       только в подписи ползунка, и делить их здесь на сто — верный способ
       посадить корень на дно вазы. */
    const roots = part.kind === 'handle'
      ? [+part.top || 0.78, +part.bot || 0.34]
      : [+part.at || 0.62];
    let worst = 0;
    for (const v of roots) {
      const d = patternOffset(p, th, clamp(v, 0, 1) * H, H);
      if (d < worst) worst = d;
    }
    out.push({name: NAME[part.kind] || 'деталь', az: +part.az || 0, d: worst});
  }
  return out;
}

/**
 * Числа рельефа для показа и для замечаний — одной формулой.
 *
 * Панель и «Контроль мастера» говорят об одном и том же: шаг рельефа
 * по окружности, период по высоте, сколько срезано в ложбине. Считались они
 * порознь, и разойтись могли молча — в панели одно число, в замечании другое,
 * а какое верное, снаружи не видно.
 *
 * @param ctx {D, H, bead, layerH, wall, hollow}
 * @returns {stepMM, periodMM, periodLayers, carve, raise, wallLeft, layers:[…]}
 */
export function patternMetrics(pat, ctx = {}) {
  const p = sanitizePattern(pat);
  const on = p.layers.filter(layerOn);
  const R = (+ctx.D || 0) / 2;
  const H = +ctx.H || 220;
  const layerH = +ctx.layerH || 0;
  const wall = ctx.hollow === false ? 0 : (+ctx.wall || 0);
  const per = on.map(l => {
    const pp = patternById(l.id);
    /* Шаг по кругу есть только у слоёв, которые по кругу и повторяются:
       у колец его нет вовсе, и «—» честнее нуля. */
    const stepMM = pp.uses.includes('n') && R ? TAU * R / Math.max(1, l.n) : null;
    const span = (l.to - l.from) * H;
    const periodMM = pp.uses.includes('m') ? span / Math.max(1, l.m) : null;
    return {id: l.id, name: pp.name, stepMM, periodMM,
            periodLayers: periodMM && layerH ? periodMM / layerH : null};
  });
  const num = (arr, f) => { const v = arr.map(f).filter(x => x != null); return v.length ? Math.min(...v) : null; };
  const {carve, raise} = patternRelief(p, H);
  return {
    layers: per,
    /* По самому мелкому слою: рвётся печать там, где тесно, а не в среднем. */
    stepMM: num(per, x => x.stepMM),
    periodMM: num(per, x => x.periodMM),
    periodLayers: num(per, x => x.periodLayers),
    carve, raise,
    wallLeft: wall ? Math.max(0, wall - carve) : null,
  };
}

/**
 * Замечания по узору: что машина не повторит и что испортит вещь.
 * @param ctx {wall, hollow, D, H, bead, layerH} — стенка, габарит,
 *        ширина бусины и высота слоя принтера
 */
export function patternWarnings(pat, ctx = {}) {
  const out = [];
  const p = sanitizePattern(pat);
  const layers = p.layers.filter(layerOn);
  if (!layers.length) return out;

  /* У сплошного тела стенки нет: там рельеф ничего не прорывает, и говорить
     «в ложбине останется 2 мм» было бы выдумкой. */
  const wall = ctx.hollow === false ? 0 : (+ctx.wall || 0);
  const bead = +ctx.bead || 0;
  const layerH = +ctx.layerH || 0;
  const R = (+ctx.D || 0) / 2;
  const H = +ctx.H || 220;
  const many = layers.length > 1;
  const who = l => many ? `${patternById(l.id).name}: ` : '';

  /* Сколько рельеф срезает на самом деле — по всей стопке, а не по слою:
     два слоя в одном поясе режут стенку вместе. Наружные слои её не режут
     вовсе, и в переборе это учтено само собой. */
  const M = patternMetrics(p, ctx);
  const carve = M.carve;
  const thin = layers.some(l => patternById(l.id).thin);
  const floor = thin ? 0.5 : 1.2;
  if (wall && carve > 0.01) {
    const left = wall - carve;
    if (left < floor)
      out.push({lvl: 'bad', txt: `Рельеф срезает ${carve.toFixed(1)} мм при стенке ${wall} мм: ` +
        `в ложбине остаётся ${Math.max(0, left).toFixed(1)} мм — стенка прорвётся. ` +
        `Оставьте хотя бы ${floor} мм.` +
        (many ? ' Слои складываются там, где их пояса перекрываются.' : '')});
    else if (!thin && left < wall * 0.5)
      out.push({lvl: 'warn', txt: `В ложбине стенка ${left.toFixed(1)} мм из ${wall} мм — ` +
        'на просвет это красиво, но вещь становится хрупкой.'});
  }

  layers.forEach((l, li) => {
    const pp = patternById(l.id);

    /* Шаг узора по окружности. Сопло не нарисует борозду уже своей бусины:
       на модели узор будет, на изделии — гладкая стенка. */
    if (bead && R && pp.uses.includes('n')) {
      const step = M.layers[li].stepMM;
      if (step < bead * 2)
        out.push({lvl: 'bad', area: 'print',
          txt: `${who(l)}шаг узора ${step.toFixed(1)} мм при бусине ${bead.toFixed(1)} мм — ` +
          'сопло его не повторит. Уменьшите число повторов.'});
      else if (step < bead * 3.5)
        out.push({lvl: 'warn', area: 'print',
          txt: `${who(l)}шаг узора ${step.toFixed(1)} мм — на границе того, ` +
          'что различит сопло; рельеф выйдет мягче, чем на экране.'});
    }

    /* Шаг узора по высоте против высоты слоя. Печать набирается слоями, и
       рельеф, у которого период короче трёх слоёв, машине нечем нарисовать:
       на экране кольца, на изделии — ровная стенка. Проверять это на глаз
       нельзя, потому что число слоёв не показано нигде. */
    if (layerH && pp.uses.includes('m')) {
      const span = (l.to - l.from) * H;   // для подсказки «уменьшите до …»
      const period = M.layers[li].periodMM;
      const layers2 = M.layers[li].periodLayers;
      if (layers2 < 3)
        out.push({lvl: 'bad', area: 'print',
          txt: `${who(l)}по высоте период ${period.toFixed(1)} мм — это ${layers2.toFixed(1)} слоя ` +
          `по ${layerH} мм. Машина такой рельеф не наберёт: уменьшите повторы по высоте ` +
          `до ${Math.max(1, Math.floor(span / (layerH * 5)))} или ниже.`});
      else if (layers2 < 5)
        out.push({lvl: 'warn', area: 'print',
          txt: `${who(l)}по высоте период ${period.toFixed(1)} мм — всего ${layers2.toFixed(1)} слоя: ` +
          'рельеф выйдет ступенчатым и мягче, чем на экране.'});
    }

    /* Закрутка: наклон гребня к вертикали. За 60° сопло кладёт бусину на воздух. */
    if (l.twist && R && H) {
      const shift = Math.abs(l.twist) / 360 * TAU * R;   // сдвиг гребня по кругу, мм
      const ang = Math.atan2(shift, H) * 180 / Math.PI;
      if (ang > 60)
        out.push({lvl: 'bad', area: 'print',
          txt: `${who(l)}закрутка ${Math.round(ang)}° к оси — гребень ложится ` +
          'почти горизонтально и повиснет в воздухе.'});
      else if (ang > 40)
        out.push({lvl: 'warn', area: 'print',
          txt: `${who(l)}закрутка ${Math.round(ang)}° к оси — на пределе: ` +
          'следите за свесом при печати.'});
    }

    if (pp.thin && wall) {
      const left = Math.max(0, wall - l.depth);
      out.push({lvl: left < 0.8 ? 'warn' : 'ok',
        txt: `В окне остаётся ${left.toFixed(1)} мм стенки. Тоньше 0,8 мм ` +
          'фарфор светится лучше всего, но вещь становится сувенирной: воду в неё не наливают.'});
    }
  });

  /* Оснастка. Жёсткая форма (пресс, ролик) снимается вдоль оси, и рельеф,
     который меняется по высоте, — это поднутрение по направлению съёма:
     кольца, чешуя, кладка, лунки такой оснасткой не отформовать. Вертикальные
     борозды сходят по оси, но закрученные превращаются в винт, и вещь
     не снимется прямым ходом. И главное: рельеф в этом инструменте воспроизводит
     только печать. Гипс — и жёсткая оснастка, и полуформы под отливку — строится
     по гладкому профилю: рельеф в полость не закладывается, потому что снимать
     его из формы можно не всякий, а разбор поднутрений по разъёму — отдельная
     подсистема, которой здесь нет. Поэтому замечание живёт на вкладке оснастки. */
  /* Глазурь на рельефе. Борозда — это то же ребро и та же канавка, что и на
     профиле: на гребне плёнка утоньшается до пробоя, в ложбине набирается
     и темнеет. Считает это ядро глазури той же формулой, что и для сечения;
     сюда приходит уже готовый ответ, потому что реестр глазурей — не дело
     модуля узора. Множители помечены как оценка: они опираются на параметры
     семейства, подобранные по виду образцов, а не измеренные. */
  if (ctx.look) {
    const rc = reliefCoat(ctx.look, {stepMM: M.stepMM, periodMM: M.periodMM,
                                     depth: Math.max(M.carve, M.raise)});
    if (rc && rc.crest < 0.75)
      out.push({lvl: rc.crest < 0.45 ? 'bad' : 'warn', area: 'glaze', help: 'glaze-relief', txt:
        `Глазурь на рельефе: гребень радиусом ${rc.radiusMM.toFixed(1)} мм — плёнка на нём ` +
        `тоньше в ${(1 / rc.crest).toFixed(1)} раза и пробьёт до черепка, а в ложбине ` +
        `наберётся ${rc.valley.toFixed(1)}× и потемнеет. Это оценка по семейству глазури, ` +
        'а не измеренная толщина: сгладьте рельеф или возьмите глазурь спокойнее.'});
    else if (rc && rc.valley > 1.4)
      out.push({lvl: 'warn', area: 'glaze', help: 'glaze-run', txt:
        `Глазурь на рельефе: в ложбинах наберётся ${rc.valley.toFixed(1)}× — там она темнее ` +
        'и на политом обжиге потечёт первой. Оценка по семейству глазури.'});
  }

  /* Отливка. Полость гипсовой формы строится по гладкому профилю — рельефа
     в ней нет вовсе, какой бы он ни был. Молчать об этом нельзя: человек
     настроил узор, заказал форму и получил гладкую вещь. Замечание помечено
     вкладкой отливки, поэтому видит его тот, кто и правда льёт.  */
  out.push({lvl: 'warn', area: 'cast', help: 'casting', txt:
    'Узор и форма для отливки: полость строится по гладкому профилю — рельеф ' +
    'в гипс не закладывается, и отлитая вещь выйдет гладкой. Рельеф даёт ' +
    'только печать; в форму его переносят по мастер-модели вручную.'});

  const upDown = layers.filter(l => patternById(l.id).uses.includes('m') && l.m >= 1);
  const twisted = layers.filter(l => Math.abs(l.twist) >= 15);
  if (upDown.length)
    out.push({lvl: 'warn', area: 'tool', txt:
      `${upDown.length > 1 ? 'Слои' : 'Слой'} «${upDown.map(l => patternById(l.id).name).join('», «')}» ` +
      `${upDown.length > 1 ? 'меняются' : 'меняется'} по высоте — для жёсткой оснастки это ` +
      'поднутрение: съём идёт вдоль оси. Прессом и роликом такую вещь не отформовать, ' +
      'а гипс здесь строится по гладкому профилю: рельеф в полость не ' +
      'закладывается — его даёт только печать.'});
  else if (twisted.length)
    out.push({lvl: 'warn', area: 'tool', txt:
      `Закрутка ${Math.round(Math.abs(twisted[0].twist))}° делает борозды винтом — ` +
      'из жёсткой формы вещь не снимется прямым ходом. Без закрутки вертикальный ' +
      'рельеф съёму вдоль оси не мешает.'});

  /* Пояса, которые не сходятся: слой, целиком уехавший в гашение у дна или
     кромки, крутится ползунками и не даёт ничего. */
  for (const l of layers) {
    const z = Math.max(3, H * 0.06) / H;             // доля высоты под гашением
    if (l.to <= z || l.from >= 1 - z)
      out.push({lvl: 'warn', txt: `${who(l)}пояс ${Math.round(l.from * 100)}–${Math.round(l.to * 100)} % ` +
        'лежит там, где узор гасится у дна или кромки — на вещи его не будет.'});
  }
  return out;
}

/**
 * Готовые сочетания. Ползунки вслепую — это «покрутите и посмотрите»;
 * пресет ставит рабочую стопку целиком, дальше её правят под свою вещь.
 * Числа не выдуманы: шаг рельефа у каждого крупнее двух бусин сопла 4 мм,
 * период по высоте — больше пяти слоёв по 2,4 мм, глубина оставляет стенку
 * целой при рецептных 5 мм.
 */
export const PATTERN_PRESETS = [
  {id: 'colonna', name: 'Колонна', what: 'ровные каннелюры без закрутки',
   pat: {layers: [{id: 'flute', n: 16, depth: 2, twist: 0}]}},

  {id: 'twisted', name: 'Витой жгут', what: 'каннелюры, повёрнутые на пол-оборота',
   pat: {layers: [{id: 'flute', n: 10, depth: 3, twist: 180}]}},

  {id: 'gem', name: 'Огранка', what: 'плоские грани, свет ломается рёбрами',
   pat: {layers: [{id: 'facet', n: 12, depth: 1.6}]}},

  {id: 'crown', name: 'Корона', what: 'острые лучи звезды на всю высоту',
   pat: {layers: [{id: 'star', n: 10, depth: 2.4, twist: 30}]}},

  {id: 'basket', name: 'Корзина', what: 'ромбическая сетка с лёгкой закруткой',
   pat: {layers: [{id: 'weave', n: 14, depth: 2, twist: 60, m: 10}]}},

  {id: 'herringbone', name: 'Ёлочка', what: 'борозды зигзагом — след машины, а не гребёнки',
   pat: {layers: [{id: 'chevron', n: 12, depth: 2, m: 6}]}},

  {id: 'pinecone', name: 'Шишка', what: 'бугорки по спирали, держатся в руке',
   pat: {layers: [{id: 'bump', n: 16, depth: 2.2, twist: 120, m: 12}]}},

  {id: 'masonry', name: 'Кладка', what: 'кирпичики вразбежку — рельеф поверх стенки',
   pat: {layers: [{id: 'brick', n: 14, depth: 2, m: 10}]}},

  {id: 'cortex', name: 'Кора', what: 'шум без повторов плюс редкие кольца',
   pat: {layers: [
     {id: 'bark', n: 18, depth: 1.6, m: 12},
     {id: 'wave', depth: 0.8, m: 5}]}},

  {id: 'belt', name: 'Пояс', what: 'гладкий низ, чешуя поясом, кольцо под кромкой',
   pat: {layers: [
     {id: 'bump', n: 14, depth: 2.2, m: 5, from: 0.34, to: 0.66, edge: 0.06},
     {id: 'wave', depth: 1, m: 2, from: 0.72, to: 0.92, edge: 0.05}]}},

  {id: 'amphora', name: 'Амфора', what: 'каннелюры на всю высоту и лунки в поясе',
   pat: {layers: [
     {id: 'flute', n: 18, depth: 1.6, twist: 40},
     {id: 'dimple', n: 9, depth: 1.8, m: 4, from: 0.2, to: 0.55, edge: 0.07}]}},

  {id: 'lamp', name: 'Светильник', what: 'крупные окна: на просвет остаётся тонкое дно',
   pat: {layers: [{id: 'window', n: 10, depth: 3.8, m: 5}]}},
];
