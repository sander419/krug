// file: js/core/parts.js
// Прилепы: геометрия, масса, уровень налива и замечания. Чистая математика —
// ни DOM, ни сцены. Заменяет прежний одиночный handle.js: ручек может быть
// несколько, а носик подчиняется тем же правилам прилепа, но добавляет своё —
// он определяет, до какого уровня изделие вообще наливается.
//
// Пороги в замечаниях — умолчания инструмента, а не отраслевой норматив,
// и в текстах это сказано.
import * as THREE from 'three';
import { radiusAt } from './math.js';
import { PART_KINDS, kindOf, limitOf } from '../config/parts.js';
import { strainerWarnings } from './strainer.js';
import { clamp, round } from './util.js';
import { tune } from './tuning.js';

/* Пороги замечаний переехали в реестр настроек: у каждой мастерской своя
   практика, и чужая цифра в коде спорила с ней молча. */
const GRIP_MIN = () => tune('gripMM');
const JOIN_SPAN_MIN = () => tune('joinSpanMM');
const AZ_MIN = () => tune('azMinDeg');

/** Угол между азимутами, 0…180. */
export const azGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Новый прилеп с умолчаниями вида. Азимут — самое свободное место на окружности:
    ставить второй прилеп поверх первого никто не хочет. */
export function makePart(kind, existing = []) {
  const k = PART_KINDS[kind] ? kind : 'handle';
  const taken = (existing || []).map(p => p.az || 0);
  let az = 0, best = -1;
  for (let a = 0; a < 360; a += 5) {
    const d = taken.length ? Math.min(...taken.map(t => azGap(a, t))) : 360;
    if (d > best) { best = d; az = a; }
  }
  return {id: 'p' + Math.random().toString(36).slice(2, 8), kind: k, az, ...PART_KINDS[k].defaults};
}

/** Привести значения к пределам: ДНК приходит извне, ей верить нельзя. */
/* ---------- нарисованная кривая прилепа ---------- */
/* Ползунками задают ручку «вообще»: два прилепа и вылет. Настоящая ручка так
   не описывается — у неё есть характер, и рисуется он на чертеже, как профиль.
   Поэтому у прилепа может быть своя кривая: массив точек вдоль детали.
   Точка хранится не в миллиметрах от оси, а парой «доля высоты — отступ от
   стенки»: стенка двигается, когда меняют диаметр или силуэт, и прилеп обязан
   ехать вместе с ней, а не отрываться. */
const PATH_MAX = 24;
const T_LIM = [-0.5, 2];        // доли высоты: носик задирается выше кромки
const D_LIM = [-40, 300];       // мм от стенки: минус — утоплен в стенку

export function sanitizePath(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const q of raw) {
    const t = +(q && q.t), d = +(q && q.d);
    if (!Number.isFinite(t) || !Number.isFinite(d)) return null;
    out.push({t: round(clamp(t, T_LIM[0], T_LIM[1])), d: round(clamp(d, D_LIM[0], D_LIM[1]), 2)});
    if (out.length === PATH_MAX) break;
  }
  return out.length >= 3 ? out : null;
}

/** Точки нарисованной кривой в миллиметрах сечения. */
export function pathPoints(prof, p) {
  const H = prof[prof.length - 1].y;
  return p.path.map(q => ({x: Math.max(0, radiusAt(prof, q.t * H) + q.d), y: q.t * H}));
}

/** Снять кривую с параметров: с этого начинается правка руками. */
export function pathFromParams(prof, p, n) {
  const H = prof[prof.length - 1].y;
  const curve = partCurve(prof, {...p, path: null});
  const k = n || (p.kind === 'spout' ? 5 : 7);
  const out = [];
  for (let i = 0; i < k; i++) {
    const v = curve.getPointAt(i / (k - 1));
    const t = H > 0 ? v.y / H : 0;
    out.push({t: round(clamp(t, T_LIM[0], T_LIM[1])),
              d: round(clamp(v.x - radiusAt(prof, v.y), D_LIM[0], D_LIM[1]), 2)});
  }
  return out;
}

