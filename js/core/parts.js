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
import { PART_KINDS, PART_LIMITS, kindOf } from '../config/parts.js';
import { strainerWarnings } from './strainer.js';
import { clamp } from './util.js';

const GRIP_MIN = 25;        // мм: меньше — рука не проходит
const JOIN_SPAN_MIN = 40;   // мм: ближе прилепы — держаться не за что
const AZ_MIN = 25;          // °: ближе друг к другу — прилепы сливаются

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
export function sanitizePart(raw) {
  const kind = PART_KINDS[raw && raw.kind] ? raw.kind : 'handle';
  const def = PART_KINDS[kind].defaults;
  const out = {id: String(raw.id || 'p' + Math.random().toString(36).slice(2, 8)), kind, az: 0};
  for (const f of ['az', ...PART_KINDS[kind].fields.filter(x => x !== 'az')]) {
    const L = PART_LIMITS[f];
    const src = raw[f] !== undefined ? +raw[f] : (f === 'az' ? 0 : def[f]);
    const val = Number.isFinite(src) ? src : (f === 'az' ? 0 : def[f]);
    out[f] = f === 'top' || f === 'bot' || f === 'at'
      ? clamp(val, L.min / 100, L.max / 100)          // доли высоты храним 0…1
      : clamp(val, L.min, L.max);
  }
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
  const rootY = p.kind === 'spout' ? p.at * H : Math.min(p.top, p.bot) * H;
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
      if (m.grip < GRIP_MIN)
        w.push({lvl: 'warn', help: 'handle', txt:
          `${label}: просвет под пальцы ${m.grip.toFixed(0)} мм — рука не пройдёт. Порог инструмента ${GRIP_MIN} мм.`});
      if (span < JOIN_SPAN_MIN)
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
      if (d < AZ_MIN)
        w.push({lvl: 'warn', help: 'handle', txt:
          `${kindOf(parts[i]).name} ${i + 1} и ${kindOf(parts[j]).name} ${j + 1} стоят в ${d.toFixed(0)}° друг от друга — прилепы сольются. Разведите хотя бы на ${AZ_MIN}°.`});
    }

  return w;
}

/** Сколько ручной работы добавляют прилепы: минут на изделие. */
export const HAND_MIN_PER_PART = {handle: 4, spout: 6, lip: 2};
export function partsHandMinutes(parts) {
  return (parts || []).reduce((s, p) => s + (HAND_MIN_PER_PART[p.kind] || 4), 0);
}
