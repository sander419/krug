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

export function buildLathe(points, segments, reuse) {
  const n = points.length, rows = segments + 1;
  const vertCount = rows * n, triCount = segments * (n - 1) * 2;

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