/**
 * Штрих на чертеже — в кривую прилепа. В миллиметрах сечения, как рисовали.
 * В отличие от профиля тут нельзя сортировать по высоте: ручка идёт вверх,
 * наружу и обратно вниз — высота у неё не монотонна и монотонной быть не должна.
 * Поэтому штрих прореживается как двумерная кривая, а концы сажаются на стенку.
 */
export function pathFromStroke(prof, p, mm) {
  if (!Array.isArray(mm) || mm.length < 4) return null;
  const H = prof[prof.length - 1].y || 1;
  let len = 0;
  for (let i = 1; i < mm.length; i++) len += Math.hypot(mm[i].x - mm[i - 1].x, mm[i].y - mm[i - 1].y);
  if (len < 15) return null;                       // мазок, а не деталь

  let keep = simplify2d(mm, 1.5), tol = 1.5;
  while (keep.length > 12 && tol < 12) { tol *= 1.6; keep = simplify2d(mm, tol); }
  if (keep.length < 3) return null;

  let path = keep.map(q => ({t: q.y / H, d: q.x - radiusAt(prof, q.y)}));
  // носик ведут от стенки наружу; нарисовали наоборот — развернём
  if (p.kind === 'spout' ? path[path.length - 1].d < path[0].d
                         : path[path.length - 1].t > path[0].t) path.reverse();
  if (Math.max(...path.map(q => q.d)) < 5) return null;   // кривая легла на стенку

  const sink = p.kind === 'spout' ? -1.5 : -(p.thick || 10) * 0.25;
  path[0].d = sink;
  if (p.kind !== 'spout') path[path.length - 1].d = sink;  // у ручки на стенке оба конца
  return sanitizePath(path);
}

/* Рамер—Дуглас—Пекер по двум координатам: та же математика, что у профиля,
   но здесь кривая может заворачиваться, поэтому расстояние честно двумерное. */
function simplify2d(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  let far = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
    if (d > dmax) { dmax = d; far = i; }
  }
  if (dmax <= tol) return [a, b];
  return simplify2d(pts.slice(0, far + 1), tol).slice(0, -1).concat(simplify2d(pts.slice(far), tol));
}

/* Ползунки формы остаются правдой и при нарисованной кривой: числа в панели,
   замечания и техкарта читают их, а не кривую. Поэтому после каждой правки
   они пересчитываются по кривой, а не расходятся с ней. */
export function syncFieldsFromPath(prof, p) {
  if (!p.path) return p;
  const H = prof[prof.length - 1].y || 1;
  const ts = p.path.map(q => q.t), ds = p.path.map(q => q.d);
  if (p.kind === 'handle') {
    p.top = clamp(Math.max(...ts), 0.2, 1);
    p.bot = clamp(Math.min(...ts), 0.05, 0.9);
    p.out = clamp(Math.round(Math.max(...ds)), 15, 90);
  } else if (p.kind === 'spout') {
    const root = p.path[0], tip = p.path[p.path.length - 1];
    p.at = clamp(root.t, 0.15, 0.98);
    const pts = pathPoints(prof, p);
    const a = pts[0], b = pts[pts.length - 1];
    p.len = clamp(Math.round(Math.hypot(b.x - a.x, b.y - a.y)), 20, 140);
    p.rise = clamp(Math.round(Math.atan2(b.y - a.y, Math.max(b.x - a.x, 1e-6)) * 180 / Math.PI), -10, 60);
  }
  return p;
}

export function sanitizePart(raw) {
  const kind = PART_KINDS[raw && raw.kind] ? raw.kind : 'handle';
  const def = PART_KINDS[kind].defaults;
  const out = {id: String(raw.id || 'p' + Math.random().toString(36).slice(2, 8)), kind, az: 0};
  for (const f of ['az', ...PART_KINDS[kind].fields.filter(x => x !== 'az')]) {
    const L = limitOf(kind, f);
    const src = raw[f] !== undefined ? +raw[f] : (f === 'az' ? 0 : def[f]);
    const val = Number.isFinite(src) ? src : (f === 'az' ? 0 : def[f]);
    out[f] = f === 'top' || f === 'bot' || f === 'at'
      ? clamp(val, L.min / 100, L.max / 100)          // доли высоты храним 0…1
      : clamp(val, L.min, L.max);
  }
  // слив — не тело, а отгиб кромки: рисовать там нечего
  const path = kind === 'lip' ? null : sanitizePath(raw && raw.path);
  if (path) out.path = path;
  return out;
}

