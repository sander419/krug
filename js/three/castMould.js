// file: js/three/castMould.js
// Форма для литья: две вертикальные половины с литником.
//
// Почему именно вертикальный разъём. Тело вращения разнимается двумя половинами
// всегда, каким бы пузатым оно ни было: половина снимается вбок, а не вверх,
// и завал профиля ей не мешает. Поднутрения, из-за которых жёсткая оснастка
// требует трёх частей, литью безразличны — это и есть причина, по которой
// сложные формы льют, а не штампуют.
//
// Что строится: блок гипса, разрезанный плоскостью через ось, с половиной
// полости внутри, воронкой над кромкой и замками на разъёме. Половины
// различаются только замками — бугорки против лунок.
//
// Булевой операции снова не нужно: половина полости — это половина протяжки,
// а лицевая грань блока — прямоугольник с вырезом по силуэту изделия.
// Тот же приём, что в js/three/partMould.js, и та же проверка направленных
// рёбер: гипс льют по этой модели, а печатают по STL.
import * as THREE from 'three';
import { wareProfiles } from '../core/mould.js';
import { tune } from '../core/tuning.js';

const SEG = 48;           // шагов по половине окружности
const KEY_SEG = 20;       // шагов по окружности замка
const KEY_EDGE = 8;       // гипс между замком и краем блока, мм

const R = () => tune('funnelR'), FH = () => tune('funnelH');
const WALL = () => tune('castWall'), BASE = () => tune('castBase');
const KEY_R = () => tune('keyR'), KEY_H = () => tune('keyH'), KEY_CLEAR = () => tune('keyClear');

/** Габарит блока и опорные размеры — без построения меша. */
export function castMouldBlock(state) {
  const {outer, maxR, H} = wareProfiles(state);
  const wall = WALL(), base = BASE();
  const Rw = Math.max(maxR, R()) + wall;      // полублок: от разъёма наружу
  return {
    outer, maxR, H,
    Rw,                                        // глубина половины (от плоскости разъёма)
    halfW: Rw,                                 // полуширина блока вдоль разъёма
    yBot: -base,
    yTop: H + FH(),
    funnelR: R(), funnelH: FH(), wall, base,
    blockMM: [2 * Rw, Rw, H + FH() + base],
    // объём блока ОДНОЙ половины: по ширине он полный, по глубине — от разъёма наружу
    boxL: (2 * Rw) * Rw * (H + FH() + base) / 1e6,
  };
}

/* Объём половины изделия и воронки — то, чего в гипсе не будет. */
function hollowLitres(b) {
  const {outer} = b;
  let ware = 0;
  for (let i = 1; i < outer.length; i++) {
    const a = outer[i - 1], c = outer[i], dy = c.y - a.y;
    ware += Math.PI * dy * (a.r * a.r + a.r * c.r + c.r * c.r) / 3;   // усечённый конус
  }
  const rTop = outer[outer.length - 1].r;
  const funnel = Math.PI * b.funnelH * (rTop * rTop + rTop * b.funnelR + b.funnelR * b.funnelR) / 3;
  return {wareL: ware / 2 / 1e6, funnelL: funnel / 2 / 1e6};
}

/* Замки по углам разъёма: место под них есть всегда — стенка блока считается
   от габарита изделия, а замки стоят у самого края. */
function keyPositions(b) {
  const d = KEY_EDGE + KEY_R();
  const x = b.halfW - d, y0 = b.yBot + d, y1 = b.yTop - d;
  const pts = [{x: -x, y: y0}, {x, y: y0}, {x: -x, y: y1}, {x, y: y1}];
  // замок не должен сесть на полость: силуэт изделия шире всего в поясе
  return pts.filter(p => {
    const r = radiusAtY(b.outer, p.y);
    return Math.abs(p.x) - KEY_R() - KEY_CLEAR() > r;
  });
}

