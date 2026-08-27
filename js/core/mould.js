// file: js/core/mould.js
// Контуры оснастки как тела вращения. Чистая геометрия: каждая функция отдаёт
// замкнутый контур сечения в виде массива {r, y} в миллиметрах — из него потом
// строится LatheGeometry для 3D и STL или полилиния для DXF. Контур начинается
// и заканчивается на оси: тело вращения замыкается самой осью, возвращаться
// в первую точку не нужно — иначе появляется вырожденное кольцо.
//
// Всё в сыром размере: оснастка делается по модели, которая больше готового изделия
// на усадку. В КРУГе размеры на круге и есть сырой размер.
import { userProfileMM, floorY } from './math.js';

export const MOULD_DEFAULTS = {
  wallMM: 30,     // толщина тела формы сбоку
  baseMM: 25,     // толщина под изделием
  capMM: 25,      // толщина верхней полуформы над изделием
  rimMM: 6,       // борт матрицы выше кромки изделия
};

const AX = 0.01;                       // ось: нулевой радиус вырождает треугольники
const clean = pts => {                 // выбрасываем повторы, они ломают Lathe
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++)
    if (Math.hypot(pts[i].r - out[out.length - 1].r, pts[i].y - out[out.length - 1].y) > 0.01)
      out.push(pts[i]);
  return out;
};

/* Наружный контур изделия и внутренний (со сдвигом на стенку). */
export function wareProfiles(state) {
  const outer = userProfileMM(state);
  const floor = floorY(state);
  const inner = outer.filter(p => p.y >= floor).map(p => ({r: Math.max(p.r - state.wall, 0), y: p.y}));
  return {outer, inner, floor, maxR: Math.max(...outer.map(p => p.r)), H: outer[outer.length - 1].y};
}

/* Модель (болван): само изделие сплошным телом — по нему формуют гипс. */
export function modelPath(state) {
  const {outer, H} = wareProfiles(state);
  return clean([{r: AX, y: 0}, ...outer.map(p => ({r: Math.max(p.r, AX), y: p.y})), {r: AX, y: H}]);
}

/* Нижняя полуформа (матрица): блок с полостью по наружной поверхности изделия.
   Она же — гипсовая форма для роликового формования. */
export function cavityPath(state, opt = {}) {
  const o = {...MOULD_DEFAULTS, ...opt};
  const {outer, maxR, H} = wareProfiles(state);
  const Rb = maxR + o.wallMM;
  const top = H + o.rimMM;
  const rTop = Math.max(outer[outer.length - 1].r, AX);
  return clean([
    {r: AX, y: -o.baseMM},
    {r: Rb, y: -o.baseMM},
    {r: Rb, y: top},
    {r: rTop, y: top},
    ...[...outer].reverse().map(p => ({r: Math.max(p.r, AX), y: p.y})),
    {r: AX, y: 0},          // дно полости; ниже контур замыкает сама ось вращения
  ]);
}

/* Верхняя полуформа (пуансон): выступ по внутренней поверхности изделия. */
export function corePath(state, opt = {}) {
  const o = {...MOULD_DEFAULTS, ...opt};
  const {inner, maxR, floor, H} = wareProfiles(state);
  if (inner.length < 2) return null;
  const Rb = maxR + o.wallMM;
  const rTop = Math.max(inner[inner.length - 1].r, AX);
  return clean([
    {r: AX, y: floor},
    ...inner.map(p => ({r: Math.max(p.r, AX), y: p.y})),
    {r: rTop, y: H},
    {r: Rb, y: H},
    {r: Rb, y: H + o.capMM},
    {r: AX, y: H + o.capMM},   // верх плиты; ниже контур замыкает ось вращения
  ]);
}

/* Профиль ролика (шаблона) — рабочая кромка, повторяющая внутреннюю поверхность.
   Отдаётся как открытая линия: инструментальщику нужен контур, а не тело. */
export function rollerProfile(state) {
  const {inner} = wareProfiles(state);
  return inner.length >= 2 ? clean(inner) : null;
}

/* Объём изделия как сплошного тела вращения — это то, что вычитается из блока. */
export function wareSolidLitres(state) {
  const {outer} = wareProfiles(state);
  let v = 0;
  for (let i = 1; i < outer.length; i++) {
    const a = outer[i - 1].r, b = outer[i].r, dy = outer[i].y - outer[i - 1].y;
    v += Math.PI * dy * (a * a + a * b + b * b) / 3;
  }
  return v / 1e6;
}

/* Габариты куска гипса под матрицу — чтобы понимать расход. */
export function cavityStock(state, opt = {}) {
  const o = {...MOULD_DEFAULTS, ...opt};
  const {maxR, H} = wareProfiles(state);
  const Rb = maxR + o.wallMM;
  const height = H + o.rimMM + o.baseMM;
  const grossMM3 = Math.PI * Rb * Rb * height;
  const gross = grossMM3 / 1e6;
  const net = Math.max(0.01, gross - wareSolidLitres(state));   // полость под изделие вычитается
  return {radiusMM: Rb, heightMM: height, grossLitres: gross, netLitres: net};
}

export const PARTS = [
  {id: 'ware',  name: 'Изделие',           build: null},
  {id: 'model', name: 'Модель (болван)',   build: modelPath},
  {id: 'lower', name: 'Матрица (низ)',     build: cavityPath},
  {id: 'upper', name: 'Пуансон (верх)',    build: corePath},
];