/* ---------- геометрия ---------- */

/** Дуга ручки в плоскости (радиус, высота). */
function handleCurve(prof, p) {
  const H = prof[prof.length - 1].y;
  const yT = Math.max(p.top, p.bot) * H, yB = Math.min(p.top, p.bot) * H;
  const rT = radiusAt(prof, yT), rB = radiusAt(prof, yB), rM = radiusAt(prof, (yT + yB) / 2);
  const span = yT - yB;
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(rT - p.thick * 0.25, yT, 0),
    new THREE.Vector3(rT + p.out * 0.55, yT + span * 0.08, 0),
    new THREE.Vector3(rM + p.out, (yT + yB) / 2, 0),
    new THREE.Vector3(rB + p.out * 0.45, yB + span * 0.04, 0),
    new THREE.Vector3(rB - p.thick * 0.25, yB, 0),
  ], false, 'catmullrom', 0.4);
}

/** Ось носика: из стенки наружу и вверх под заданным подъёмом. */
function spoutCurve(prof, p) {
  const H = prof[prof.length - 1].y;
  const y0 = p.at * H, r0 = radiusAt(prof, y0);
  const a = p.rise * Math.PI / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  return new THREE.CatmullRomCurve3([
    // носик садится на стенку снаружи, а не проваливается внутрь: внутри
    // остаётся стенка с ситечком, иначе труба торчала бы в чайник
    new THREE.Vector3(r0 - 1.5, y0, 0),
    new THREE.Vector3(r0 + p.len * 0.35 * dx, y0 + p.len * 0.30 * dy, 0),
    new THREE.Vector3(r0 + p.len * 0.72 * dx, y0 + p.len * 0.68 * dy, 0),
    new THREE.Vector3(r0 + p.len * dx, y0 + p.len * dy, 0),
  ], false, 'catmullrom', 0.3);
}

/** Слив геометрии не имеет — он деформирует кромку. Кривая нужна только для
    подписи в списке, поэтому это короткий отрезок наружу на месте отгиба. */
function lipCurve(prof, p) {
  const H = prof[prof.length - 1].y, r = radiusAt(prof, H);
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(r, H, 0),
    new THREE.Vector3(r + (p.out || 0), H - (p.drop || 0), 0),
  ]);
}

export function partCurve(prof, p) {
  if (p.path && p.path.length >= 3)
    return new THREE.CatmullRomCurve3(
      pathPoints(prof, p).map(q => new THREE.Vector3(q.x, q.y, 0)), false, 'catmullrom', 0.4);
  if (p.kind === 'spout') return spoutCurve(prof, p);
  if (p.kind === 'lip') return lipCurve(prof, p);
  return handleCurve(prof, p);
}

/** Полутолщина сечения вдоль детали и отношение ширины к толщине. */
export function partSection(p) {
  if (p.kind === 'spout') {
    return {rAt: t => (p.bore / 2) * (1 - t) + (p.tip / 2) * t, ratio: 1};
  }
  if (p.kind === 'lip') return {rAt: () => 0.5, ratio: 1};
  // у ручки прилепы чуть толще середины: так её и примазывают
  return {rAt: t => (p.thick / 2) * (1 + 0.18 * Math.pow(2 * t - 1, 4)), ratio: p.wide / p.thick};
}

/* ---------- числа ---------- */

