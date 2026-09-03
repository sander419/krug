// Одна правда на все представления:
//   node --import ./tools/node-three.mjs tools/check-truth.mjs
//
// У изделия семь лиц: модель на экране, STL, OBJ, G-code, масса, чертёж
// и развёртка. Все они обязаны показывать **одну вещь**. Разойтись они могут
// тихо: рельеф считает одна функция, а слайсер завёл себе «упрощённый» —
// и человек печатает не то, что видел. Заметить это по картинке нельзя:
// обе выглядят правдоподобно.
//
// Проверка берёт одно изделие с рельефом, ставит пробу в одной и той же точке
// (угол, высота) и спрашивает у каждого представления: сколько тут металла…
// то есть глины. Сравниваются не абсолютные радиусы — у G-code свой сдвиг
// на половину бусины, у сетки свой шаг сегментов, — а **размах рельефа между
// гребнем и ложбиной**: он обязан совпасть везде.
import { state } from '../js/core/state.js';
import { PRESETS } from '../js/config/data.js';
import { userProfileMM, computeProduction, radiusAt } from '../js/core/math.js';
import { sanitizePattern, patternOffset, patternOutline, patternMap,
         patternVolumeMl, patternTitle, patternSummary } from '../js/core/pattern.js';
import { buildPot } from '../js/core/geometry.js';
import { sliceGCode, beadWidth } from '../js/core/slicer.js';
import { PRINTERS } from '../js/config/data.js';
import { modelFiles, objText } from '../js/three/exporters.js';

const problems = [];
const P = t => problems.push(t);

/* Изделие пробы: каннелюры на всю высоту — рельеф, который виден в каждом
   представлении и не гасится поясом. Двенадцать повторов и семьдесят два
   сегмента: гребень и ложбина попадают ровно на сегменты сетки. */
Object.assign(state, {
  points: PRESETS[1].pts.map(p => ({...p})),
  H: 220, D: 160, segments: 72, rings: 0, hollow: true, wall: 6,
  footH: 6, footK: 62, allow: 20, mat: 'gzhel-red', firing: 'raw', stage: 6,
  parts: [], lid: {on: false}, glazeId: 'clear-gloss', glaze: {al: 0.3, si: 3.6, ca: 0.7},
  pattern: {layers: [{id: 'flute', n: 12, depth: 3}]},
  pr: {printer: 1, nozzle: 4, lh: 2.4, feed: 1800, cart: 20, flow: 100, tau: 8},
  kiln: {id: 'studio-60', kwh: 6}, cast: {}, cost: {}, tune: {}, plaster: {id: 'gvvs-16', wr: 70},
});

const pat = sanitizePattern(state.pattern);
const prof = userProfileMM(state);
const H = prof[prof.length - 1].y;
const yProbe = H * 0.55;                       // середина стенки: гашение здесь не работает
const thCrest = 0, thTrough = Math.PI / 12;    // cos(12θ): гребень на 0, ложбина на π/12

/* Истина: смещение радиуса в этих двух точках. Всё остальное сверяется с ней. */
const dCrest = patternOffset(pat, thCrest, yProbe, H);
const dTrough = patternOffset(pat, thTrough, yProbe, H);
const swing = dCrest - dTrough;                // размах рельефа, мм
if (!(swing > 5.5 && swing < 6.5)) P(`сама модель рельефа даёт размах ${swing.toFixed(2)} вместо шести`);

