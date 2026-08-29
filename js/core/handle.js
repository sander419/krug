// file: js/core/handle.js
// Ручка. До этого КРУГ считал только тела вращения — а кружка без ручки не кружка:
// ручка это 10–20 % массы, самый частый источник трещин по шву и причина, по которой
// изделие нельзя отформовать одним прессом. Считать её нужно вместе с корпусом.
//
// Форма ручки — дуга от верхнего прилепа наружу и вниз к нижнему. Сечение
// эллиптическое: по радиусу тоньше (thick), поперёк — шире (wide), как у ленты,
// которую отбивают из жгута.
import * as THREE from 'three';
import { radiusAt } from './math.js';

/** Опорные точки дуги ручки в плоскости (радиус, высота), мм. */
export function handlePoints(prof, h) {
  const H = prof[prof.length - 1].y;
  const yT = Math.max(h.top, h.bot) * H, yB = Math.min(h.top, h.bot) * H;
  const rT = radiusAt(prof, yT), rB = radiusAt(prof, yB), rM = radiusAt(prof, (yT + yB) / 2);
  const span = yT - yB;
  return [
    new THREE.Vector3(rT - h.thick * 0.25, yT, 0),
    new THREE.Vector3(rT + h.out * 0.55, yT + span * 0.08, 0),
    new THREE.Vector3(rM + h.out, (yT + yB) / 2, 0),
    new THREE.Vector3(rB + h.out * 0.45, yB + span * 0.04, 0),
    new THREE.Vector3(rB - h.thick * 0.25, yB, 0),
  ];
}

export function handleCurve(prof, h) {
  return new THREE.CatmullRomCurve3(handlePoints(prof, h), false, 'catmullrom', 0.4);
}

/** Длина дуги, объём (см³) и просвет под пальцы (мм). */
export function handleMetrics(prof, h) {
  if (!h || !h.on) return {len: 0, volMl: 0, grip: 0};
  const len = handleCurve(prof, h).getLength();
  const area = Math.PI / 4 * h.thick * h.wide;      // эллипс
  return {len, volMl: len * area / 1000, grip: h.out - h.thick};
}

/** Замечания по ручке: где она треснет и почему её не отформовать. */
export function handleWarnings(state, prof) {
  const h = state.handle;
  if (!h || !h.on) return [];
  const w = [];
  const H = prof[prof.length - 1].y;
  const span = Math.abs(h.top - h.bot) * H;
  const {grip} = handleMetrics(prof, h);

  if (h.thick < state.wall * 0.9)
    w.push({lvl: 'bad', help: 'handle', txt:
      `Ручка тоньше стенки (${h.thick} против ${state.wall} мм) — оторвётся по шву ещё при сушке.`});
  else if (h.thick > state.wall * 2.2)
    w.push({lvl: 'warn', help: 'handle', txt:
      `Ручка вдвое толще стенки — сохнет медленнее корпуса, и шов тянет. Сушите под плёнкой.`});
  if (grip < 25)
    w.push({lvl: 'warn', help: 'handle', txt:
      `Просвет под пальцы ${grip.toFixed(0)} мм — рука не пройдёт. Нужно от 25 мм, для кружки под кипяток — 30.`});
  if (span < 40)
    w.push({lvl: 'warn', help: 'handle', txt:
      `Прилепы всего в ${span.toFixed(0)} мм друг от друга — ручку не за что держать.`});
  return w;
}
