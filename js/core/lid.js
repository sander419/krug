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
import { patternFn, sanitizePattern, patternOn, patternRelief } from './pattern.js';

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
  /* Узор корпуса переходит на купол. По умолчанию да: крышку печатает то же
     сопло, и гладкая крышка на рельефной вазе выглядит недоделанной. Кому
     нужна гладкая — выключает, и это единственное поле крышки, которое
     ничего не меняет в её посадке. */
  pattern: true,
};

export const LID_LIMITS = {
  h: [4, 120], wall: [2, 20], seatH: [2, 40], gap: [0, 6],
  knobH: [0, 60], knobD: [6, 90], over: [1, 40],
};

export function sanitizeLid(raw) {
  const o = {...LID_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {})};
  o.on = !!o.on;
  o.type = o.type === 'over' ? 'over' : 'inset';
  o.pattern = o.pattern !== false;
  for (const [k, [lo, hi]] of Object.entries(LID_LIMITS)) {
    /* Пустое поле — «не задано», а не ноль: `+null` и `+''` дают ноль,
       и стёртый зазор посадки молча становился нулевым. */
    const raw0 = o[k];
    const v = (raw0 === null || raw0 === undefined || raw0 === '') ? NaN : +raw0;
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
  /* Какие точки лежат на наружной поверхности — помечаем сразу: рельеф
     ложится только на них, а после разворота контура порядок частей
     меняется, и считать «всё после изнанки» стало бы нельзя. */
  const outerFlag = pts.map((_, i) => (i >= innPts.length ? 1 : 0));

  /* Обход должен идти против часовой в осевом сечении — как у корпуса,
     иначе нормали смотрят внутрь и модель выворачивается в STL. */
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.r * q.y - q.r * p.y;
  }
  if (a < 0) { pts.reverse(); outerFlag.reverse(); }

  return {pts, outer: outPts, outerFlag, seatR, outR, inner, rim, y0, wall, hIn, kr,
          topY: kr > 0 ? kTop : rim.y + lid.h};
}

/**
 * Вес рельефа по точкам контура крышки: 0 там, где узор мешает, 1 на открытом
 * куполе. Умножается на глубину, поэтому переходы плавные — ступенька в рельефе
 * это шов, по которому крышка и треснет.
 *
 * Где узора быть не должно и почему:
 *   • **изнанка** — как и полость корпуса: её моют, и вместимость считалась бы заново;
 *   • **посадочный поясок и полка** — крышка обязана сесть, борозда посадку губит;
 *   • **вершина купола** — на оси сегменты сходятся, и рельеф там сминается
 *     в кашу; сопло на таком радиусе его тоже не выведет;
 *   • **кнопка** — за неё берутся пальцами.
 */
export function lidReliefWeights(L) {
  const w = new Float64Array(L.pts.length);
  const top = L.topY;
  /* Разгон над кромкой: рельеф начинается не сразу за посадкой, а через
     несколько миллиметров — там, где купол уже отошёл от горловины. */
  const rise = Math.max(3, (top - L.rim.y) * 0.12);
  const axis = Math.max(L.outR * 0.42, L.kr + 2);       // зона у оси и кнопка
  for (let j = 0; j < L.pts.length; j++) {
    if (!L.outerFlag[j]) continue;                       // изнанка остаётся гладкой
    const p = L.pts[j];
    if (p.y <= L.rim.y) continue;                        // поясок и торец
    const up = clamp((p.y - L.rim.y) / rise, 0, 1);
    const side = clamp((p.r - L.kr) / Math.max(axis - L.kr, 0.01), 0, 1);
    w[j] = up * side;
  }
  return w;
}

/**
 * Рельеф крышки как функция для токаря: (phi, точка, индекс) → смещение, мм.
 * Одна и та же и в сцене, и в STL — иначе выгруженная крышка отличалась бы
 * от показанной, а заметить это можно было бы только на принтере.
 *
 * Высота считается **по самой крышке**: она вторая вещь, а не продолжение
 * стенки. Пояс слоя 35–70 % ложится на 35–70 % высоты крышки.
 */