/* ---------- 1. сетка (экран, STL, OBJ, GLB) ---------- */
/* Модель на экране, STL и OBJ строятся из одной геометрии — значит достаточно
   проверить её и то, что выгрузка берёт именно её, а не собирает свою. */
{
  const built = buildPot(state);
  const pos = built.geometry.attributes.position;
  const n = built.path.length, segs = Math.round(pos.count / n) - 1;
  const radiusAtSeg = (seg, y) => {
    let best = null, bestDy = Infinity;
    for (let j = 0; j < n; j++) {
      const p = built.path[j];
      if (!p.outer) continue;                  // рельеф только на наружной стенке
      const dy = Math.abs(p.y - y);
      if (dy < bestDy) { bestDy = dy; best = j; }
    }
    if (best === null) return null;
    const v = seg * n + best;
    return {r: Math.hypot(pos.array[v * 3], pos.array[v * 3 + 2]), y: pos.array[v * 3 + 1], j: best};
  };
  const segCrest = 0;                                   // φ = 0
  const segTrough = Math.round(segs / 24);              // φ = π/12 при 72 сегментах
  const a = radiusAtSeg(segCrest, yProbe), b = radiusAtSeg(segTrough, yProbe);
  if (!a || !b) P('в сетке не нашлось наружных точек — пробу ставить не на что');
  else {
    const meshSwing = a.r - b.r;
    if (Math.abs(meshSwing - swing) > 0.15)
      P(`сетка: размах ${meshSwing.toFixed(2)} мм против ${swing.toFixed(2)} у модели рельефа`);
    /* И сам радиус: гребень стоит там, где ему велено, а не «примерно там». */
    const rSmooth = radiusAt(prof, a.y);
    if (Math.abs((a.r - rSmooth) - patternOffset(pat, 0, a.y, H)) > 0.15)
      P(`сетка: гребень отстоит от гладкой стенки на ${(a.r - rSmooth).toFixed(2)} вместо ${patternOffset(pat, 0, a.y, H).toFixed(2)}`);
  }

  /* Выгрузка обязана нести тот же рельеф. OBJ читаем как текст: он собран
     из той же геометрии, и если кто-то заведёт для него свой построитель,
     размах разъедется. */
  /* В OBJ сверяем не радиусы, а **отступ от гладкой стенки**: у вазы радиус
     сам меняется по высоте, и срез конечной толщины смешал бы наклон профиля
     с рельефом. Отступ считается для каждой вершины на её собственной высоте. */
  const obj = objText(state);
  const objOff = [];
  for (const line of obj.split(/\r?\n/)) {
    if (!line.startsWith('v ')) continue;
    const [, x, y, z] = line.split(/\s+/);
    const Y = +y;
    if (Math.abs(Y - yProbe) > H * 0.02) continue;
    const r = Math.hypot(+x, +z), rs = radiusAt(prof, Y);
    if (r < rs - state.wall * 0.5) continue;          // это изнанка, у неё рельефа нет
    objOff.push(r - rs);
  }
  if (objOff.length < 20) P(`в OBJ около пробы ${objOff.length} наружных вершин — мало для сверки`);
  else {
    const objSwing = Math.max(...objOff) - Math.min(...objOff);
    if (Math.abs(objSwing - swing) > 0.6)
      P(`OBJ: размах рельефа ${objSwing.toFixed(2)} мм против ${swing.toFixed(2)} у модели`);
  }

  const files = modelFiles(state);
  if (!files.length) P('выгрузка не дала ни одного файла модели');
}

/* ---------- 2. G-code ---------- */
/* Сопло ходит по тому же рельефу. Радиус в G-code меньше на половину бусины,
   поэтому сверяется размах между гребнем и ложбиной на одной высоте. */
{
  const g = sliceGCode(state);
  const bead = beadWidth(state);
  /* Центр изделия на столе берётся из того же реестра, что и у слайсера:
     у портальной машины ноль в углу, у дельты — в центре. Своя константа
     здесь смещала пробу на полстола. */
  const P0 = PRINTERS[state.pr.printer];
  const cx = P0.origin === 'center' ? 0 : P0.bed[0] / 2;
  const cy = P0.origin === 'center' ? 0 : P0.bed[1] / 2;
  const gOff = [];
  for (const line of g.text.split(/\r?\n/)) {
    const m = /^G1 X(-?[\d.]+) Y(-?[\d.]+) Z(-?[\d.]+)/.exec(line);
    if (!m) continue;
    const x = +m[1] - cx, y = +m[2] - cy, z = +m[3];
    if (Math.abs(z - yProbe) > 1.5) continue;
    /* Как и в OBJ: отступ от гладкой стенки на своей высоте, плюс полбусины —
       сопло ведут по середине жгута, а не по наружной поверхности. */
    gOff.push(Math.hypot(x, y) - (radiusAt(prof, z) - bead / 2));
  }
  if (gOff.length < 20) P(`в G-code около пробы ${gOff.length} точек — мало для сверки`);
  else {
    const gSwing = Math.max(...gOff) - Math.min(...gOff);
    if (Math.abs(gSwing - swing) > 0.5)
      P(`G-code: размах рельефа ${gSwing.toFixed(2)} мм против ${swing.toFixed(2)} у модели`);
    const top = Math.max(...gOff);
    const want = patternOffset(pat, 0, yProbe, H);
    if (Math.abs(top - want) > 0.5)
      P(`G-code: гребень отстоит от гладкой стенки на ${top.toFixed(2)} вместо ${want.toFixed(2)}`);
  }
}

