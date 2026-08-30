// file: js/three/castMould.js
// Форма для литья: половины, ярусы, литник, замки.
//
// Почему разъём вертикальный. Тело вращения разнимается двумя половинами всегда,
// каким бы пузатым оно ни было: половина снимается вбок, а не вверх, и завал
// профиля ей не мешает. Поднутрения, из-за которых жёсткой оснастке нужны три
// части, литью безразличны — это и есть причина, по которой сложные формы льют,
// а не штампуют.
//
// Почему ярусы. Гипсовая форма тяжелеет как объём: полуметровая ваза даёт
// половину под сорок килограммов, которую одному не поднять и не просушить.
// Такие формы делают секционными — режут поперёк, и каждый ярус это те же две
// половины. Порог веса части — настройка мастерской.
//
// Булевой операции не нужно: половина полости — половина протяжки, а грань
// блока — прямоугольник с вырезом по силуэту. Две грабли, на которые тут
// наступаешь обязательно:
//
//   1. Вырез, доходящий до края грани, — не дырка, а выемка в контуре: дырка,
//      касающаяся края, для earcut вырождена и даёт щели в теле.
//   2. Если полость проходит грань насквозь (у верхних ярусов), грань
//      распадается на две части — левую и правую от полости. Одним контуром
//      её не описать.
//
// Проверка направленных рёбер (tools/check-castmould.mjs) ловит и то, и другое:
// гипс льют по этой модели, а печатают по STL, и дырка в сетке не видна на глаз.
import * as THREE from 'three';
import { wareProfiles } from '../core/mould.js';
import { tune } from '../core/tuning.js';

const SEG = 48;           // шагов по половине окружности
const KEY_SEG = 20;       // шагов по окружности замка
const KEY_EDGE = 8;       // гипс между замком и краем блока, мм
export const PLASTER_KG_PER_L = 1.42;   // плотность залитого гипса, кг/л

const R = () => tune('funnelR'), FH = () => tune('funnelH');
const WALL = () => tune('castWall'), BASE = () => tune('castBase');
const KEY_R = () => tune('keyR'), KEY_H = () => tune('keyH'), KEY_CLEAR = () => tune('keyClear');
const MAX_KG = () => tune('partMaxKg');

/* ---------- профиль ---------- */

export function radiusAtY(line, y) {
  if (y <= line[0].y) return line[0].r;
  if (y >= line[line.length - 1].y) return line[line.length - 1].r;
  for (let i = 1; i < line.length; i++)
    if (line[i].y >= y) {
      const a = line[i - 1], c = line[i];
      const k = c.y > a.y ? (y - a.y) / (c.y - a.y) : 0;
      return a.r + (c.r - a.r) * k;
    }
  return 0;
}

/* Кусок контура между двумя высотами, с точками ровно на границах.
   Ниже донышка изделия полости нет: под ним сплошной гипс, поэтому диапазон
   обрезается собственными границами контура, а не только запросом. */
function clipProfile(line, y0, y1) {
  const a = Math.max(y0, line[0].y), c = Math.min(y1, line[line.length - 1].y);
  if (!(c > a)) return [];
  const out = [{r: radiusAtY(line, a), y: a}];
  for (const p of line) if (p.y > a + 1e-6 && p.y < c - 1e-6) out.push({r: p.r, y: p.y});
  out.push({r: radiusAtY(line, c), y: c});
  return out;
}

/** Габарит блока и опорные размеры — без построения меша. */
export function castMouldBlock(state) {
  const {outer, maxR, H} = wareProfiles(state);
  const wall = WALL(), base = BASE();
  const Rw = Math.max(maxR, R()) + wall;
  const yBot = -base, yTop = H + FH();
  const line = outer.map(p => ({r: p.r, y: p.y}));
  line.push({r: R(), y: yTop});                   // воронка — продолжение полости
  return {
    outer, line, maxR, H, Rw, halfW: Rw, yBot, yTop,
    funnelR: R(), funnelH: FH(), wall, base,
    blockMM: [2 * Rw, Rw, yTop - yBot],
    boxL: (2 * Rw) * Rw * (yTop - yBot) / 1e6,    // объём блока ОДНОЙ половины
  };
}

/* Объём половины полости между высотами, литры. */
function cavityL(line, y0, y1) {
  const seg = clipProfile(line, y0, y1);
  if (seg.length < 2) return 0;
  let v = 0;
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i - 1], c = seg[i];
    v += Math.PI * (c.y - a.y) * (a.r * a.r + a.r * c.r + c.r * c.r) / 3;
  }
  return v / 2 / 1e6;
}

/**
 * План формы: сколько ярусов и почему. Ярус — те же две половины, разрезанные
 * поперёк: часть тяжелее порога одному не поднять и дольше сушить.
 */
