// file: js/core/glazeCoat.js
// Сколько глазури лежит в каждой точке сечения. Чистая геометрия, без DOM и three.
//
// Глазурь на форме — не краска ровным слоем. Макнутое изделие сохнет и обжигается
// по трём правилам, и все три видны глазом:
//   1. на выпуклом ребре плёнка утоньшается и пробивает до черепка;
//   2. в канавке и на горизонтальной полке набирается и темнеет;
//   3. на расплаве течёт вниз, снизу собираясь в валик.
// Отсюда и берётся вид: целадон показывает рельеф, тенмоку вспыхивает рыжим
// по кромке, пепельная копится в перехвате. Толщина считается здесь, а
// шейдер её только красит.
//
// Единицы: миллиметры. Толщина безразмерная, 1 — обычное макание.

import { clamp } from './util.js';

const R = p => (p.r !== undefined ? p.r : p.x);      // путь приходит и как {r,y}, и как Vector2

/* Радиус скругления, ниже которого ребро считается острым. Подобран по виду:
   на 3 мм и меньше пробой заметен глазом, на 10 мм его уже нет. */
const SHARP_MM = 3;

/** Разбить путь на участки, монотонные по высоте: наружная стенка идёт снизу
    вверх, внутренняя — сверху вниз. Стекать глазурь должна вдоль каждого
    участка отдельно, а не через кромку. */
function monotoneRuns(path) {
  const runs = [];
  let start = 0, dir = 0;
  for (let i = 1; i < path.length; i++) {
    const d = Math.sign(path[i].y - path[i - 1].y);
    if (d === 0) continue;
    if (dir === 0) { dir = d; continue; }
    if (d !== dir) { runs.push({from: start, to: i - 1, dir}); start = i - 1; dir = d; }
  }
  if (dir !== 0) runs.push({from: start, to: path.length - 1, dir});
  return runs;
}

/**
 * Толщина глазури по точкам сечения.
 * @param path  контур сечения [{r,y}] в мм, в порядке обхода
 * @param look  параметры семейства: breakEdge, pool, flow (0…1)
 * @param opts  {dryFootMM} — сухой поясок у подошвы, чтобы изделие не прикипело
 * @returns {coat: Float64Array, runMax: number, sharpest: number}
 *          runMax — сколько натекло в самой нижней точке (>1.6 уже риск полки)
 */
export function coatProfile(path, look, opts = {}) {
  const n = path.length;
  const coat = new Float64Array(n).fill(1);
  if (n < 3) return {coat, runMax: 1, sharpest: 0};

  const dryFoot = opts.dryFootMM ?? 4;
  const brk = look.breakEdge ?? 0, pool = look.pool ?? 0, flow = look.flow ?? 0;
  const yMax = Math.max(...path.map(p => p.y)) || 1;

  const runs = monotoneRuns(path);
  const runOf = new Int8Array(n);                     // направление обхода в точке
  for (const r of runs) for (let i = r.from; i <= r.to; i++) runOf[i] = r.dir;

  /* --- 1 и 2: ребро и углубление --- */
  let sharpest = 0;
  const curv = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const dr1 = R(path[i]) - R(path[i - 1]), dy1 = path[i].y - path[i - 1].y;
    const dr2 = R(path[i + 1]) - R(path[i]), dy2 = path[i + 1].y - path[i].y;
    const l1 = Math.hypot(dr1, dy1), l2 = Math.hypot(dr2, dy2);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    // знак поворота: наружу от поверхности — выпуклость, внутрь — канавка
    const cross = (dr1 * dy2 - dy1 * dr2) / (l1 * l2);
    const turn = Math.asin(clamp(cross, -1, 1)) * (runOf[i] || 1);
    const k = turn / ((l1 + l2) / 2);                 // 1/мм
    curv[i] = clamp(k * SHARP_MM, -1, 1);
    if (curv[i] > sharpest) sharpest = curv[i];
  }
  for (let i = 0; i < n; i++) {
    const dr = R(path[Math.min(i + 1, n - 1)]) - R(path[Math.max(i - 1, 0)]);
    const dy = path[Math.min(i + 1, n - 1)].y - path[Math.max(i - 1, 0)].y;
    const len = Math.hypot(dr, dy) || 1;
    const horizontal = Math.abs(dr) / len;            // 1 — полка, 0 — вертикальная стенка
    const thin = brk * Math.max(curv[i], 0);
    const gain = pool * (Math.max(-curv[i], 0) * 0.8 + horizontal * 0.45);
    coat[i] = 1 - thin * 0.85 + gain;
  }

  /* --- 3: сток вниз вдоль каждого участка --- */
  let runMax = 1;
  for (const r of runs) {
    let acc = 0;
    const step = r.dir > 0 ? -1 : 1;                  // всегда идём сверху вниз
    const first = r.dir > 0 ? r.to : r.from, last = r.dir > 0 ? r.from : r.to;
    for (let i = first; step > 0 ? i <= last : i >= last; i += step) {
      const j = i - step;
      if (j >= 0 && j < n) {
        const dl = Math.hypot(R(path[i]) - R(path[j]), path[i].y - path[j].y);
        const dy = Math.abs(path[i].y - path[j].y);
        const vertical = dl > 1e-6 ? dy / dl : 0;     // по вертикали течёт, по полке стоит
        acc += flow * vertical * (dl / yMax) * 1.6;
        acc *= 1 - 0.35 * (1 - vertical);             // полка перехватывает поток
      }
      coat[i] += acc;
      if (coat[i] > runMax) runMax = coat[i];
    }
  }

  /* --- сухой поясок: у подошвы глазурь стирают, иначе изделие приварится --- */
  const yMin = Math.min(...path.map(p => p.y));
  for (let i = 0; i < n; i++) {
    const h = path[i].y - yMin;
    if (h < dryFoot) coat[i] *= clamp(h / Math.max(dryFoot, 0.001), 0, 1) * 0.9;
  }

  for (let i = 0; i < n; i++) coat[i] = clamp(coat[i], 0, 2.6);
  return {coat, runMax, sharpest};
}