/* ---------- 3. масса ---------- */
/* Поправка объёма от рельефа считается отдельной формулой — значит обязана
   сойтись с тем, что даёт сама сетка. */
{
  const withPat = computeProduction(state).volMl;
  const keep = state.pattern;
  state.pattern = {layers: []};
  const smooth = computeProduction(state).volMl;
  state.pattern = keep;
  const byFormula = patternVolumeMl(pat, prof);
  if (Math.abs((withPat - smooth) - byFormula) > 0.01)
    P(`масса: рельеф добавил ${(withPat - smooth).toFixed(2)} см³, а формула считает ${byFormula.toFixed(2)}`);
}

/* ---------- 4. чертёж и лист ---------- */
/* Огибающие — те же числа, которыми считается рельеф. */
{
  const env = patternOutline(pat, prof);
  let bad = 0;
  for (const e of env) {
    const hi = patternOffset(pat, 0, e.y, H);
    if (e.hi < hi - 0.01) bad++;
  }
  if (bad) P(`чертёж: у ${bad} точек огибающая ниже настоящего гребня`);
  const mid = env.reduce((a, b) => (Math.abs(b.y - yProbe) < Math.abs(a.y - yProbe) ? b : a));
  if (Math.abs((mid.hi - mid.lo) - swing) > 0.2)
    P(`чертёж: размах огибающих ${(mid.hi - mid.lo).toFixed(2)} против ${swing.toFixed(2)}`);
}

/* ---------- 5. развёртка ---------- */
{
  const map = patternMap(pat, {H, D: state.D, cols: 144, rows: 100});
  const row = Math.round(yProbe / H * (map.rows - 1));
  let hi = -Infinity, lo = Infinity;
  for (let j = 0; j < map.cols; j++) {
    const v = map.mm[row * map.cols + j];
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  if (Math.abs((hi - lo) - swing) > 0.2)
    P(`развёртка: размах ${(hi - lo).toFixed(2)} против ${swing.toFixed(2)}`);
}

/* ---------- 6. техкарта и паспорт ---------- */
/* Словами — тот же узор: название и описание собираются из той же стопки. */
{
  const title = patternTitle(pat);
  if (!/Каннелюры/.test(title)) P(`техкарта назвала узор «${title}»`);
  const sum = patternSummary(pat);
  if (sum.length !== 1) P(`описание для цеха: строк ${sum.length} вместо одной`);
  else if (!/3/.test(sum[0]) || !/12/.test(sum[0]))
    P(`описание для цеха потеряло числа слоя: «${sum[0]}»`);
}

console.log('\nОдна правда на все представления');
console.log(`  проба: угол 0 и π/12 на высоте ${yProbe.toFixed(0)} мм · размах рельефа ${swing.toFixed(2)} мм`);
console.log('  сверены: сетка, OBJ, G-code, масса, чертёж, развёртка, техкарта');
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const t of problems) console.log('  ✗ ' + t);
  process.exit(1);
}
console.log('\nВсе представления показывают один и тот же рельеф.');
