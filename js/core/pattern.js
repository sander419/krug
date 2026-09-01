// file: js/core/pattern.js
// Узор на стенке: рельеф, который печатает машина и не вытянуть руками.
//
// На круге стенка получается гладким телом вращения — руки не умеют иначе.
// Машина умеет: сопло ходит по спирали, и если радиус чуть менять по углу
// и по высоте, из той же вазы выходит каннелюра, витой жгут, плетёнка или
// чешуя. Это не украшение поверх модели, а сама форма: тот же рельеф уезжает
// в STL и в G-code, иначе картинка на экране врала бы про напечатанное.
//
// Второе, ради чего это затевалось: **тонкая стенка светится**. Рельеф снаружи
// при гладкой стенке изнутри делает толщину переменной, и фарфоровая ваза на
// просвет показывает узор — тот же приём, что в литофании.
//
// Устройство: узор — это функция смещения радиуса `d(θ, y)` в миллиметрах.
// Ничего не знает ни о three.js, ни о слайсере: и сцена, и G-code спрашивают
// у неё одно и то же смещение, поэтому напечатанное совпадает с показанным.
//
// Границы честности:
//   • узор ложится только на **внешнюю** стенку; полость остаётся гладкой,
//     иначе изделие нечем мыть, а вместимость пришлось бы считать заново;
//   • у дна и у кромки узор гасится: на посадочном пояске рельеф мешает
//     стоять, на кромке — пить;
//   • масса и объём считаются с поправкой на рельеф, а не «как у гладкой».

import { clamp } from './util.js';

/* Треугольная волна: даёт грани вместо синусоидальных валиков. */
const tri = x => 2 * Math.abs(2 * (x / (2 * Math.PI) - Math.floor(x / (2 * Math.PI) + 0.5))) - 1;
/* Узкий гребень в долях периода: 1 на гребне, 0 между. */
const ridge = (x, w) => {
  const u = x / (2 * Math.PI) - Math.floor(x / (2 * Math.PI)) - 0.5;
  return Math.exp(-(u * u) / (2 * w * w));
};

/**
 * Реестр узоров. `f(a)` — форма рельефа в долях глубины, где
 * `a.th` — угол с уже учтённой закруткой, `a.n` — повторов по кругу,
 * `a.v` — доля высоты 0…1, `a.m` — повторов по высоте.
 */
export const PATTERNS = [
  {id: 'none', name: 'Без узора', what: 'гладкая стенка, как на круге',
   uses: [], f: () => 0},

  {id: 'flute', name: 'Каннелюры', what: 'вертикальные валики и ложбины, как на колонне',
   uses: ['n', 'depth', 'twist'],
   f: a => Math.cos(a.th * a.n)},

  {id: 'facet', name: 'Грани', what: 'плоские грани вместо круга — свет ломается рёбрами',
   uses: ['n', 'depth', 'twist'],
   f: a => tri(a.th * a.n)},

  {id: 'wave', name: 'Кольца', what: 'горизонтальные волны по всей высоте',
   uses: ['depth', 'm'],
   f: a => Math.sin(a.v * Math.PI * 2 * a.m)},

  {id: 'weave', name: 'Плетёнка', what: 'ромбическая сетка: два встречных семейства борозд',
   uses: ['n', 'depth', 'm', 'twist'],
   f: a => Math.sin(a.th * a.n) * Math.cos(a.v * Math.PI * 2 * a.m)},

  {id: 'bump', name: 'Чешуя', what: 'бугорки рядами — держатся в руке и играют на свету',
   uses: ['n', 'depth', 'm', 'twist'],
   f: a => Math.max(0, Math.sin(a.th * a.n) * Math.sin(a.v * Math.PI * 2 * a.m)) * 2 - 1},

  {id: 'spiral', name: 'Спиральное ребро', what: 'один жгут, идущий по спирали снизу вверх',
   uses: ['n', 'depth', 'twist'],
   f: a => ridge(a.th * a.n, 0.12) * 2 - 1},

  {id: 'window', name: 'Окна на просвет', what: 'вырезы почти на всю стенку: тонкое дно окна светится',
   thin: true, uses: ['n', 'depth', 'm', 'twist'],
   /* Окно — не дыра, а ложбина почти на всю стенку. Сквозное отверстие сгубило
      бы и вещь (воду не нальёшь), и печать: LDM кладёт бусину непрерывно
      и разрыв слоя заканчивается обрывом жгута. Тонкое дно окна на просвет
      светится — тот же приём, что в литофании. */
   f: a => {
     const g = Math.sin(a.th * a.n) * Math.sin(a.v * Math.PI * 2 * a.m);
     const t = clamp((g - 0.35) / 0.25, 0, 1);
     return -(t * t * (3 - 2 * t));
   }},
];

export const patternById = id => PATTERNS.find(p => p.id === id) || PATTERNS[0];

export const LIMITS = {
  n: [3, 64], depth: [0, 14], twist: [-720, 720], m: [1, 40],
};

/** Привести запись узора к схеме. Пустое — «без узора». */
export function sanitizePattern(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const p = patternById(src.id);
  const num = (v, key, def) => {
    const n = +v;
    return Number.isFinite(n) ? clamp(n, LIMITS[key][0], LIMITS[key][1]) : def;
  };
  return {
    id: p.id,
    n: Math.round(num(src.n, 'n', 12)),
    depth: num(src.depth, 'depth', 2),
    twist: num(src.twist, 'twist', 0),
    m: Math.round(num(src.m, 'm', 8)),
  };
}

