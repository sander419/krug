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
// На разъёме есть облойная канавка: неглубокий ров вокруг детали, куда уходит
// выдавленная глина. Без него половины не сходятся — облой держит их враспор,
// и деталь выходит толще на толщину этой плёнки.
//
// Чего здесь нет: воздушных каналов. Их сверлят по месту под конкретный пресс.
import * as THREE from 'three';
import { partStations, partOutline } from '../core/parts.js';
import { tune } from '../core/tuning.js';

const STATIONS = 64;      // шагов вдоль детали
const ARC = 18;           // шагов по половине сечения
const KEY_SEG = 20;       // шагов по окружности замка
const KEY_EDGE = 6;       // гипс между замком и краем блока, мм
/* Размеры замков и облойной канавки задаются в настройках расчёта: у каждой
   мастерской свой гипс и свой пресс. Читаются на каждом построении, а не один
   раз при загрузке модуля, — иначе правка порога ничего бы не меняла. */
const KEY_R = () => tune('keyR');
const KEY_H = () => tune('keyH');
const KEY_CLEAR = () => tune('keyClear');
const LAND = () => tune('land');
const FLASH_W = () => tune('flashW');
const FLASH_D = () => tune('flashD');
/* Стенка блока обязана вместить всё, что живёт на разъёме: площадку, канавку,
   зазор и сам замок с гипсом до края. Иначе замки некуда ставить — на крайних
   ручках их выходило ноль, и половины было нечем сцентрировать. */
const WALL_MIN = () => LAND() + FLASH_W() + KEY_CLEAR() + 2 * KEY_R() + KEY_EDGE;

/* Расстояние от точки до ломаной: замок не должен садиться на канавку. */
function distToPath(path, x, y) {
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}

/* Площадь замкнутого контура со знаком: по ней же определяем направление обхода. */
function signedArea(path) {
  let a = 0;
  for (let i = 0; i < path.length; i++) {
    const b = path[(i + 1) % path.length];
    a += path[i].x * b.y - b.x * path[i].y;
  }
  return a / 2;
}

/* Замки по углам блока. Место под них гарантировано шириной стенки, но проверку
   на канавку оставляем: она поймает разъезд, если размеры поменяют. */
function keyPositions(guard, X0, X1, Y0, Y1) {
  const d = KEY_EDGE + KEY_R();
  return [[X0 + d, Y0 + d], [X1 - d, Y0 + d], [X1 - d, Y1 - d], [X0 + d, Y1 - d]]
    .filter(([x, y]) => distToPath(guard, x, y) > KEY_R() + KEY_CLEAR())
    .map(([x, y]) => ({x, y}));
}

/* Пересечение отрезков без касаний по концам. */
function segCross(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
  return {x: a.x + rx * t, y: a.y + ry * t};
}

/* Снятие петель: смещённый контур на крутом изгибе перехлёстывается сам с собой,
   и earcut на таком контуре выдаёт рваную сетку. Найденную петлю выбрасываем,
   вставляя вместо неё точку пересечения. */
function deloop(path) {
  for (let pass = 0; pass < 24; pass++) {
    let hit = null;
    for (let i = 0; i < path.length && !hit; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      for (let j = i + 2; j < path.length; j++) {
        if (i === 0 && j === path.length - 1) continue;
        const x = segCross(a, b, path[j], path[(j + 1) % path.length]);
        if (x) { hit = {i, j, x}; break; }
      }
    }
    if (!hit) break;
    const head = path.slice(0, hit.i + 1), tail = path.slice(hit.j + 1);
    // петля короче остатка; если нет — выбрасываем её, а не полконтура
    path = head.length + tail.length >= hit.j - hit.i
      ? head.concat([hit.x], tail)
      : path.slice(hit.i + 1, hit.j + 1).concat([hit.x]);
  }
  return path;
}

/* Контур вокруг детали на расстоянии d от её края: рельсы разведены на r + d,
   а на торцах контур уходит вперёд по касательной на те же d. */
function offsetPath(st, d) {
  const N = st.length - 1;
  const side = (s, k) => ({x: s.x + k * s.nx * (s.r + d), y: s.y + k * s.ny * (s.r + d)});
  const L = st.map(s => side(s, 1)), R = st.map(s => side(s, -1));
  // касательная = (ny, -nx): нормаль повёрнута на четверть оборота
  const step = (p, s, k) => ({x: p.x + k * s.ny * d, y: p.y - k * s.nx * d});
  const out = L.slice();
  out.push(step(L[N], st[N], 1), step(R[N], st[N], 1));
  for (let i = N; i >= 0; i--) out.push(R[i]);
  out.push(step(R[0], st[0], -1), step(L[0], st[0], -1));
  return out;
}

/* Контуры облойной канавки. Смещение внутрь изгиба сворачивается петлёй там,
   где радиус кривизны меньше отступа: такие точки оказываются ближе к детали,
   чем задано, — их выбрасываем. Одинаково из обоих контуров, иначе стенки
   канавки перестанут сшиваться попарно и тело разъедется. */
export function flashPaths(st) {
  const band = partOutline(st);
  const trim = d => {
    const p = deloop(offsetPath(st, d).filter(q => distToPath(band, q.x, q.y) > d - 0.25));
    // обход приводим к часовому: стенки канавки сшиваются с гранью, а earcut
    // всегда обходит дырку против внешнего контура
    return signedArea(p) > 0 ? p.reverse() : p;
  };
  return {inner: trim(LAND()), outer: trim(LAND() + FLASH_W()), band};
}