export function partMetrics(prof, p) {
  const curve = partCurve(prof, p);
  const len = curve.getLength();
  const sec = partSection(p);
  // объём как интеграл эллиптического сечения по длине
  const N = 24;
  let area = 0;
  for (let i = 0; i <= N; i++) {
    const r = sec.rAt(i / N);
    area += Math.PI * r * r * sec.ratio * (i === 0 || i === N ? 0.5 : 1);
  }
  area /= N;
  const H = prof[prof.length - 1].y;
  const rootY = p.path ? Math.min(...p.path.map(q => q.t)) * H
              : p.kind === 'spout' ? p.at * H : Math.min(p.top, p.bot) * H;
  const tip = curve.getPoint(1);
  return {len, volMl: p.kind === 'lip' ? 0 : len * area / 1000,
          grip: p.kind === 'handle' ? p.out - p.thick : 0,
          rootY, tipY: tip.y, reach: tip.x};
}

export function partsVolumeMl(prof, parts) {
  // слив глины не добавляет: это отогнутая стенка, а не приставная деталь
  return (parts || []).filter(p => p.kind !== 'lip')
    .reduce((s, p) => s + partMetrics(prof, p).volMl, 0);
}

/** До какого уровня наливается изделие: ниже корня носика или ниже опущенной
    сливом кромки — что раньше. */
export function fillLevelY(prof, parts) {
  const H = prof[prof.length - 1].y;
  let y = H;
  for (const p of parts || []) {
    if (p.kind === 'spout') y = Math.min(y, p.at * H);
    if (p.kind === 'lip') y = Math.min(y, H - (p.drop || 0));
  }
  return y;
}

/** Что именно режет налив: носик или слив. */
export function fillLimitedBy(prof, parts) {
  const H = prof[prof.length - 1].y;
  let y = H, kind = null;
  for (const p of parts || []) {
    const lvl = p.kind === 'spout' ? p.at * H : p.kind === 'lip' ? H - (p.drop || 0) : H;
    if (lvl < y - 0.001) { y = lvl; kind = p.kind; }
  }
  return kind;
}

/* ---------- замечания ---------- */

/** Станции вдоль детали: точка, нормаль в плоскости детали, полуоси сечения. */
export function partStations(prof, part, n = 64) {
  const curve = partCurve(prof, part), sec = partSection(part);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t), d = curve.getTangentAt(t);
    const len = Math.hypot(d.x, d.y) || 1;
    out.push({x: p.x, y: p.y, nx: -d.y / len, ny: d.x / len,
              r: sec.rAt(t), rz: sec.rAt(t) * sec.ratio});
  }
  return out;
}

/** Контур детали на плоскости разъёма: рельсы плюс центры торцов. */
export function partOutline(st) {
  const N = st.length - 1;
  const side = k => st.map(s => ({x: s.x + k * s.nx * s.r, y: s.y + k * s.ny * s.r}));
  return side(1).concat([{x: st[N].x, y: st[N].y}],
                        side(-1).reverse(), [{x: st[0].x, y: st[0].y}]);
}

/** Сколько раз замкнутая ломаная пересекает сама себя. */
export function pathSelfCross(path) {
  const side = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  let n = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    for (let j = i + 2; j < path.length; j++) {
      if (i === 0 && j === path.length - 1) continue;
      const c = path[j], d = path[(j + 1) % path.length];
      if (((side(a, b, c) > 0) !== (side(a, b, d) > 0)) &&
          ((side(c, d, a) > 0) !== (side(c, d, b) > 0))) n++;
    }
  }
  return n;
}

/* Деталь, пересёкшая сама себя: сечение шире, чем позволяет изгиб, и протяжка
   входит в себя же. Форму под такую деталь не построить — канавка сворачивается
   в узел, а гипс в узел не заливается. Считаем не приближение, а тот самый
   контур, по которому потом режется разъём: он и есть предмет спора. */
export function partSelfOverlap(prof, part) {
  if (kindOf(part).deform) return false;
  return pathSelfCross(partOutline(partStations(prof, part))) > 0;
}

