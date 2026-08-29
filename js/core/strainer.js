// file: js/core/strainer.js
// Отверстие под носик и ситечко. У чайника носик не приставляют к глухой стенке:
// под ним прорезают либо одно отверстие, либо решето из мелких — чтобы заварка
// осталась в чайнике, а чай тёк.
//
// Главное число здесь не картинка, а живое сечение: суммарная площадь дырочек
// ситечка должна быть не меньше проходного сечения носика, иначе чайник «душит»
// струю и льёт тонко.
//
// Геометрия строится не булевой операцией (её в проекте нет и не будет), а
// заменой куска поверхности: из тела вращения выбрасывается прямоугольник
// параметров (столбец × точка контура), а на его место кладётся тот же участок,
// заново разбитый на треугольники — уже с дырками. Поэтому шов совпадает
// вершина в вершину, а границы отверстий получаются круглыми, а не ступенчатыми.
import * as THREE from 'three';
import { radiusAt } from './math.js';

const MARGIN = 1.35;      // во сколько раз участок замены шире поля отверстий

/** Индекс точки контура, где находится кромка: до неё наружная стенка, после — внутренняя. */
export function rimIndex(path) {
  let j = 0, best = -Infinity;
  for (let i = 0; i < path.length; i++) if (path[i].y > best) { best = path[i].y; j = i; }
  return j;
}

/** Дробный индекс точки контура для высоты y на участке [a..b] (y монотонна). */
export function rowOfY(path, a, b, y) {
  const step = b > a ? 1 : -1;
  for (let j = a; j !== b; j += step) {
    const y0 = path[j].y, y1 = path[j + step].y;
    if ((y - y0) * (y - y1) <= 0 && Math.abs(y1 - y0) > 1e-9)
      return j + step * (y - y0) / (y1 - y0);
  }
  return b;
}

/** Точка поверхности по дробным (столбец, точка контура). */
export function surfacePoint(path, segments, u, v, out = new THREE.Vector3()) {
  const j0 = Math.max(0, Math.min(path.length - 2, Math.floor(v)));
  const f = v - j0;
  const r = path[j0].x + (path[j0 + 1].x - path[j0].x) * f;
  const y = path[j0].y + (path[j0 + 1].y - path[j0].y) * f;
  const phi = u / segments * Math.PI * 2;
  return out.set(r * Math.sin(phi), y, r * Math.cos(phi));
}

/** Нормаль поверхности в тех же параметрах. Считается по контуру, как в
    core/lathe.js: если брать усреднённые нормали треугольников заплаты, на её
    границе появляется видимый шов — соседние треугольники тела считают иначе. */
export function surfaceNormal(path, segments, u, v, out = new THREE.Vector3()) {
  const j = Math.max(0, Math.min(path.length - 2, Math.floor(v)));
  let ax = 0, ay = 0;
  const seg = (a, b) => {
    const dx = path[b].x - path[a].x, dy = path[b].y - path[a].y;
    const l = Math.hypot(dx, dy) || 1;
    ax += dy / l; ay += -dx / l;
  };
  seg(j, j + 1);
  if (j + 2 < path.length) seg(j + 1, j + 2);
  const l = Math.hypot(ax, ay) || 1;
  const phi = u / segments * Math.PI * 2;
  return out.set(ax / l * Math.sin(phi), ay / l, ax / l * Math.cos(phi));
}

/**
 * Разметка ситечка для одного носика.
 * @returns null, если строить нечего (нет полости, носик у самого дна и т. п.)
 */
/** Раскладка дырочек ситечка. Зависит только от носика, поэтому считается
    и для замечаний, где ни контура, ни сетки ещё нет. */
