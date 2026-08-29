// Проверка обводки картинки:
//   node tools/check-silhouette.mjs
//
// Картинку приносит человек: фотография на столе, скан чертежа, PNG с прозрачным
// фоном, тёмный фон вместо белого. Обводка обязана давать один и тот же силуэт,
// а не форму, которая «почти похожа»: по ней потом считают глину и оснастку.
import { silhouetteRows, rowsToProfile, traceImage } from '../js/core/silhouette.js';
import { traceToRecipe } from '../js/core/trace.js';

const problems = [];
const P = t => problems.push(t);

/* Рисуем картинку формулой: r(y) в пикселях, объект на фоне. */
function render({W = 240, H = 300, bg = [245, 245, 240], ink = [40, 30, 25],
                 half = false, alpha = 255, rAt}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = alpha === 0 ? 0 : 255;
  }
  const axis = half ? 30 : W / 2;
  for (let y = 0; y < H; y++) {
    const t = 1 - y / (H - 1);                    // снизу вверх
    const r = rAt(t);
    if (r <= 0) continue;
    const x0 = half ? axis : Math.round(axis - r), x1 = Math.round(axis + r);
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const i = (y * W + x) * 4;
      data[i] = ink[0]; data[i + 1] = ink[1]; data[i + 2] = ink[2]; data[i + 3] = 255;
    }
  }
  return {data, width: W, height: H};
}

/* Кувшин: узкое дно, пузо, шейка. Ноль по краям не рисуем — изделие занимает всю высоту. */
const jugR = t => 18 + 60 * Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - t * 0.5) + 10 * Math.pow(t, 6);

/* 1. Целое изделие на светлом фоне: радиус читается, ось — середина. */
const whole = traceImage(render({rAt: jugR}));
if (!whole) P('целое изделие не обвелось');
else {
  if (whole.half) P('целое изделие принято за половину сечения');
  let worst = 0;
  for (const p of whole.points) {
    const t = p.y / (whole.points[0].y || 1);
    worst = Math.max(worst, Math.abs(p.r - jugR(1 - (1 - t))));
  }
  // сравниваем по высоте: точка с y соответствует t = y / maxY
  worst = 0;
  const maxY = Math.max(...whole.points.map(p => p.y));
  for (const p of whole.points) worst = Math.max(worst, Math.abs(p.r - jugR(p.y / maxY)));
  if (worst > 3) P(`целое изделие: радиус расходится с рисунком на ${worst.toFixed(1)} px`);
  console.log(`  целое изделие: строк ${whole.points.length}, расхождение ${worst.toFixed(1)} px`);
}

/* 2. Половина сечения (чертёж): ось слева, радиус — до правого края. */
const halfImg = render({rAt: jugR, half: true});
const halfTrace = traceImage(halfImg);
if (!halfTrace) P('половина сечения не обвелась');
else {
  if (!halfTrace.half) P('чертёж половины принят за целое изделие — радиус выйдет вдвое меньше');
  const maxY = Math.max(...halfTrace.points.map(p => p.y));
  let worst = 0;
  for (const p of halfTrace.points) worst = Math.max(worst, Math.abs(p.r - jugR(p.y / maxY)));
  if (worst > 3) P(`половина сечения: радиус расходится на ${worst.toFixed(1)} px`);
  console.log(`  половина сечения: строк ${halfTrace.points.length}, расхождение ${worst.toFixed(1)} px`);
}

/* 3. Тёмный фон и светлое изделие — то же самое: фон берётся с углов, а не «белый». */
const dark = traceImage(render({rAt: jugR, bg: [18, 16, 15], ink: [230, 220, 210]}));
if (!dark) P('на тёмном фоне изделие не найдено');
else if (dark.half) P('на тёмном фоне ось нашлась не там');

/* 4. Прозрачный фон (PNG чертежа): альфа важнее цвета. */
const png = traceImage(render({rAt: jugR, alpha: 0}));
if (!png) P('картинка с прозрачным фоном не обвелась');

/* 5. Ручное указание перебивает угадывание: половину можно объявить руками. */
const forced = traceImage(render({rAt: jugR}), {mode: 'half'});
if (!forced || !forced.half) P('режим «половина сечения» не сработал принудительно');

/* 6. Пустая картинка и полоска — не изделие. */
if (traceImage(render({rAt: () => 0}))) P('пустой фон принят за изделие');
if (traceImage(render({rAt: () => 1}))) P('полоска в два пикселя принята за изделие');
if (traceImage(null)) P('пустой аргумент не отбит');

/* 7. Обводка стыкуется с рецептом: то, что вышло с картинки, ложится в форму. */
if (whole) {
  const rec = traceToRecipe(whole.points);
  if (!rec) P('обведённый силуэт не сложился в рецепт');
  else {
    if (rec.points.length < 3 || rec.points.length > 24) P(`из картинки вышло ${rec.points.length} точек`);
    const ratioImg = Math.max(...whole.points.map(p => p.y)) / (2 * Math.max(...whole.points.map(p => p.r)));
    const ratioRec = rec.H / rec.D;
    if (Math.abs(ratioImg - ratioRec) / ratioImg > 0.2)
      P(`пропорция картинки не дожила до рецепта: ${ratioImg.toFixed(2)} против ${ratioRec.toFixed(2)}`);
    console.log(`  рецепт с картинки: точек ${rec.points.length}, ${rec.H}×${rec.D} мм`);
  }
}

/* 8. Порог: слишком высокий не должен рождать силуэт из ничего. */
if (silhouetteRows(render({rAt: jugR}), 0.99).length)
  P('при пороге 0.99 нашёлся силуэт — значит, порог ни на что не влияет');

console.log('\nПроверка обводки картинки');
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nСилуэт снимается с картинки без потерь.');
