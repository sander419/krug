// file: js/three/strainerMesh.js
// Кусок стенки с отверстиями. Тело вращения отдаёт этот участок целиком
// (см. skip в core/lathe.js), а здесь он выкладывается заново: контур участка
// и круги отверстий разбиваются на треугольники в параметрах (столбец, точка
// контура), а потом каждая вершина садится на ту же поверхность вращения.
//
// Отсюда два следствия. Шов совпадает вершина в вершину, потому что границы
// участка — те же целые линии сетки. И отверстия получаются круглыми, а не
// ступенчатыми: их края лежат на настоящей окружности, а не на клетках сетки.
import * as THREE from 'three';
import { surfacePoint, surfaceNormal, rimIndex, rowOfY } from '../core/strainer.js';

const RIM_SEGS = 20;      // на сколько отрезков бьётся окружность отверстия
const MAX_EDGE_MM = 4;    // предел длины ребра в миллиметрах: длиннее — треугольник
                          // срезает хорду по кривой стенке, и заплата проваливается
                          // (прогиб хорды ≈ L²/8R: при 4 мм и R 70 это 0.03 мм)

/* Дробление треугольников, пока они не лягут на кривизну. Длина считается
   в миллиметрах: столбец и строка сетки — величины разного масштаба. */
function subdivide(tris, mmU, mmV) {
  let cur = tris;
  for (let pass = 0; pass < 14; pass++) {
    let split = false;
    const next = [];
    for (const t of cur) {
      const len = (a, b) => Math.hypot((a.x - b.x) * mmU, (a.y - b.y) * mmV);
      const e = [len(t[0], t[1]), len(t[1], t[2]), len(t[2], t[0])];
      const m = Math.max(e[0], e[1], e[2]);
      if (m <= MAX_EDGE_MM) { next.push(t); continue; }
      split = true;
      const k = e.indexOf(m);                    // делим пополам самое длинное ребро
      const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3];
      const mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
      next.push([a, mid, c], [mid, b, c]);
    }
    cur = next;
    if (!split) break;
  }
  return cur;
}

/* Пересчёт «миллиметры по поверхности» → параметры участка. */
function mapper(path, segments, sp, jFrom, jTo) {
  const uOf = dx => sp.uc - segments * dx / (sp.r0 * Math.PI * 2);
  const vOf = dy => rowOfY(path, jFrom, jTo, sp.y0 + dy);
  return {uOf, vOf};
}

/* Треугольники одного участка: прямоугольник с круглыми дырками.
   Границы берутся ровно те, по которым тело вращения выбросило клетки, —
   иначе между заплатой и телом остаётся щель. */
function patchGeometry(path, segments, sp, jFrom, jTo, j0, j1, flip) {
  const {uOf, vOf} = mapper(path, segments, sp, jFrom, jTo);
  const u0 = sp.box.i0, u1 = sp.box.i1;
  const v0 = Math.min(j0, j1), v1 = Math.max(j0, j1);
  const shape = new THREE.Shape([
    new THREE.Vector2(u0, v0),
    new THREE.Vector2(u1, v0),
    new THREE.Vector2(u1, v1),
    new THREE.Vector2(u0, v1),
  ]);
  shape.holes = sp.holes.map(h => {
    const pts = [];
    for (let k = 0; k < RIM_SEGS; k++) {
      const a = k / RIM_SEGS * Math.PI * 2;
      pts.push(new THREE.Vector2(uOf(h.x + Math.cos(a) * h.r), vOf(h.y + Math.sin(a) * h.r)));
    }
    return new THREE.Path(pts);
  });

  const flat = new THREE.ShapeGeometry(shape, 1);
  const fp = flat.attributes.position, fi = flat.index.array;
  const tris = [];
  for (let i = 0; i < fi.length; i += 3) {
    const t = [0, 1, 2].map(k => ({x: fp.getX(fi[i + k]), y: fp.getY(fi[i + k])}));
    tris.push(flip ? [t[0], t[2], t[1]] : t);
  }
  flat.dispose();

  // масштаб параметров: сколько миллиметров в столбце и в точке контура
  const mmU = sp.r0 * Math.PI * 2 / segments;
  const jm = Math.max(0, Math.min(path.length - 2, Math.floor((v0 + v1) / 2)));
  const mmV = Math.max(0.2, Math.hypot(path[jm + 1].x - path[jm].x, path[jm + 1].y - path[jm].y));
  const fine = subdivide(tris, mmU, mmV);
  const pos = new Float32Array(fine.length * 9), nor = new Float32Array(fine.length * 9);
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  fine.forEach((t, i) => {
    t.forEach((p, k) => {
      surfacePoint(path, segments, p.x, p.y, v);
      surfaceNormal(path, segments, p.x, p.y, nv);
      const o = (i * 3 + k) * 3;
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      nor[o] = nv.x; nor[o + 1] = nv.y; nor[o + 2] = nv.z;
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(Array.from({length: fine.length * 3}, (_, i) => i));
  return geo;
}

/* Стенки самих отверстий: кольцо между наружной и внутренней поверхностью. */
function boreGeometry(path, segments, sp, jOutFrom, jOutTo, jInFrom, jInTo) {
  const mo = mapper(path, segments, sp, jOutFrom, jOutTo);
  const mi = mapper(path, segments, sp, jInFrom, jInTo);
  const pos = [], idx = [];
  const v = new THREE.Vector3();
  let base = 0;
  for (const h of sp.holes) {
    for (let k = 0; k < RIM_SEGS; k++) {
      const a = k / RIM_SEGS * Math.PI * 2;
      const dx = h.x + Math.cos(a) * h.r, dy = h.y + Math.sin(a) * h.r;
      surfacePoint(path, segments, mo.uOf(dx), mo.vOf(dy), v);
      pos.push(v.x, v.y, v.z);
      surfacePoint(path, segments, mi.uOf(dx), mi.vOf(dy), v);
      pos.push(v.x, v.y, v.z);
    }
    for (let k = 0; k < RIM_SEGS; k++) {
      const a = base + k * 2, b = base + ((k + 1) % RIM_SEGS) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    base += RIM_SEGS * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Одна геометрия на все ситечки формы (или null, если их нет). */
export function strainerGeometry(path, segments, specs) {
  if (!specs || !specs.length) return null;
  const jRim = rimIndex(path);
  const parts = [];
  for (const sp of specs) {
    parts.push(patchGeometry(path, segments, sp, 0, jRim, sp.box.jOut0, sp.box.jOut1, false));
    parts.push(patchGeometry(path, segments, sp, path.length - 1, jRim, sp.box.jIn0, sp.box.jIn1, true));
    parts.push(boreGeometry(path, segments, sp, 0, jRim, path.length - 1, jRim));
  }
  // сшивка в один буфер: отдельные меши тут не нужны, материал у всех общий
  let vc = 0, ic = 0;
  for (const g of parts) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += g.attributes.position.count; io += gi.length;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}
