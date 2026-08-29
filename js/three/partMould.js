// file: js/three/partMould.js
// Полуформа под прилеп: блок гипса с канавкой в половину сечения детали.
// Ручку и носик формуют между двумя такими половинами — глину закладывают
// в канавку, половины смыкают, лишнее выдавливается в облой.
//
// Разъём проходит по плоскости самой детали: и ручка, и носик — кривые в одной
// плоскости, поэтому половина сечения отсекается ровно по ней. Булевой операции
// снова не нужно: канавка это половина той же протяжки, а лицевая грань блока —
// прямоугольник с вырезом по её границе (THREE.Shape умеет дырки).
//
// Чего здесь нет и не будет: замков, штифтов, воздушных каналов и облойной
// канавки. Их закладывает изготовитель оснастки под свой пресс.
import * as THREE from 'three';
import { partCurve, partSection } from '../core/parts.js';

const STATIONS = 64;      // шагов вдоль детали
const ARC = 18;           // шагов по половине сечения
const KEY_R = 7;          // радиус замка, мм
const KEY_H = 4;          // высота бугорка (и глубина лунки)
const KEY_SEG = 20;       // шагов по окружности замка
const KEY_CLEAR = 3;      // мм от замка до канавки

/* Расстояние от точки до ломаной: замок не должен садиться на канавку. */
function distToBand(band, x, y) {
  let best = Infinity;
  for (let i = 0; i < band.length; i++) {
    const a = band[i], b = band[(i + 1) % band.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}

/* Замки по углам блока: бугорки на одной половине, лунки на другой. */
function keyPositions(band, X0, X1, Y0, Y1, wall) {
  const d = wall / 2 + KEY_R;
  return [[X0 + d, Y0 + d], [X1 - d, Y0 + d], [X1 - d, Y1 - d], [X0 + d, Y1 - d]]
    .filter(([x, y]) => distToBand(band, x, y) > KEY_R + KEY_CLEAR)
    .map(([x, y]) => ({x, y}));
}

/** Станции вдоль детали: точка, нормаль в плоскости, полуразмеры сечения. */
function stations(prof, part) {
  const curve = partCurve(prof, part);
  const sec = partSection(part);
  const out = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const p = curve.getPointAt(t);
    const d = curve.getTangentAt(t);
    const len = Math.hypot(d.x, d.y) || 1;
    out.push({
      x: p.x, y: p.y,
      nx: -d.y / len, ny: d.x / len,        // нормаль в плоскости детали
      r: sec.rAt(t), rz: sec.rAt(t) * sec.ratio,
    });
  }
  return out;
}

/** Габарит блока без построения меша: для чисел в панели и в техкарте. */
export function partMouldBlock(prof, part, wall = 20) {
  const st = stations(prof, part);
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, rzMax = 0;
  for (const s of st) {
    for (const k of [1, -1]) {
      xMin = Math.min(xMin, s.x + k * s.nx * s.r); xMax = Math.max(xMax, s.x + k * s.nx * s.r);
      yMin = Math.min(yMin, s.y + k * s.ny * s.r); yMax = Math.max(yMax, s.y + k * s.ny * s.r);
    }
    rzMax = Math.max(rzMax, s.rz);
  }
  const X0 = xMin - wall, X1 = xMax + wall, Y0 = yMin - wall, Y1 = yMax + wall;
  const depth = rzMax + wall;
  return {st, X0, X1, Y0, Y1, depth,
          blockMM: [X1 - X0, Y1 - Y0, depth],
          boxL: (X1 - X0) * (Y1 - Y0) * depth / 1e6};
}

/** Сколько замков встанет на эту форму — для чисел в панели. */
export function partMouldKeys(prof, part, wall = 20) {
  const {st, X0, X1, Y0, Y1} = partMouldBlock(prof, part, wall);
  const left = st.map(s => ({x: s.x + s.nx * s.r, y: s.y + s.ny * s.r}));
  const right = st.map(s => ({x: s.x - s.nx * s.r, y: s.y - s.ny * s.r}));
  return keyPositions(left.concat(right.slice().reverse()), X0, X1, Y0, Y1, wall).length;
}

/**
 * Одна половина формы. Возвращает геометрию в своей системе координат:
 * блок лежит разъёмом вверх, нижняя грань на нуле.
 */
export function partMouldGeometry(prof, part, wall = 20, opts = {}) {
  const socket = opts.half === 'socket';        // вторая половина: лунки вместо бугорков
  const {st, X0, X1, Y0, Y1, depth} = partMouldBlock(prof, part, wall);
  const left = st.map(s => ({x: s.x + s.nx * s.r, y: s.y + s.ny * s.r}));
  const right = st.map(s => ({x: s.x - s.nx * s.r, y: s.y - s.ny * s.r}));
  /* Торцы канавки закрыты полудисками с вершиной в центре сечения, поэтому
     центр обязан быть и в контуре выреза: иначе одно ребро грани встречает два
     ребра крышки, и в теле остаются щели — STL перестаёт быть замкнутым. */
  const capA = {x: st[0].x, y: st[0].y};
  const capB = {x: st[STATIONS].x, y: st[STATIONS].y};
  const band = left.concat([capB], right.slice().reverse(), [capA]);

  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };

  /* лицевая грань: прямоугольник с вырезом по границе канавки */
  const shape = new THREE.Shape([
    new THREE.Vector2(X0, Y0), new THREE.Vector2(X1, Y0),
    new THREE.Vector2(X1, Y1), new THREE.Vector2(X0, Y1),
  ]);
  const keys = keyPositions(band, X0, X1, Y0, Y1, wall);
  const keyRing = (kp, j) => {
    const a = j / KEY_SEG * Math.PI * 2;
    return {x: kp.x + Math.cos(a) * KEY_R, y: kp.y + Math.sin(a) * KEY_R};
  };
  shape.holes = [
    new THREE.Path(band.map(p => new THREE.Vector2(p.x, p.y))),
    ...keys.map(kp => new THREE.Path(
      Array.from({length: KEY_SEG}, (_, j) => {
        const q = keyRing(kp, j);
        return new THREE.Vector2(q.x, q.y);
      }))),
  ];
  const face = new THREE.ShapeGeometry(shape, 1);
  const fp = face.attributes.position, fi = face.index.array;
  for (let i = 0; i < fi.length; i += 3) {
    const v = [0, 1, 2].map(k => [fp.getX(fi[i + k]), fp.getY(fi[i + k]), 0]);
    tri(v[0], v[1], v[2]);                        // нормаль вверх, наружу блока
  }
  face.dispose();

  /* канавка: половина сечения, уходящая вниз от разъёма */
  const ring = (s, k) => {
    const a = Math.PI + k / ARC * Math.PI;        // от π до 2π: sin ≤ 0, вниз
    return [s.x + s.nx * s.r * Math.cos(a), s.y + s.ny * s.r * Math.cos(a), s.rz * Math.sin(a)];
  };
  for (let i = 0; i < STATIONS; i++)
    for (let k = 0; k < ARC; k++)
      quad(ring(st[i], k), ring(st[i + 1], k), ring(st[i + 1], k + 1), ring(st[i], k + 1));

  /* торцы канавки: полудиски */
  // обход крышки идёт против обхода канавки на том же торце, иначе
  // соседние треугольники смотрят в разные стороны и тело не ориентировано
  for (const [s, flip] of [[st[0], true], [st[STATIONS], false]]) {
    const c = [s.x, s.y, 0];
    for (let k = 0; k < ARC; k++) {
      const a = ring(s, k), b = ring(s, k + 1);
      flip ? tri(c, a, b) : tri(c, b, a);
    }
  }

  /* замки: купол вверх на одной половине, лунка вниз на другой */
  const sign = socket ? -1 : 1;
  for (const kp of keys) {
    const dome = (j, ring) => {
      if (ring === 3) return [kp.x, kp.y, sign * KEY_H];
      const t = ring / 3;
      const rr = KEY_R * Math.cos(t * Math.PI / 2);
      const zz = sign * KEY_H * Math.sin(t * Math.PI / 2);
      const a = j / KEY_SEG * Math.PI * 2;
      return [kp.x + Math.cos(a) * rr, kp.y + Math.sin(a) * rr, zz];
    };
    for (let ring = 0; ring < 3; ring++)
      for (let j = 0; j < KEY_SEG; j++) {
        const j2 = (j + 1) % KEY_SEG;
        // обход рима — против обхода выреза в грани, как и у канавки
        // вершина обходится против пояса под ней, пояса — против выреза в грани
        if (ring === 2) tri(dome(j, 3), dome(j, ring), dome(j2, ring));
        else quad(dome(j, ring), dome(j2, ring), dome(j2, ring + 1), dome(j, ring + 1));
      }
  }

  /* дно и стенки блока */
  const B = z => [[X0, Y0, z], [X1, Y0, z], [X1, Y1, z], [X0, Y1, z]];
  const bot = B(-depth);
  quad(bot[0], bot[3], bot[2], bot[1]);
  const top = B(0);
  quad(top[0], bot[0], bot[1], top[1]);
  quad(top[1], bot[1], bot[2], top[2]);
  quad(top[2], bot[2], bot[3], top[3]);
  quad(top[3], bot[3], bot[0], top[0]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // блок кладём разъёмом вверх и ставим на ноль: так его и заливают
  geo.translate(-(X0 + X1) / 2, -(Y0 + Y1) / 2, depth);
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const boxL = (X1 - X0) * (Y1 - Y0) * depth / 1e6;
  // бугорки добавляют гипс, лунки убавляют: половина эллипсоида R×R×H
  const keysL = keys.length * (2 / 3) * Math.PI * KEY_R * KEY_R * KEY_H / 1e6;
  return {geometry: geo, blockMM: [X1 - X0, Y1 - Y0, depth], boxL, depth,
          keys: keys.length, keysL, keyH: KEY_H, socket};
}