export function castPlan(state) {
  const b = castMouldBlock(state);
  const fullKg = (b.boxL - cavityL(b.line, b.yBot, b.yTop)) * PLASTER_KG_PER_L;
  const MAX = MAX_KG();

  /* Ярусы равной высоты весят по-разному: там, где полости меньше, гипса больше.
     Поэтому число ярусов не вычисляется делением, а подбирается — пока самый
     тяжёлый не уложится в порог. Иначе обещание «часть не тяжелее N кг»
     нарушалось бы ровно на том ярусе, где полость узкая. */
  const cut = n => {
    const step = (b.yTop - b.yBot) / n, out = [];
    for (let i = 0; i < n; i++) {
      const y0 = i === 0 ? b.yBot : b.yBot + step * i;
      const y1 = i === n - 1 ? b.yTop : b.yBot + step * (i + 1);
      const boxL = (2 * b.Rw) * b.Rw * (y1 - y0) / 1e6;
      const plasterL = boxL - cavityL(b.line, y0, y1);
      out.push({y0, y1, first: i === 0, last: i === n - 1, boxL, plasterL,
                kg: plasterL * PLASTER_KG_PER_L});
    }
    return out;
  };
  const LIMIT = 6;
  let tiers = Math.max(1, Math.min(LIMIT, Math.ceil(fullKg / MAX)));
  let list = cut(tiers);
  while (tiers < LIMIT && Math.max(...list.map(t => t.kg)) > MAX) list = cut(++tiers);

  return {
    block: b, tiers: list, parts: tiers * 2,
    heaviestKg: Math.max(...list.map(t => t.kg)),
    maxKg: MAX, fullKg,
    over: Math.max(...list.map(t => t.kg)) > MAX,
    why: tiers > 1
      ? `цельная половина весила бы ${fullKg.toFixed(1)} кг — тяжелее порога ${MAX} кг`
      : 'форма лёгкая, резать поперёк незачем',
  };
}

/* ---------- замки ---------- */

/* На разъёме: по углам яруса, но только там, где не задевают полость. */
function partingKeys(b, t) {
  const d = KEY_EDGE + KEY_R();
  const x = b.halfW - d;
  const out = [];
  for (const y of [t.y0 + d, t.y1 - d]) {
    if (!(y > t.y0 && y < t.y1)) continue;
    const r = radiusAtY(b.line, y);
    for (const sx of [-x, x]) if (Math.abs(sx) - KEY_R() - KEY_CLEAR() > r) out.push({x: sx, y});
  }
  return out;
}

/* На горизонтальном стыке ярусов: два штифта между полостью и краем. */
function jointKeys(b, y) {
  const r = radiusAtY(b.line, y);
  const x = (r + b.halfW) / 2;
  if (b.halfW - x < KEY_R() + KEY_EDGE || x - r < KEY_R() + KEY_CLEAR()) return [];
  return [{x: -x, z: -b.Rw / 2}, {x, z: -b.Rw / 2}];
}

/* ---------- геометрия одного яруса одной половины ---------- */

/**
 * @param opt {half:'bump'|'socket', tier:number}
 * Плоскость разъёма — z = 0, гипс уходит в минус, ось изделия лежит в плоскости.
 * Готовая половина кладётся разъёмом вверх: так она и лежит на верстаке.
 */