export function lidWarpFn(L, pat) {
  const pf = patternFn(pat);
  if (!pf) return null;
  const w = lidReliefWeights(L);
  const span = Math.max(L.topY - L.rim.y, 0.01);
  return (phi, p, j) => (w[j] ? pf(phi, clamp((p.y - L.rim.y) / span, 0, 1), w[j]) : 0);
}

/**
 * Сколько глины добавляет рельеф крышке, см³.
 *
 * Считается точно, а не «примерно»: объём тела вращения — это ∮ r²/2 dy
 * по замкнутому контуру, и рельеф меняет в нём только наружную часть.
 * Отсюда поправка = ∮ ⟨(r+d)² − r²⟩/2 dy по наружному обходу, где угловое
 * среднее берётся численно.
 */
export function lidPatternVolumeMl(L, pat) {
  const pf = patternFn(pat);
  if (!pf) return 0;
  const w = lidReliefWeights(L);
  const span = Math.max(L.topY - L.rim.y, 0.01);
  const NA = 72;
  let sum = 0;
  for (let j = 0; j < L.pts.length - 1; j++) {
    const a = L.pts[j], b = L.pts[j + 1];
    const dy = b.y - a.y;                       // знак важен: контур идёт вверх и обратно
    if (!dy) continue;
    const wt = (w[j] + w[j + 1]) / 2;
    if (!wt) continue;
    const r = (a.r + b.r) / 2, v = clamp(((a.y + b.y) / 2 - L.rim.y) / span, 0, 1);
    let ring = 0;
    for (let k = 0; k < NA; k++) {
      const d = pf(k / NA * Math.PI * 2, v, wt);
      ring += ((r + d) * (r + d) - r * r) / 2;
    }
    sum += ring / NA * Math.PI * 2 * dy;
  }
  /* Знак не выбрасывается: узор, который режет (окна, лунки), глину убирает,
     и «по модулю» здесь означало бы приписать вещи лишнюю массу. */
  return sum / 1000;
}

/** Числа крышки: объём глины, масса, зазор до и после обжига. */
export function lidMetrics(prof, lid, wallMM, densityGcm3, shrinkPct, pattern) {
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
  const smoothMl = Math.abs(2 * Math.PI * A * cx) / 1000;
  /* Рельеф на куполе — это глина, а не картинка: у корпуса поправку считают,
     и у крышки обязаны считать тем же способом. */
  const patMl = lid.pattern ? lidPatternVolumeMl(L, pattern) : 0;
  const volMl = Math.max(0, smoothMl + patMl);
  const k = 1 - shrinkPct / 100;
  return {
    ...L,
    volMl, smoothMl, patMl, massG: volMl * densityGcm3,
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
  const m = lidMetrics(prof, lid, state.wall, 1, mat.shrinkPct, state.pattern);
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
  const pat = sanitizePattern(state.pattern);
  if (lid.pattern && patternOn(pat)) {
    /* Купол — та же стенка, только своя: рельеф режет её ровно так же,
       и порог тот же, что у корпуса. */
    const {carve} = patternRelief(pat, Math.max(m.topY - m.rim.y, 1));
    const left = lid.wall - carve;
    if (left < 1.2)
      w.push({lvl: 'bad', help: 'relief', txt:
        `Крышка: узор срезает ${carve.toFixed(1)} мм при её стенке ${lid.wall} мм — ` +
        `останется ${Math.max(0, left).toFixed(1)} мм, купол прорвётся. Утолщите крышку ` +
        'или уберите узор с неё.'});
    else if (left < lid.wall * 0.5)
      w.push({lvl: 'warn', help: 'relief', txt:
        `Крышка: в ложбине узора остаётся ${left.toFixed(1)} мм из ${lid.wall} мм — ` +
        'по этой борозде крышка и расколется, если её уронить.'});
  }
  if (lid.wall < state.wall * 0.6)
    w.push({lvl: 'warn', help: 'drying', txt:
      `Крышка тоньше корпуса (${lid.wall} против ${state.wall} мм): сохнет быстрее и коробится.`});
  if (state.firing === 'glaze')
    w.push({lvl: 'warn', help: 'glaze-thickness', txt:
      'Крышка: посадочный поясок не глазуруется — политая посадка спекается с горловиной, ' +
      'и разбивать придётся обе детали. Обжигайте крышку на изделии, чтобы села точно.'});
  return w;
}
