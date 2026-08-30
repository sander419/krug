// file: js/core/lid.js
// Крышка: отдельное изделие, которое обязано сесть на своё.
//
// Крышка — не прилеп: её не примазывают, а делают отдельно и обжигают вместе.
// Поэтому главное здесь не форма, а **посадка**: между крышкой и горловиной
// нужен зазор, и нужен он не до обжига, а после. Обе детали садятся на одну
// и ту же долю, значит зазор садится вместе с ними — и заложенный «на глаз»
// миллиметр после обжига превращается в девять десятых.
//
// Второе, что ломает крышки в печи: глазурь. Политая посадочная поверхность
// спекается с горловиной намертво, и разбить приходится обе детали. Поэтому
// поясок посадки не глазуруют — об этом инструмент говорит прямо.
//
// Здесь чистая математика: профиль крышки в координатах изделия, её объём
// и масса, зазор после обжига и замечания. Ни DOM, ни three.js.
import { clamp } from './util.js';

export const LID_DEFAULTS = {
  on: false,
  type: 'inset',      // 'inset' — бортик входит в горловину, 'over' — крышка накрывает кромку
  h: 22,              // высота купола над кромкой, мм
  wall: 5,            // толщина крышки, мм
  seatH: 8,           // высота посадочного пояска, мм
  gap: 1,             // зазор посадки в сыром размере, мм
  knobH: 16,          // высота кнопки
  knobD: 24,          // диаметр кнопки
  over: 6,            // насколько накладная крышка свисает за кромку, мм
};

export const LID_LIMITS = {
  h: [4, 120], wall: [2, 20], seatH: [2, 40], gap: [0, 6],
  knobH: [0, 60], knobD: [6, 90], over: [1, 40],
};

export function sanitizeLid(raw) {
  const o = {...LID_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {})};
  o.on = !!o.on;
  o.type = o.type === 'over' ? 'over' : 'inset';
  for (const [k, [lo, hi]] of Object.entries(LID_LIMITS)) {
    const v = +o[k];
    o[k] = Number.isFinite(v) ? clamp(v, lo, hi) : LID_DEFAULTS[k];
  }
  return o;
}

/** Радиус кромки изделия и её высота. */
export function rimOf(prof) {
  const top = prof[prof.length - 1];
  return {r: top.r, y: top.y};
}

/* Дуга купола от края к оси: r = R·cos, y = y0 + H·sin. Так крышку и тянут —
   от кромки к центру. Останавливаемся на rStop: под кнопкой купола нет. */
function domeArc(R, H, y0, rStop) {
  const out = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = R * Math.cos(t * Math.PI / 2);
    if (r < rStop) break;
    out.push({r, y: y0 + H * Math.sin(t * Math.PI / 2)});
  }
  return out;
}

/**
 * Профиль крышки — замкнутый контур сечения, как у корпуса: с оси наружу
 * по внутренней поверхности, через посадочный поясок вверх по наружной и
 * обратно на ось. Тело вращения по нему — цельная крышка со стенкой,
 * а не бумажная оболочка: такую можно и посчитать, и выгрузить в STL.
 *
 * Кнопка сплошная. Это не упрощение: маленькую кнопку и вправду лепят
 * из целого комка — пустоты в ней нет, и полая она бы смялась под пальцами.
 */