/** Габарит блока без построения меша: для чисел в панели и в техкарте. */
export function partMouldBlock(prof, part, wall = 20) {
  wall = Math.max(wall, WALL_MIN());
  const st = partStations(prof, part, STATIONS);
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

/** Числа для панели и техкарты без меша: замки и объём облойной канавки. */
export function partMouldFeatures(prof, part, wall = 20) {
  const {st, X0, X1, Y0, Y1} = partMouldBlock(prof, part, wall);
  const {inner, outer} = flashPaths(st);
  const keys = keyPositions(outer, X0, X1, Y0, Y1).length;
  return {
    keys,
    keysL: keys * (2 / 3) * Math.PI * KEY_R() * KEY_R() * KEY_H() / 1e6,
    flashL: (Math.abs(signedArea(outer)) - Math.abs(signedArea(inner))) * FLASH_D() / 1e6,
    flashW: FLASH_W(), flashD: FLASH_D(), keyH: KEY_H(),
  };
}

/**
 * Одна половина формы. Возвращает геометрию в своей системе координат:
 * блок лежит разъёмом вверх, нижняя грань на нуле.
 */
export function partMouldGeometry(prof, part, wall = 20, opts = {}) {
  const socket = opts.half === 'socket';        // вторая половина: лунки вместо бугорков
  const {st, X0, X1, Y0, Y1, depth} = partMouldBlock(prof, part, wall);
  /* Торцы канавки закрыты полудисками с вершиной в центре сечения, поэтому
     центр обязан быть и в контуре выреза: иначе одно ребро грани встречает два
     ребра крышки, и в теле остаются щели — STL перестаёт быть замкнутым. */
  const {inner, outer, band} = flashPaths(st);

  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  const V2 = p => new THREE.Vector2(p.x, p.y);
  const faceTris = (shape, z = 0) => {
    const g = new THREE.ShapeGeometry(shape, 1);
    const gp = g.attributes.position, gi = g.index.array;
    for (let i = 0; i < gi.length; i += 3) {
      const v = [0, 1, 2].map(k => [gp.getX(gi[i + k]), gp.getY(gi[i + k]), z]);
      tri(v[0], v[1], v[2]);                      // нормаль вверх, наружу гипса
    }
    g.dispose();
  };

  /* лицевая грань: прямоугольник с вырезом под облойную канавку и замки */
  const keys = keyPositions(outer, X0, X1, Y0, Y1);
  const face = new THREE.Shape([
    new THREE.Vector2(X0, Y0), new THREE.Vector2(X1, Y0),
    new THREE.Vector2(X1, Y1), new THREE.Vector2(X0, Y1),
  ]);
  face.holes = [
    new THREE.Path(outer.map(V2)),
    ...keys.map(kp => new THREE.Path(Array.from({length: KEY_SEG}, (_, j) => {
      const a = j / KEY_SEG * Math.PI * 2;
      return new THREE.Vector2(kp.x + Math.cos(a) * KEY_R(), kp.y + Math.sin(a) * KEY_R());
    }))),
  ];
  faceTris(face);

  /* площадка между деталью и облойной канавкой */
  const landShape = new THREE.Shape(inner.map(V2));
  landShape.holes = [new THREE.Path(band.map(V2))];
  faceTris(landShape);

  /* сама облойная канавка: стенка вниз, дно, стенка вверх.
     Дно считает earcut по двум контурам, а не сшивкой точка в точку: после
     снятия петель у контуров разное число точек, и попарно их не сшить. */
  const at = (p, z) => [p.x, p.y, z];
  const wallStrip = (path, zA, zB) => {
    for (let i = 0; i < path.length; i++) {
      const j = (i + 1) % path.length;
      quad(at(path[i], zA), at(path[j], zA), at(path[j], zB), at(path[i], zB));
    }
  };
  wallStrip(inner, 0, -FLASH_D());
  const floor = new THREE.Shape(outer.map(V2));
  floor.holes = [new THREE.Path(inner.map(V2))];
  faceTris(floor, -FLASH_D());
  wallStrip(outer, -FLASH_D(), 0);

  /* канавка под деталь: половина сечения, уходящая вниз от разъёма */
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
      if (ring === 3) return [kp.x, kp.y, sign * KEY_H()];
      const t = ring / 3;
      const rr = KEY_R() * Math.cos(t * Math.PI / 2);
      const zz = sign * KEY_H() * Math.sin(t * Math.PI / 2);
      const a = j / KEY_SEG * Math.PI * 2;
      return [kp.x + Math.cos(a) * rr, kp.y + Math.sin(a) * rr, zz];
    };
    for (let ring = 0; ring < 3; ring++)
      for (let j = 0; j < KEY_SEG; j++) {
        const j2 = (j + 1) % KEY_SEG;
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
  const keysL = keys.length * (2 / 3) * Math.PI * KEY_R() * KEY_R() * KEY_H() / 1e6;
  const flashL = (Math.abs(signedArea(outer)) - Math.abs(signedArea(inner))) * FLASH_D() / 1e6;
  return {geometry: geo, blockMM: [X1 - X0, Y1 - Y0, depth], boxL, depth,
          keys: keys.length, keysL, keyH: KEY_H(), flashL, flashW: FLASH_W(), flashD: FLASH_D(), socket};
}