function radiusAtY(outer, y) {
  if (y <= outer[0].y || y >= outer[outer.length - 1].y) return 0;
  for (let i = 1; i < outer.length; i++)
    if (outer[i].y >= y) {
      const a = outer[i - 1], c = outer[i];
      const k = c.y > a.y ? (y - a.y) / (c.y - a.y) : 0;
      return a.r + (c.r - a.r) * k;
    }
  return 0;
}

/**
 * Одна половина формы. Плоскость разъёма — z = 0, гипс уходит в минус,
 * ось изделия лежит в этой плоскости и идёт по y.
 */
export function castMouldGeometry(state, opt = {}) {
  const socket = opt.half === 'socket';
  const b = castMouldBlock(state);
  const {outer, halfW, yBot, yTop} = b;
  const rTop = outer[outer.length - 1].r;

  const pos = [];
  const tri = (a, c, d) => pos.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  const quad = (a, c, d, e) => { tri(a, c, d); tri(a, d, e); };

  /* ---------- лицевая грань разъёма ----------
     Полость открыта сверху литником, поэтому силуэт — не дырка в прямоугольнике,
     а вырез в его верхнем крае. Дырка, касающаяся края, для earcut вырождена:
     она даёт Т-образные стыки и щели в теле. Обходим прямоугольник и ныряем
     в вырез там, где стоит воронка. */
  const keys = keyPositions(b);
  const outline = [
    {x: -halfW, y: yBot}, {x: halfW, y: yBot}, {x: halfW, y: yTop},
    {x: b.funnelR, y: yTop},
    ...[...outer].reverse().map(p => ({x: p.r, y: p.y})),   // вниз по правому силуэту
    {x: 0, y: outer[0].y},                                  // центр дна: донышко закрыто веером
    ...outer.map(p => ({x: -p.r, y: p.y})),                 // вверх по левому
    {x: -b.funnelR, y: yTop},
    {x: -halfW, y: yTop},
  ];
  const face = new THREE.Shape(outline.map(p => new THREE.Vector2(p.x, p.y)));
  face.holes = keys.map(k => new THREE.Path(Array.from({length: KEY_SEG}, (_, j) => {
    const a = j / KEY_SEG * Math.PI * 2;
    return new THREE.Vector2(k.x + Math.cos(a) * KEY_R(), k.y + Math.sin(a) * KEY_R());
  })));
  {
    const g = new THREE.ShapeGeometry(face, 1);
    const fp = g.attributes.position, fi = g.index.array;
    for (let i = 0; i < fi.length; i += 3) {
      const v = [0, 1, 2].map(k => [fp.getX(fi[i + k]), fp.getY(fi[i + k]), 0]);
      tri(v[0], v[1], v[2]);                       // нормаль к +z, наружу гипса
    }
    g.dispose();
  }

  /* ---------- полость: половина протяжки, уходящая в минус по z ---------- */
  const ring = (r, y, j) => {
    const a = Math.PI * j / SEG;                 // от 0 до π: z ≤ 0
    return [r * Math.cos(a), y, -r * Math.sin(a)];
  };
  const line = outer.map(p => ({r: p.r, y: p.y}));
  line.push({r: b.funnelR, y: yTop});            // воронка — продолжение полости
  for (let i = 0; i < line.length - 1; i++)
    for (let j = 0; j < SEG; j++)
      quad(ring(line[i].r, line[i].y, j), ring(line[i + 1].r, line[i + 1].y, j),
           ring(line[i + 1].r, line[i + 1].y, j + 1), ring(line[i].r, line[i].y, j + 1));

  /* дно полости: изделие стоит на гипсе, дно закрыто полудиском */
  {
    const c = [0, outer[0].y, 0], r0 = outer[0].r;
    for (let j = 0; j < SEG; j++)
      tri(c, ring(r0, outer[0].y, j), ring(r0, outer[0].y, j + 1));
  }

  /* ---------- замки ---------- */
  const sign = socket ? -1 : 1;
  for (const k of keys) {
    const dome = (j, ring2) => {
      if (ring2 === 3) return [k.x, k.y, sign * KEY_H()];
      const t = ring2 / 3;
      const rr = KEY_R() * Math.cos(t * Math.PI / 2);
      const zz = sign * KEY_H() * Math.sin(t * Math.PI / 2);
      const a = j / KEY_SEG * Math.PI * 2;
      return [k.x + Math.cos(a) * rr, k.y + Math.sin(a) * rr, zz];
    };
    for (let r2 = 0; r2 < 3; r2++)
      for (let j = 0; j < KEY_SEG; j++) {
        const j2 = (j + 1) % KEY_SEG;
        if (r2 === 2) tri(dome(j, 3), dome(j, r2), dome(j2, r2));
        else quad(dome(j, r2), dome(j2, r2), dome(j2, r2 + 1), dome(j, r2 + 1));
      }
  }

  /* ---------- блок: задняя грань, бока, низ и верх с отверстием литника ---------- */
  const D = -b.Rw;                                // задняя плоскость
  const back = [[-halfW, yBot, D], [halfW, yBot, D], [halfW, yTop, D], [-halfW, yTop, D]];
  quad(back[0], back[3], back[2], back[1]);
  const front = [[-halfW, yBot, 0], [halfW, yBot, 0], [halfW, yTop, 0], [-halfW, yTop, 0]];
  quad(front[0], back[0], back[1], front[1]);     // низ
  quad(front[1], back[1], back[2], front[2]);     // правый бок
  quad(front[3], back[3], back[0], front[0]);     // левый бок

  /* верх: вырез под воронку — тоже вырез в крае, а не дырка внутри грани */
  {
    const arc = [];
    for (let j = 0; j <= SEG; j++) {
      const a = Math.PI * j / SEG;
      arc.push(new THREE.Vector2(b.funnelR * Math.cos(a), -b.funnelR * Math.sin(a)));
    }
    const top = new THREE.Shape([
      new THREE.Vector2(-halfW, D), new THREE.Vector2(halfW, D), new THREE.Vector2(halfW, 0),
      ...arc,                                       // от +funnelR через дугу к −funnelR
      new THREE.Vector2(-halfW, 0),
    ]);
    const gt = new THREE.ShapeGeometry(top, 1);
    const tp = gt.attributes.position, ti = gt.index.array;
    for (let i = 0; i < ti.length; i += 3) {
      const v = [0, 1, 2].map(k => [tp.getX(ti[i + k]), yTop, tp.getY(ti[i + k])]);
      tri(v[0], v[2], v[1]);                        // нормаль вверх
    }
    gt.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  /* Кладём половину разъёмом вверх и в центр координат — так она и лежит
     на верстаке, когда в неё заливают гипс и когда её потом собирают. */
  geo.translate(0, -(yBot + yTop) / 2, b.Rw / 2);
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const {wareL, funnelL} = hollowLitres(b);
  const keysL = keys.length * (2 / 3) * Math.PI * KEY_R() * KEY_R() * KEY_H() / 1e6;
  return {
    geometry: geo, blockMM: b.blockMM, boxL: b.boxL,
    plasterL: b.boxL - wareL - funnelL + (socket ? -keysL : keysL),
    wareL, funnelL, keys: keys.length, keysL, socket, block: b,
  };
}

/** Числа для панели без построения меша. */
export function castMouldNumbers(state) {
  const b = castMouldBlock(state);
  const {wareL, funnelL} = hollowLitres(b);
  const keys = keyPositions(b).length;
  return {
    blockMM: b.blockMM, halfBoxL: b.boxL,
    plasterL: b.boxL - wareL - funnelL,
    wareL, funnelL, keys,
    funnelR: b.funnelR, funnelH: b.funnelH, wall: b.wall, base: b.base,
  };
}