export function strainerHoles(p) {
  const bore = p.bore;
  const n = Math.max(0, Math.round(p.mesh ?? 7));
  const field = bore * 0.46;                       // радиус поля отверстий, мм
  const holes = [];
  if (n <= 1) {
    holes.push({x: 0, y: 0, r: bore * 0.42});
  } else {
    const d = Math.max(2, bore / (n <= 5 ? 4.2 : 5.4));   // диаметр дырочки
    holes.push({x: 0, y: 0, r: d / 2});
    const ring = n - 1, R = field - d * 0.75;
    for (let k = 0; k < ring; k++) {
      const a = k / ring * Math.PI * 2;
      holes.push({x: Math.cos(a) * R, y: Math.sin(a) * R, r: d / 2});
    }
  }
  const openArea = holes.reduce((s, h) => s + Math.PI * h.r * h.r, 0);
  const boreArea = Math.PI * Math.pow(bore / 2, 2);
  return {holes, field, openArea, boreArea, ratio: openArea / boreArea,
          count: holes.length, holeD: holes[0].r * 2};
}

export function strainerSpec(prof, path, segments, p, wall) {
  if (p.kind !== 'spout') return null;
  const H = prof[prof.length - 1].y;
  const y0 = p.at * H;
  const r0 = radiusAt(prof, y0);
  if (!(r0 > 5)) return null;

  const {holes, field, openArea, boreArea} = strainerHoles(p);

  // участок замены: с запасом вокруг поля отверстий, но в пределах стенки
  const half = field * MARGIN + 2;
  const jRim = rimIndex(path);
  const yTop = Math.min(H - 0.5, y0 + half), yBot = Math.max(path[0].y + 0.5, y0 - half);
  const vOutA = rowOfY(path, 0, jRim, yBot), vOutB = rowOfY(path, 0, jRim, yTop);
  const vInA = rowOfY(path, path.length - 1, jRim, yBot), vInB = rowOfY(path, path.length - 1, jRim, yTop);

  const az = (p.az || 0) * Math.PI / 180;
  const uc = segments * (Math.PI / 2 - az) / (Math.PI * 2);
  const du = segments * (half / r0) / (Math.PI * 2);

  const box = {
    i0: Math.floor(uc - du) - 1, i1: Math.ceil(uc + du) + 1,
    jOut0: Math.max(0, Math.floor(Math.min(vOutA, vOutB)) - 1),
    jOut1: Math.min(jRim, Math.ceil(Math.max(vOutA, vOutB)) + 1),
    jIn0: Math.max(jRim, Math.floor(Math.min(vInA, vInB)) - 1),
    jIn1: Math.min(path.length - 1, Math.ceil(Math.max(vInA, vInB)) + 1),
  };
  if (box.jOut1 - box.jOut0 < 2 || box.jIn1 - box.jIn0 < 2) return null;

  return {
    uc, r0, y0, holes, field, openArea, boreArea, box, segments,
    ratio: openArea / boreArea,
    holeCount: holes.length,
    holeD: holes[0] ? holes[0].r * 2 : 0,
  };
}

/** Замечания по ситечку: льёт ли чайник и не забьётся ли решето. */
export function strainerWarnings(state) {
  const w = [];
  (state.parts || []).filter(x => x.kind === 'spout').forEach((p, i) => {
    const sp = strainerHoles(p);
    const label = `Ситечко ${i + 1}`;
    if (sp.ratio < 1)
      w.push({lvl: 'warn', help: 'spout', txt:
        `${label}: живое сечение ${(sp.ratio * 100).toFixed(0)} % от носика — чайник будет душить струю. Увеличьте число отверстий или сам носик.`});
    if (sp.holeD > 0 && sp.holeD < 2.5 && sp.count > 1)
      w.push({lvl: 'warn', help: 'spout', txt:
        `${label}: дырочки ${sp.holeD.toFixed(1)} мм — забьются заваркой и не прочистятся. Ниже 2,5 мм смысла нет.`});
    if (state.wall > 0 && sp.holeD > 0 && sp.count > 1 && sp.holeD < state.wall * 0.5)
      w.push({lvl: 'warn', help: 'spout', txt:
        `${label}: отверстие уже половины толщины стенки (${state.wall} мм) — это не дырка, а канал: не проколоть и не почистить.`});
  });
  return w;
}