export const patternOn = pat => !!(pat && pat.id && pat.id !== 'none' && pat.depth > 0.01);

/* Затухание у дна и у кромки. Рельеф на посадочном пояске мешает стоять,
   на кромке — пить и держать крышку. Зона гашения — доля высоты, но не
   меньше пары миллиметров: на низкой вещи иначе гасится всё. */
function fade(y, H) {
  const z = Math.max(3, H * 0.06);
  return Math.min(1, clamp(y / z, 0, 1) * clamp((H - y) / z, 0, 1));
}

/**
 * Смещение радиуса в миллиметрах.
 * @param pat очищенная запись узора
 * @param th угол, радианы
 * @param y высота, мм
 * @param H полная высота, мм
 */
export function patternOffset(pat, th, y, H) {
  if (!patternOn(pat)) return 0;
  const p = patternById(pat.id);
  const v = H > 0 ? clamp(y / H, 0, 1) : 0;
  /* Закрутка задаётся в градусах на всю высоту: так число понятно мастеру
     («ваза повёрнута на пол-оборота»), а не в радианах на миллиметр. */
  const tw = pat.twist * Math.PI / 180 * v;
  const a = {th: th + tw, n: pat.n, v, m: pat.m};
  return p.f(a) * pat.depth * fade(y, H);
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
      const th = k / NA * Math.PI * 2;
      const d = patternOffset(pat, th, y, H);
      ring += ((r + d) * (r + d) - r * r) / 2;
    }
    sum += ring * (Math.PI * 2 / NA) * dy;
  }
  return sum / 1000;                               // мм³ → см³
}

/**
 * Замечания по узору: что машина не повторит и что испортит вещь.
 * @param ctx {wall, D, H, bead} — стенка, габарит, ширина бусины принтера
 */
export function patternWarnings(pat, ctx = {}) {
  const out = [];
  if (!patternOn(pat)) return out;
  const p = patternById(pat.id);
  const wall = +ctx.wall || 0;
  const bead = +ctx.bead || 0;
  const R = (+ctx.D || 0) / 2;
  const H = +ctx.H || 0;

  /* Рельеф режется в стенку: в ложбине остаётся `wall − depth`, на гребне
     становится `wall + depth`. Прорыв — это когда в ложбине не остаётся
     ничего; тонкая, но целая стенка — законный приём, на нём держится
     и просвет. У «Окон» тонкое дно и есть цель, поэтому им разрешено больше. */
  const left = wall ? wall - pat.depth : null;
  const floor = p.thin ? 0.5 : 1.2;
  if (left !== null && left < floor)
    out.push({lvl: 'bad', txt: `Глубина ${pat.depth} мм при стенке ${wall} мм: в ложбине ` +
      `остаётся ${Math.max(0, left).toFixed(1)} мм — стенка прорвётся. ` +
      `Оставьте хотя бы ${floor} мм.`});
  else if (left !== null && !p.thin && left < wall * 0.5)
    out.push({lvl: 'warn', txt: `В ложбине стенка ${left.toFixed(1)} мм из ${wall} мм — ` +
      'на просвет это красиво, но вещь становится хрупкой.'});

  /* Шаг узора по окружности. Сопло не нарисует борозду уже своей бусины:
     на модели узор будет, на изделии — гладкая стенка. */
  if (bead && R && p.uses.includes('n')) {
    const step = 2 * Math.PI * R / Math.max(1, pat.n);
    if (step < bead * 2)
      out.push({lvl: 'bad', txt: `Шаг узора ${step.toFixed(1)} мм при бусине ${bead.toFixed(1)} мм — ` +
        'сопло его не повторит. Уменьшите число повторов.'});
    else if (step < bead * 3.5)
      out.push({lvl: 'warn', txt: `Шаг узора ${step.toFixed(1)} мм — на границе того, ` +
        'что различит сопло; рельеф выйдет мягче, чем на экране.'});
  }

  /* Закрутка: наклон гребня к вертикали. За 60° сопло кладёт бусину на воздух. */
  if (pat.twist && R && H) {
    const shift = Math.abs(pat.twist) / 360 * 2 * Math.PI * R;   // сдвиг гребня по кругу, мм
    const ang = Math.atan2(shift, H) * 180 / Math.PI;
    if (ang > 60)
      out.push({lvl: 'bad', txt: `Закрутка ${Math.round(ang)}° к оси — гребень ложится ` +
        'почти горизонтально и повиснет в воздухе.'});
    else if (ang > 40)
      out.push({lvl: 'warn', txt: `Закрутка ${Math.round(ang)}° к оси — на пределе: ` +
        'следите за свесом при печати.'});
  }

  if (p.thin && wall) {
    const left = Math.max(0, wall - pat.depth);
    out.push({lvl: left < 0.8 ? 'warn' : 'ok',
      txt: `В окне остаётся ${left.toFixed(1)} мм стенки. Тоньше 0,8 мм ` +
        'фарфор светится лучше всего, но вещь становится сувенирной: воду в неё не наливают.'});
  }
  return out;
}