export function castMouldGeometry(state, opt = {}) {
  const socket = opt.half === 'socket';
  const plan = castPlan(state);
  const b = plan.block;
  const t = plan.tiers[Math.max(0, Math.min(plan.tiers.length - 1, opt.tier | 0))];
  const {halfW, Rw, line} = b;
  const D = -Rw;

  const pos = [];
  const tri = (a, c, d) => pos.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  const quad = (a, c, d, e) => { tri(a, c, d); tri(a, d, e); };
  const shapeTris = (shape, map, flip) => {
    const g = new THREE.ShapeGeometry(shape, 1);
    const p = g.attributes.position, idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const v = [0, 1, 2].map(k => map(p.getX(idx[i + k]), p.getY(idx[i + k])));
      flip ? tri(v[0], v[2], v[1]) : tri(v[0], v[1], v[2]);
    }
    g.dispose();
  };
  const keyPath = (kx, ky) => new THREE.Path(Array.from({length: KEY_SEG}, (_, j) => {
    const a = j / KEY_SEG * Math.PI * 2;
    return new THREE.Vector2(kx + Math.cos(a) * KEY_R(), ky + Math.sin(a) * KEY_R());
  }));

  const seg = clipProfile(line, t.y0, t.y1);
  const rLow = seg[0].r, rHigh = seg[seg.length - 1].r;
  const openBottom = !t.first;                     // снизу полость открыта у верхних ярусов
  const keysP = partingKeys(b, t);

  /* ---------- лицевая грань разъёма ---------- */
  if (openBottom) {
    /* Полость проходит грань насквозь — грань распадается на две части. */
    const right = new THREE.Shape([
      new THREE.Vector2(rLow, t.y0), new THREE.Vector2(halfW, t.y0),
      new THREE.Vector2(halfW, t.y1), new THREE.Vector2(rHigh, t.y1),
      ...[...seg].reverse().map(p => new THREE.Vector2(p.r, p.y)),
    ]);
    keysP.filter(k => k.x > 0).forEach(k => right.holes.push(keyPath(k.x, k.y)));
    shapeTris(right, (x, y) => [x, y, 0], false);

    const left = new THREE.Shape([
      new THREE.Vector2(-halfW, t.y0), new THREE.Vector2(-rLow, t.y0),
      ...seg.map(p => new THREE.Vector2(-p.r, p.y)),
      new THREE.Vector2(-halfW, t.y1),
    ]);
    keysP.filter(k => k.x < 0).forEach(k => left.holes.push(keyPath(k.x, k.y)));
    shapeTris(left, (x, y) => [x, y, 0], false);
  } else {
    /* Нижний ярус: полость закрыта снизу, грань цельная с выемкой сверху.
       Центр донышка обязан быть в контуре: донышко закрыто веером из центра,
       и без этой точки одно ребро грани встретит два ребра донышка. */
    const face = new THREE.Shape([
      new THREE.Vector2(-halfW, t.y0), new THREE.Vector2(halfW, t.y0),
      new THREE.Vector2(halfW, t.y1), new THREE.Vector2(rHigh, t.y1),
      ...[...seg].reverse().map(p => new THREE.Vector2(p.r, p.y)),
      new THREE.Vector2(0, seg[0].y),
      ...seg.map(p => new THREE.Vector2(-p.r, p.y)),
      new THREE.Vector2(-rHigh, t.y1), new THREE.Vector2(-halfW, t.y1),
    ]);
    keysP.forEach(k => face.holes.push(keyPath(k.x, k.y)));
    shapeTris(face, (x, y) => [x, y, 0], false);
  }

  /* ---------- полость ---------- */
  const ring = (r, y, j) => {
    const a = Math.PI * j / SEG;
    return [r * Math.cos(a), y, -r * Math.sin(a)];
  };
  for (let i = 0; i < seg.length - 1; i++)
    for (let j = 0; j < SEG; j++)
      quad(ring(seg[i].r, seg[i].y, j), ring(seg[i + 1].r, seg[i + 1].y, j),
           ring(seg[i + 1].r, seg[i + 1].y, j + 1), ring(seg[i].r, seg[i].y, j + 1));

  if (!openBottom) {
    const c = [0, seg[0].y, 0];
    for (let j = 0; j < SEG; j++)
      tri(c, ring(rLow, seg[0].y, j), ring(rLow, seg[0].y, j + 1));
  }

  /* ---------- замки на разъёме ---------- */
  const signP = socket ? -1 : 1;
  const dome = (kx, ky, j, r2, sign) => {
    if (r2 === 3) return [kx, ky, sign * KEY_H()];
    const s = r2 / 3, rr = KEY_R() * Math.cos(s * Math.PI / 2);
    const zz = sign * KEY_H() * Math.sin(s * Math.PI / 2);
    const a = j / KEY_SEG * Math.PI * 2;
    return [kx + Math.cos(a) * rr, ky + Math.sin(a) * rr, zz];
  };
  for (const k of keysP)
    for (let r2 = 0; r2 < 3; r2++)
      for (let j = 0; j < KEY_SEG; j++) {
        const j2 = (j + 1) % KEY_SEG;
        if (r2 === 2) tri(dome(k.x, k.y, j, 3, signP), dome(k.x, k.y, j, r2, signP), dome(k.x, k.y, j2, r2, signP));
        else quad(dome(k.x, k.y, j, r2, signP), dome(k.x, k.y, j2, r2, signP),
                  dome(k.x, k.y, j2, r2 + 1, signP), dome(k.x, k.y, j, r2 + 1, signP));
      }

  /* ---------- блок: зад и бока ---------- */
  const back = [[-halfW, t.y0, D], [halfW, t.y0, D], [halfW, t.y1, D], [-halfW, t.y1, D]];
  quad(back[0], back[3], back[2], back[1]);
  const front = [[-halfW, t.y0, 0], [halfW, t.y0, 0], [halfW, t.y1, 0], [-halfW, t.y1, 0]];
  quad(front[1], back[1], back[2], front[2]);      // правый бок
  quad(front[3], back[3], back[0], front[0]);      // левый бок

  /* ---------- горизонтальные грани со штифтами стыка ---------- */
  const horiz = (y, r, up, keys, sign) => {
    const arc = [];
    for (let j = 0; j <= SEG; j++) {
      const a = Math.PI * j / SEG;
      arc.push(new THREE.Vector2(r * Math.cos(a), -r * Math.sin(a)));
    }
    const pts = r > 0.01
      ? [new THREE.Vector2(-halfW, D), new THREE.Vector2(halfW, D),
         new THREE.Vector2(halfW, 0), ...arc, new THREE.Vector2(-halfW, 0)]
      : [new THREE.Vector2(-halfW, D), new THREE.Vector2(halfW, D),
         new THREE.Vector2(halfW, 0), new THREE.Vector2(-halfW, 0)];
    const sh = new THREE.Shape(pts);
    for (const k of keys)
      sh.holes.push(new THREE.Path(Array.from({length: KEY_SEG}, (_, j) => {
        const a = j / KEY_SEG * Math.PI * 2;
        return new THREE.Vector2(k.x + Math.cos(a) * KEY_R(), k.z + Math.sin(a) * KEY_R());
      })));
    shapeTris(sh, (x, z) => [x, y, z], up);

    for (const k of keys)
      for (let r2 = 0; r2 < 3; r2++)
        for (let j = 0; j < KEY_SEG; j++) {
          const j2 = (j + 1) % KEY_SEG;
          const d3 = (jj, rr2) => {
            if (rr2 === 3) return [k.x, y + sign * KEY_H(), k.z];
            const s = rr2 / 3, rad = KEY_R() * Math.cos(s * Math.PI / 2);
            const dy = sign * KEY_H() * Math.sin(s * Math.PI / 2);
            const a = jj / KEY_SEG * Math.PI * 2;
            return [k.x + Math.cos(a) * rad, y + dy, k.z + Math.sin(a) * rad];
          };
          if (r2 === 2) up ? tri(d3(j, 3), d3(j2, r2), d3(j, r2)) : tri(d3(j, 3), d3(j, r2), d3(j2, r2));
          else up ? quad(d3(j, r2), d3(j, r2 + 1), d3(j2, r2 + 1), d3(j2, r2))
                  : quad(d3(j, r2), d3(j2, r2), d3(j2, r2 + 1), d3(j, r2 + 1));
        }
  };

  const topKeys = t.last ? [] : jointKeys(b, t.y1);
  const botKeys = t.first ? [] : jointKeys(b, t.y0);
  horiz(t.y1, t.last ? b.funnelR : rHigh, true, topKeys, +1);
  horiz(t.y0, openBottom ? rLow : 0, false, botKeys, -1);   // у нижнего яруса грань сплошная

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.translate(0, -(t.y0 + t.y1) / 2, Rw / 2);
  geo.rotateX(-Math.PI / 2);                       // разъёмом вверх, как на верстаке
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const one = (2 / 3) * Math.PI * KEY_R() * KEY_R() * KEY_H() / 1e6;
  const bumps = keysP.length * (socket ? -1 : 1) + topKeys.length - botKeys.length;
  const plasterL = t.plasterL + bumps * one;
  return {
    geometry: geo, tier: t, tierIndex: opt.tier | 0, tiers: plan.tiers.length,
    blockMM: [2 * halfW, Rw, t.y1 - t.y0], boxL: t.boxL,
    plasterL, kg: plasterL * PLASTER_KG_PER_L,
    keys: keysP.length, joints: topKeys.length + botKeys.length, keysL: Math.abs(bumps) * one,
    socket,
  };
}

/** Числа для панели без построения меша. */
export function castMouldNumbers(state) {
  const plan = castPlan(state);
  const b = plan.block;
  return {
    blockMM: b.blockMM, tiers: plan.tiers.length, parts: plan.parts,
    perTier: plan.tiers.map((t, i) => ({
      i, mm: [Math.round(2 * b.Rw), Math.round(b.Rw), Math.round(t.y1 - t.y0)],
      plasterL: t.plasterL, kg: t.kg, keys: partingKeys(b, t).length,
      joints: (t.last ? 0 : jointKeys(b, t.y1).length) + (t.first ? 0 : jointKeys(b, t.y0).length),
    })),
    heaviestKg: plan.heaviestKg, maxKg: plan.maxKg, fullKg: plan.fullKg, why: plan.why,
    funnelL: cavityL(b.line, b.H, b.yTop),
    funnelR: b.funnelR, funnelH: b.funnelH, wall: b.wall, base: b.base,
    plasterL: plan.tiers.reduce((s, t) => s + t.plasterL, 0),
  };
}