export function lidProfile(prof, lid, wallMM) {
  const rim = rimOf(prof);
  const wall = lid.wall;
  /* Посадка: бортик входит внутрь горловины с зазором, либо крышка садится
     сверху и свисает за кромку. Внутренний радиус горловины — кромка минус
     стенка изделия: именно в него и входит бортик. */
  const inner = Math.max(2, rim.r - wallMM);
  const seatR = lid.type === 'inset' ? Math.max(inner - lid.gap, 1) : rim.r + lid.gap;
  const outR = lid.type === 'inset' ? rim.r : seatR + lid.over;
  const y0 = rim.y - lid.seatH;                       // низ пояска (обе посадки)
  /* Купол изнутри ниже и уже наружного ровно на стенку. Если крышка ниже
     собственной стенки, внутри остаётся плоский потолок — цельный диск. */
  const hIn = Math.max(lid.h - wall, 0.4);
  const rIn = lid.type === 'inset' ? Math.max(seatR - wall, 0.4) : seatR;
  const kr = lid.knobH > 0.5 ? lid.knobD / 2 : 0;
  const kTop = rim.y + lid.h + lid.knobH;

  /* Контур собираем из двух половин: изнанка и наружная поверхность.
     Наружная нужна отдельно — на чертеже вид спереди рисуют силуэтом,
     без внутренних линий. */
  const innPts = [], outPts = [];
  const I = (r, y) => innPts.push({r: Math.max(r, 0.01), y});
  const O = (r, y) => outPts.push({r: Math.max(r, 0.01), y});

  // изнутри: с оси наружу и вниз по пояску
  for (const p of domeArc(rIn, hIn, rim.y, 0).reverse()) I(p.r, p.y);
  I(rIn, y0);

  O(seatR, y0);                                        // торец пояска
  O(seatR, rim.y);
  if (lid.type === 'inset') O(outR, rim.y);            // полка ложится на кромку
  else { O(outR, y0); O(outR, rim.y); }                // юбка снаружи: торец внизу
  for (const p of domeArc(outR, lid.h, rim.y, kr)) O(p.r, p.y);
  if (kr > 0) {
    const yAtK = rim.y + lid.h * Math.sqrt(Math.max(0, 1 - (kr / outR) ** 2));
    O(kr, yAtK);
    O(kr, kTop - kr * 0.6);
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      O(kr * Math.cos(t * Math.PI / 2), kTop - kr * 0.6 + kr * 0.6 * Math.sin(t * Math.PI / 2));
    }
  }
  const pts = innPts.concat(outPts);

  /* Обход должен идти против часовой в осевом сечении — как у корпуса,
     иначе нормали смотрят внутрь и модель выворачивается в STL. */
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.r * q.y - q.r * p.y;
  }
  if (a < 0) pts.reverse();

  return {pts, outer: outPts, seatR, outR, inner, rim, y0, wall, hIn, kr,
          topY: kr > 0 ? kTop : rim.y + lid.h};
}

/** Числа крышки: объём глины, масса, зазор до и после обжига. */
export function lidMetrics(prof, lid, wallMM, densityGcm3, shrinkPct) {
  const L = lidProfile(prof, lid, wallMM);
  /* Объём тела вращения по теореме Гульдина: площадь сечения на путь
     её центра тяжести. Контур замкнут, значит это настоящий объём глины,
     а не поверхность, помноженная на толщину. */
  let A = 0, cx = 0;
  for (let i = 0; i < L.pts.length; i++) {
    const p = L.pts[i], q = L.pts[(i + 1) % L.pts.length];
    const cross = p.r * q.y - q.r * p.y;
    A += cross;
    cx += (p.r + q.r) * cross;
  }
  A /= 2;
  cx = A !== 0 ? cx / (6 * A) : 0;
  const volMl = Math.abs(2 * Math.PI * A * cx) / 1000;
  const k = 1 - shrinkPct / 100;
  return {
    ...L,
    volMl, massG: volMl * densityGcm3,
    gapRaw: lid.gap,
    gapFired: lid.gap * k,                              // зазор садится вместе с деталями
    firedSeatMM: 2 * L.seatR * k,
    heightMM: L.topY - L.y0,
  };
}

/** Замечания по крышке: то, из-за чего крышки бьют после обжига. */
export function lidWarnings(state, prof, mat) {
  const lid = sanitizeLid(state.lid);
  if (!lid.on) return [];
  const w = [];
  const m = lidMetrics(prof, lid, state.wall, 1, mat.shrinkPct);
  if (m.gapFired < 0.4)
    w.push({lvl: 'bad', help: 'shrinkage', txt:
      `Крышка: зазор посадки после обжига ${m.gapFired.toFixed(1)} мм — крышка застрянет. ` +
      `Зазор садится вместе с деталями: закладывайте с запасом на усадку ${mat.shrinkPct} %.`});
  else if (m.gapFired > 2.5)
    w.push({lvl: 'warn', help: 'shrinkage', txt:
      `Крышка: зазор ${m.gapFired.toFixed(1)} мм после обжига — будет болтаться и звенеть.`});
  if (lid.type === 'inset' && m.seatR < 6)
    w.push({lvl: 'bad', help: 'wall-thickness', txt:
      'Крышка: горловина уже посадочного бортика — при такой стенке бортику некуда войти.'});
  if (lid.wall < state.wall * 0.6)
    w.push({lvl: 'warn', help: 'drying', txt:
      `Крышка тоньше корпуса (${lid.wall} против ${state.wall} мм): сохнет быстрее и коробится.`});
  if (state.firing === 'glaze')
    w.push({lvl: 'warn', help: 'glaze-thickness', txt:
      'Крышка: посадочный поясок не глазуруется — политая посадка спекается с горловиной, ' +
      'и разбивать придётся обе детали. Обжигайте крышку на изделии, чтобы села точно.'});
  return w;
}
