// file: js/core/lathe.js
// Тело вращения с переиспользованием буферов.
//
// Зачем свой вместо THREE.LatheGeometry: во время «Кинотеатра» форма пересобирается
// каждый кадр. Новая LatheGeometry на 72 сегмента и ~190 точек контура — это около
// мегабайта мусора на кадр, шестьдесят мегабайт в секунду и рывки от сборщика.
// Здесь при неизменной топологии буферы заполняются на месте, ничего не выделяется.
//
// Порядок вершин повторяет LatheGeometry: снаружи сегмент, внутри точка контура.
// Отсюда правило, на котором держатся тепловая карта и толщина глазури:
// индекс точки контура = индекс вершины % длина контура.
//
// Нормали считаются аналитически из касательной к контуру, как это делает и сама
// LatheGeometry: computeVertexNormals оставил бы шов на стыке первого и последнего
// сегмента. Обход контура — снизу вверх снаружи и сверху вниз изнутри, поэтому одна
// формула (dy, -dx) даёт наружу на внешней стенке и в полость на внутренней.
//
// Порядок обхода треугольников тоже как у LatheGeometry: по нему STL считает
// нормали фасетов, а слайсеры на вывернутых нормалях спотыкаются.
import * as THREE from 'three';

/** Попадает ли клетка (i, j) в один из вырезов. i считается по кругу. */
function isSkipped(skip, segments, i, j) {
  if (!skip || !skip.length) return false;
  for (const b of skip) {
    const w = ((i - b.i0) % segments + segments) % segments;
    if (w < ((b.i1 - b.i0) % segments + segments) % segments && j >= b.j0 && j < b.j1) return true;
  }
  return false;
}

/**
 * @param skip прямоугольники параметров, которые не заполняются треугольниками:
 *             на их место кладётся отдельный кусок поверхности с отверстиями.
 */
export function buildLathe(points, segments, reuse, skip) {
  const n = points.length, rows = segments + 1;
  const vertCount = rows * n;
  let triCount = 0;
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < n - 1; j++)
      if (!isSkipped(skip, segments, i, j)) triCount += 2;

  let geo = reuse;
  const fits = geo && geo.attributes.position && geo.attributes.position.count === vertCount
            && geo.index && geo.index.count === triCount * 3;
  if (!fits) {
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertCount * 2), 2));
    const idx = vertCount > 65535 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    let k = 0;
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < n - 1; j++) {
        if (isSkipped(skip, segments, i, j)) continue;
        const base = j + i * n;
        const a = base, b = base + n, c = base + n + 1, d = base + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = d;
        idx[k++] = c; idx[k++] = d; idx[k++] = b;
      }
    }
  }

  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const uv = geo.attributes.uv.array;

  /* нормаль контура в плоскости (r, y): усреднение соседних отрезков */
  const nr = new Float64Array(n), ny = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let ax = 0, ay = 0;
    if (j > 0) {
      const dx = points[j].x - points[j - 1].x, dy = points[j].y - points[j - 1].y;
      const l = Math.hypot(dx, dy) || 1;
      ax += dy / l; ay += -dx / l;
    }
    if (j < n - 1) {
      const dx = points[j + 1].x - points[j].x, dy = points[j + 1].y - points[j].y;
      const l = Math.hypot(dx, dy) || 1;
      ax += dy / l; ay += -dx / l;
    }
    const l = Math.hypot(ax, ay) || 1;
    nr[j] = ax / l; ny[j] = ay / l;
  }

  for (let i = 0; i <= segments; i++) {
    const phi = i / segments * Math.PI * 2;
    const sin = Math.sin(phi), cos = Math.cos(phi);
    const off = i * n;
    for (let j = 0; j < n; j++) {
      const v = (off + j) * 3, p = points[j];
      pos[v] = p.x * sin; pos[v + 1] = p.y; pos[v + 2] = p.x * cos;
      nor[v] = nr[j] * sin; nor[v + 1] = ny[j]; nor[v + 2] = nr[j] * cos;
      const t = (off + j) * 2;
      uv[t] = i / segments; uv[t + 1] = j / (n - 1);
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
  geo.attributes.uv.needsUpdate = true;
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/* Оттянутый слив: кромку в секторе отгибают наружу и опускают. Это не отдельное
   тело, а сама стенка — поэтому деформируются готовые вершины, а не контур.
   Азимут детали и угол сегмента связаны как phi = π/2 − az: в этом же порядке
   прилепы поворачиваются в сцене. */
export function applyLips(geo, pointCount, segments, lips, H, grow = 1) {
  if (!lips || !lips.length) return;
  const n = pointCount;
  const pos = geo.attributes.position.array;
  const zone = Math.min(30, H * 0.22);      // насколько вниз от кромки тянется отгиб
  const smooth = t => 1 - t * t * (3 - 2 * t);

  for (let i = 0; i <= segments; i++) {
    const phi = i / segments * Math.PI * 2;
    const sin = Math.sin(phi), cos = Math.cos(phi);
    let az = Math.PI / 2 - phi;
    az = ((az % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    for (const L of lips) {
      const lipAz = ((L.az || 0) * Math.PI / 180) % (Math.PI * 2);
      let d = Math.abs(az - lipAz);
      if (d > Math.PI) d = Math.PI * 2 - d;
      const half = Math.max((L.width || 30) * Math.PI / 360, 1e-3);
      if (d >= half) continue;
      const fA = smooth(d / half);
      for (let j = 0; j < n; j++) {
        const v = (i * n + j) * 3;
        const dy = H - pos[v + 1];
        if (dy >= zone || dy < 0) continue;
        const f = fA * smooth(dy / zone) * grow;
        if (f <= 0) continue;
        if (Math.hypot(pos[v], pos[v + 2]) < 0.05) continue;   // ось не трогаем
        pos[v] += (L.out || 0) * f * sin;
        pos[v + 2] += (L.out || 0) * f * cos;
        pos[v + 1] -= (L.drop || 0) * f;
      }
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  // первый и последний столбцы — одни и те же точки: без сшивки по шву видна полоса
  const nor = geo.attributes.normal.array;
  for (let j = 0; j < n; j++) {
    const a = j * 3, b = (segments * n + j) * 3;
    const x = nor[a] + nor[b], y = nor[a + 1] + nor[b + 1], z = nor[a + 2] + nor[b + 2];
    const l = Math.hypot(x, y, z) || 1;
    nor[a] = nor[b] = x / l; nor[a + 1] = nor[b + 1] = y / l; nor[a + 2] = nor[b + 2] = z / l;
  }
  geo.attributes.normal.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}