/**
 * Плёнка на рельефе узора: во сколько раз тоньше на гребне и толще в ложбине.
 *
 * Сечение проходит по одной точке круга и борозд не видит вовсе — а глазурь
 * ведёт себя на них ровно так же, как на любом другом ребре: на выпуклом
 * утоньшается до пробоя, в канавке набирается. Поэтому здесь та же формула
 * и те же константы, что и для профиля выше: одна физика, два входа.
 *
 * **Что здесь расчёт, а что оценка.** Радиусы гребня и ложбины приходят
 * готовыми из `patternCurvature` — они сняты с самой поверхности рельефа,
 * это геометрия. Множители плёнки — оценка (`est`): они берут те же
 * `breakEdge` и `pool` семейства глазури, что и модель профиля, а те подобраны
 * по виду обожжённых образцов, а не измерены. Толщина в миллиметрах остаётся
 * неизвестной (`unknown`): она зависит от времени макания, плотности шликера
 * и пористости утиля — ничего этого инструмент не знает.
 *
 * Первая версия считала радиус гребня по синусоиде (ρ = L²/4π²A) и врала
 * в обе стороны: у «Граней» и «Кладки» занижала остроту вчетверо, а у стопки
 * из крупной волны и мелкой ряби брала глубину крупного слоя с шагом мелкого.
 *
 * @param look  параметры семейства глазури {breakEdge, pool}
 * @param geo   {crestR, valleyR} — радиусы кривизны рельефа, мм
 * @returns {radiusMM, sharp, crest, valley} | null, если рельефа нет
 */
export function reliefCoat(look, geo = {}) {
  const crestR = +geo.crestR, valleyR = +geo.valleyR;
  if (!Number.isFinite(crestR) && !Number.isFinite(valleyR)) return null;
  const brk = look.breakEdge ?? 0, pool = look.pool ?? 0;
  /* Та же мера остроты, что у профиля: ребро радиусом SHARP_MM и острее
     считается острым, пологое — нет. */
  const sharpC = Number.isFinite(crestR) ? clamp(SHARP_MM / crestR, 0, 1) : 0;
  const sharpV = Number.isFinite(valleyR) ? clamp(SHARP_MM / valleyR, 0, 1) : 0;
  if (sharpC <= 0 && sharpV <= 0) return null;
  return {
    radiusMM: Number.isFinite(crestR) ? crestR : valleyR,
    valleyRadiusMM: Number.isFinite(valleyR) ? valleyR : crestR,
    sharp: sharpC,
    crest: clamp(1 - brk * sharpC * 0.85, 0, 2.6),
    valley: clamp(1 + pool * sharpV * 0.8, 0, 2.6),
  };
}

/** Замечания мастера по покрытию: что именно выйдет не так на этой форме. */
export function coatWarnings(glaze, stats) {
  const w = [];
  const look = glaze.look;
  if (stats.runMax > 1.75)
    w.push({lvl: 'bad', help: 'glaze-run', txt:
      `«${glaze.name}» стечёт: у подошвы соберётся втрое против верха. Нужна ловушка или сухой поясок выше.`});
  else if (stats.runMax > 1.4)
    w.push({lvl: 'warn', help: 'glaze-run', txt:
      `«${glaze.name}» потечёт по стенке — низ выйдет темнее верха. Для этой глазури это нормально, но полку прикройте.`});
  if (look.pool > 0.7 && stats.sharpest < 0.25 && look.opacity < 0.5)
    w.push({lvl: 'warn', help: 'glaze-relief', txt:
      `Форма гладкая: «${glaze.name}» живёт толщиной и на ней почти не покажется. Добавьте рельеф или следы гончара.`});
  if (look.crackle > 0.6)
    w.push({lvl: 'warn', help: 'glaze-food', txt:
      'Сетка цека — не для посуды: влага уходит в трещины. Декор или внешняя сторона.'});
  return w;
}
