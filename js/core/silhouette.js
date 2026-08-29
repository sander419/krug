// file: js/core/silhouette.js
// Силуэт с картинки: фотография изделия или чертёж → профиль.
//
// Проще всего форму объяснить не ползунками и не мышью, а картинкой: «вот такой
// кувшин». Отсюда — обводка. Никакого распознавания здесь нет и не нужно:
// у тела вращения силуэт и есть профиль, а найти силуэт на однородном фоне —
// это порог и две крайние точки в каждой строке.
//
// Картинка никуда не уходит: пиксели читаются в браузере, наружу не отправляется
// ничего — у КРУГа внешних запросов нет принципиально.
//
// Чистая математика: на входе пиксели, на выходе ломаная в тех же единицах,
// что и картинка. Проверяется без браузера — tools/check-silhouette.mjs.

const CORNER = 6;            // сторона квадрата в углу, по которому берут фон
const MIN_RUN = 2;           // пикселей подряд: одиночная точка — это шум
const MIN_ROWS = 8;          // строк меньше — не силуэт, а пятно

/** Цвет фона: медиана по четырём углам. Фон бывает и тёмным, и белым. */
function background(img) {
  const {data, width: W, height: H} = img;
  const px = [];
  for (const [x0, y0] of [[0, 0], [W - CORNER, 0], [0, H - CORNER], [W - CORNER, H - CORNER]])
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + CORNER); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + CORNER); x++) {
        const i = (y * W + x) * 4;
        px.push([data[i], data[i + 1], data[i + 2]]);
      }
  const med = k => {
    const v = px.map(p => p[k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return [med(0), med(1), med(2)];
}

/**
 * Строки силуэта: для каждой — где объект начинается и кончается.
 * @param {{data:Uint8ClampedArray|number[], width:number, height:number}} img
 * @param {number} threshold 0…1 — насколько цвет должен отличаться от фона
 */
export function silhouetteRows(img, threshold = 0.25) {
  if (!img || !img.data || !img.width || !img.height) return [];
  const {data, width: W, height: H} = img;
  const bg = background(img);
  const lim = threshold * 441.7;          // 441.7 — максимум расстояния в RGB
  const rows = [];
  for (let y = 0; y < H; y++) {
    let left = -1, right = -1, run = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const on = data[i + 3] >= 128 &&
        Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) > lim;
      if (on) {
        run++;
        if (run >= MIN_RUN) { if (left < 0) left = x - run + 1; right = x; }
      } else run = 0;
    }
    if (left >= 0) rows.push({y, left, right});
  }
  return rows;
}

/**
 * Профиль из строк силуэта.
 * @param {'auto'|'whole'|'half'} mode как понимать картинку
 * @returns {null|{points:{r:number,y:number}[], half:boolean, axis:number}}
 *   points — в пикселях картинки, y снизу вверх: как раз то, что ждёт traceToRecipe
 */
export function rowsToProfile(rows, imgW, mode = 'auto') {
  if (!rows || rows.length < MIN_ROWS) return null;

  /* Половина сечения или целое изделие. Признак — ось: если объект почти во всех
     строках упирается в один и тот же левый край, это чертёж половины, и ось
     проходит по нему. Иначе изделие снято целиком и ось — его середина. */
  const minLeft = Math.min(...rows.map(r => r.left));
  const hugging = rows.filter(r => r.left - minLeft <= Math.max(2, imgW * 0.01)).length / rows.length;
  const half = mode === 'half' || (mode === 'auto' && hugging > 0.8);

  const mids = rows.map(r => (r.left + r.right) / 2).sort((a, b) => a - b);
  const axis = half ? minLeft : mids[mids.length >> 1];

  const yMax = rows[rows.length - 1].y;
  const pts = rows.map(r => ({
    y: yMax - r.y,                                   // картинка растёт вниз, изделие — вверх
    r: half ? Math.max(0, r.right - axis) : (r.right - r.left) / 2,
  }));

  /* Дрожание края (пиксели, тень, зубцы чертежа) сглаживаем скользящим средним:
     дальше по этим точкам строят рецепт, и зубец превратился бы в уступ. */
  const sm = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    return {y: p.y, r: (a.r + p.r + b.r) / 3};
  });
  if (Math.max(...sm.map(p => p.r)) < 3) return null;   // полоска в три пикселя — не изделие
  // bottom — строка картинки, где изделие кончается: по ней показ переводит
  // точки обратно в пиксели, не пересчитывая всё заново
  return {points: sm, half, axis, bottom: yMax, top: rows[0].y};
}

/** Картинка → ломаная профиля за один вызов. */
export function traceImage(img, {threshold = 0.25, mode = 'auto'} = {}) {
  return rowsToProfile(silhouetteRows(img, threshold), img && img.width, mode);
}