export function partsWarnings(state, prof) {
  const parts = state.parts || [];
  if (!parts.length) return [];
  const w = [];
  const H = prof[prof.length - 1].y;

  parts.forEach((p, i) => {
    const m = partMetrics(prof, p);
    const label = `${kindOf(p).name} ${i + 1}`;
    if (partSelfOverlap(prof, p))
      w.push({lvl: 'bad', help: p.kind === 'spout' ? 'spout' : 'handle', txt:
        `${label}: пересекает сама себя — сечение шире, чем позволяет изгиб. Форма под неё не строится: ` +
        `канавка сворачивается в узел. Уменьшите сечение или увеличьте вылет.`});
    if (p.kind === 'handle') {
      const span = Math.abs(p.top - p.bot) * H;
      if (p.thick < state.wall * 0.9)
        w.push({lvl: 'bad', help: 'handle', txt:
          `${label}: лента тоньше стенки (${p.thick} против ${state.wall} мм) — оторвётся по шву ещё при сушке.`});
      else if (p.thick > state.wall * 2.2)
        w.push({lvl: 'warn', help: 'handle', txt:
          `${label}: лента вдвое толще стенки — сохнет медленнее корпуса, шов тянет. Сушите под плёнкой.`});
      if (m.grip < GRIP_MIN())
        w.push({lvl: 'warn', help: 'handle', txt:
          `${label}: просвет под пальцы ${m.grip.toFixed(0)} мм — рука не пройдёт. Порог инструмента ${GRIP_MIN()} мм.`});
      if (span < JOIN_SPAN_MIN())
        w.push({lvl: 'warn', help: 'handle', txt:
          `${label}: прилепы в ${span.toFixed(0)} мм друг от друга — держаться не за что.`});
    } else if (p.kind === 'lip') {
      if (state.wall > 8)
        w.push({lvl: 'warn', help: 'spout', txt:
          `${label}: стенка ${state.wall} мм — толстую кромку пальцем не оттянуть, слив выйдет мятым. Порог инструмента 8 мм.`});
      if ((p.drop || 0) < 2)
        w.push({lvl: 'warn', help: 'spout', txt:
          `${label}: кромка не опущена — сливу неоткуда литься, вода пойдёт по всему краю.`});
      if (p.width > 60)
        w.push({lvl: 'warn', help: 'spout', txt:
          `${label}: слив шире 60° — струя расходится и бежит по стенке. Узкий слив льёт точнее.`});
      if (!state.hollow)
        w.push({lvl: 'warn', help: 'spout', txt: `${label}: у сплошной формы нет кромки, которую можно оттянуть.`});
    } else {
      if (m.tipY < p.at * H + 2)
        w.push({lvl: 'warn', help: 'spout', txt:
          `${label}: срез ниже корня — потечёт мимо. Поднимите носик.`});
      if (p.tip >= p.bore)
        w.push({lvl: 'warn', help: 'spout', txt:
          `${label}: срез не уже корня — струя разбивается, польётся по корпусу.`});
      if (p.bore > state.wall * 4)
        w.push({lvl: 'warn', help: 'spout', txt:
          `${label}: корень ${p.bore} мм при стенке ${state.wall} мм — шов длинный и тонкий, трескается первым.`});
      const rim = H;
      if (m.tipY > rim + 2)
        w.push({lvl: 'warn', help: 'spout', txt:
          `${label}: срез выше кромки на ${(m.tipY - rim).toFixed(0)} мм — при наклоне польётся через край раньше, чем из носика.`});
    }
  });

  for (const sw of strainerWarnings(state)) w.push(sw);

  // прилепы не должны налезать друг на друга
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const d = azGap(parts[i].az, parts[j].az);
      if (d < AZ_MIN())
        w.push({lvl: 'warn', help: 'handle', txt:
          `${kindOf(parts[i]).name} ${i + 1} и ${kindOf(parts[j]).name} ${j + 1} стоят в ${d.toFixed(0)}° друг от друга — прилепы сольются. Разведите хотя бы на ${AZ_MIN()}°.`});
    }

  return w;
}

/** Сколько ручной работы добавляют прилепы: минут на изделие. */
export const HAND_MIN_PER_PART = {handle: 4, spout: 6, lip: 2};
export function partsHandMinutes(parts) {
  return (parts || []).reduce((s, p) => s + (HAND_MIN_PER_PART[p.kind] || 4), 0);
}
