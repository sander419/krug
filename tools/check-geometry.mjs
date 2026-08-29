// Проверка геометрии оснастки и математики профиля из командной строки:
//   node --import ./tools/node-three.mjs tools/check-geometry.mjs
// Браузер для этого не нужен — ядро не знает про DOM.
import { state } from '../js/core/state.js';
import { PRESETS } from '../js/config/data.js';
import { MATERIALS } from '../js/config/materials.js';
import { computeProduction } from '../js/core/math.js';
import { analyzeFormability, recommendProcess, toolingNumbers, shrinkFactor,
         rawForTarget, firedFromRaw, undercutList } from '../js/core/tooling.js';
import { modelPath, cavityPath, corePath, rollerProfile, cavityStock, wareProfiles,
         MOULD_DEFAULTS } from '../js/core/mould.js';
import { userProfileMM } from '../js/core/math.js';
import { buildDXF } from '../js/core/dxf.js';
import { buildPot } from '../js/core/geometry.js';
import { makePart, sanitizePart, partMetrics, partsWarnings, partCurve, azGap,
         partsHandMinutes, fillLevelY, fillLimitedBy, partMouldEstimate,
         partsVolumeMl } from '../js/core/parts.js';
import { strainerHoles, strainerSpec, strainerWarnings, rimIndex } from '../js/core/strainer.js';
import * as THREE from 'three';
import { economics, pricePerKg } from '../js/core/economics.js';
import { PLASTERS, plasterMix, byId as plasterById } from '../js/config/plasters.js';

const problems = [];
const P = t => problems.push(t);
const fin = v => typeof v === 'number' && isFinite(v);
const setShape = (pts, H, D, wall = 5) => {
  state.points = pts.map(p => ({...p}));
  state.H = H; state.D = D; state.wall = wall; state.hollow = true;
};

const CASES = [
  ['ваза',     PRESETS[1].pts, 220, 160],
  ['чашка',    PRESETS[0].pts, 90, 85],
  ['тарелка',  PRESETS[3].pts, 45, 270],
  ['конус',    [{t: 0, r: 0.45}, {t: 0.5, r: 0.72}, {t: 1, r: 1}], 90, 150],
  ['цилиндр',  [{t: 0, r: 1}, {t: 1, r: 1}], 100, 90],
];

console.log('Проверка геометрии оснастки\n');
for (const [name, pts, H, D] of CASES) {
  setShape(pts, H, D);
  const an = analyzeFormability(state);
  const rec = recommendProcess(state, an);
  const paths = {
    'модель': modelPath(state),
    'матрица': cavityPath(state),
    'пуансон': corePath(state),
  };
  const roller = rollerProfile(state);

  for (const [pname, path] of Object.entries(paths)) {
    if (!path) { P(`${name}/${pname}: контур не построен`); continue; }
    if (path.length < 4) P(`${name}/${pname}: контур из ${path.length} точек — тела не выйдет`);
    if (path.some(p => !fin(p.r) || !fin(p.y))) P(`${name}/${pname}: NaN в контуре`);
    if (path.some(p => p.r < 0)) P(`${name}/${pname}: отрицательный радиус`);
    // тело вращения замыкается осью: контур обязан начинаться и кончаться на ней
    const first = path[0], last = path[path.length - 1];
    if (first.r > 0.05 || last.r > 0.05)
      P(`${name}/${pname}: контур не выходит на ось (начало r=${first.r.toFixed(2)}, конец r=${last.r.toFixed(2)}) — тело не замкнётся`);
    if (Math.hypot(first.r - last.r, first.y - last.y) < 0.02)
      P(`${name}/${pname}: первая и последняя точки совпали — вырожденное кольцо`);
    for (let i = 1; i < path.length; i++)
      if (Math.hypot(path[i].r - path[i - 1].r, path[i].y - path[i - 1].y) < 0.005)
        P(`${name}/${pname}: две совпадающие точки подряд в позиции ${i}`);
  }

  // матрица обязана вмещать изделие, пуансон — помещаться внутрь
  const wp = wareProfiles(state);
  const cav = paths['матрица'];
  const cavR = Math.max(...cav.map(p => p.r));
  if (cavR < wp.maxR + MOULD_DEFAULTS.wallMM - 0.01)
    P(`${name}: радиус матрицы ${cavR.toFixed(1)} меньше изделия плюс стенка формы`);
  const cavBottom = Math.min(...cav.map(p => p.y));
  if (cavBottom > -MOULD_DEFAULTS.baseMM + 0.01) P(`${name}: у матрицы нет дна`);
  const core = paths['пуансон'];
  if (core) {
    const coreMax = Math.max(...core.filter(p => p.y <= wp.H).map(p => p.r));
    if (coreMax > wp.maxR + 0.01 && coreMax < MOULD_DEFAULTS.wallMM + wp.maxR - 0.01)
      P(`${name}: рабочая часть пуансона шире изделия`);
  }
  if (roller) {
    const rmax = Math.max(...roller.map(p => p.r));
    if (rmax > wp.maxR - state.wall + 0.5) P(`${name}: профиль ролика выходит за внутреннюю поверхность`);
  }

  const stock = cavityStock(state);
  if (!fin(stock.grossLitres) || stock.grossLitres <= 0) P(`${name}: габарит матрицы посчитан неверно`);
  if (!(stock.netLitres > 0 && stock.netLitres < stock.grossLitres))
    P(`${name}: тело формы ${stock.netLitres} л должно быть меньше блока ${stock.grossLitres} л и больше нуля`);
  const mix = plasterMix(stock.netLitres, 70);
  if (!fin(mix.plasterKg) || mix.plasterKg <= 0) P(`${name}: замес гипса не посчитан`);
  if (Math.abs(mix.waterL - mix.plasterKg * 0.7) > 1e-9) P(`${name}: вода не сходится с В/Г`);

  const dxf = buildDXF([
    {name: 'IZDELIE', points: wp.outer},
    {name: 'MATRICA', points: cav, closed: true},
  ], ['test']);
  if (!dxf.startsWith('0\nSECTION')) P(`${name}: DXF не начинается с секции`);
  if (!dxf.trim().endsWith('EOF')) P(`${name}: DXF без EOF`);
  if (/NaN|Infinity|undefined/.test(dxf)) P(`${name}: мусор в координатах DXF`);

  console.log(`  ${name.padEnd(9)} перегибов ${an.undercuts} · частей ${an.parts} · ${rec.id.padEnd(8)}` +
    ` · матрица ⌀${(cavR * 2).toFixed(0)}×${stock.heightMM.toFixed(0)} мм (${stock.grossLitres.toFixed(1)} л)` +
    ` · точек: модель ${paths['модель'].length}, матрица ${cav.length}, пуансон ${core ? core.length : '—'}`);
}

// усадка: туда-обратно на всех массах
for (const m of MATERIALS) {
  const k = shrinkFactor(m).k;
  if (!(k > 1 && k < 1.5)) P(`${m.id}: коэффициент усадки ${k}`);
  const back = firedFromRaw(rawForTarget(270, m), m);
  if (Math.abs(back - 270) > 1e-6) P(`${m.id}: пересчёт размера не сходится: ${back}`);
}

// усилие пресса растёт с площадью
setShape(PRESETS[3].pts, 45, 200);
const f200 = toolingNumbers(state, computeProduction(state), analyzeFormability(state), 'ram').forceTons[1];
setShape(PRESETS[3].pts, 45, 400);
const f400 = toolingNumbers(state, computeProduction(state), analyzeFormability(state), 'ram').forceTons[1];
if (!(f400 > f200 * 3.5)) P(`усилие пресса не растёт как площадь: ${f200.toFixed(1)} → ${f400.toFixed(1)} тс`);

// поднутрение считается и по пузу, и по горлу
setShape([{t: 0, r: 0.4}, {t: 0.4, r: 1}, {t: 0.75, r: 0.5}, {t: 1, r: 0.62}], 200, 160);
const uc = undercutList(userProfileMM(state));
if (uc.length !== 2) P(`ваза с пузом и горлом: перегибов ${uc.length}, ожидалось 2`);
if (!uc.some(u => u.kind === 'пузо') || !uc.some(u => u.kind === 'горло'))
  P('перегибы не различаются на пузо и горло');

// экономика: цена за килограмм, рост партии, точка окупаемости
setShape(PRESETS[0].pts, 90, 85);
for (const m of MATERIALS) {
  const per = pricePerKg(m);
  if (m.priceRub != null && !(per > 0 && per < 2000)) P(`${m.id}: цена ${per} ₽/кг вне разумного`);
}
state.mat = 'gzhel-red';
const prodCup = computeProduction(state);
const small = economics(state, prodCup, 'ram', {batch: 10});
const big = economics(state, prodCup, 'ram', {batch: 20000});
if (!(small.machineTotal > 0 && big.machineTotal > small.machineTotal)) P('стоимость партии не растёт с тиражом');
if (!(big.machinePerPiece < small.machinePerPiece)) P('оснастка не размазывается по тиражу: цена штуки не падает');
if (small.cheaper !== 'manual') P('на десяти штуках оснастка не должна быть выгоднее рук');
if (big.cheaper !== 'machine') P('на двадцати тысячах штук машина должна выигрывать');
if (!(small.breakEven > 10)) P(`точка окупаемости ${small.breakEven} — должна быть больше десяти штук`);
const noPrice = economics({...state, mat: 'mkf-2'}, prodCup, 'ram', {batch: 500});
if (noPrice.perKg !== null) P('масса без цены должна давать perKg = null, а не число');
if (!isFinite(noPrice.machineTotal)) P('без цены материала расчёт всё равно должен считаться');
if (!economics(state, prodCup, 'casting', {batch: 500}).sets.known) P('у литья ресурс формы должен быть известен');
if (economics(state, prodCup, 'ram', {batch: 500}).sets.known) P('у штамповки ресурс формы неизвестен — не выдумывать');

/* ---------- тело вращения и «Кинотеатр» ---------- */
setShape(PRESETS[1].pts, 220, 160);
state.hollow = true; state.wall = 5; state.footH = 6; state.segments = 48;

// знаковый объём: положительный — нормали фасетов наружу, слайсер такой STL примет
function signedVolume(g) {
  const p = g.attributes.position, idx = g.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i)); b.fromBufferAttribute(p, idx.getX(i + 1)); c.fromBufferAttribute(p, idx.getX(i + 2));
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}
state.stage = 6;
const potBuilt = buildPot(state);
if (!(signedVolume(potBuilt.geometry) > 0)) P('нормали тела вращения смотрят внутрь: STL уйдёт вывернутым');
const lathe = new THREE.LatheGeometry(potBuilt.path, state.segments);
const vRef = signedVolume(lathe), vOwn = signedVolume(potBuilt.geometry);
if (Math.abs(vRef - vOwn) / Math.abs(vRef) > 1e-6)
  P(`свой построитель разошёлся с LatheGeometry: ${vOwn.toFixed(0)} против ${vRef.toFixed(0)}`);

// «Кинотеатр» не должен дёргаться: ни один шаг этапа не меняет объём рывком
let prevV = null, worst = 0, worstAt = 0;
for (let u = 0; u <= 6.0001; u += 0.05) {
  state.stage = u;
  const v = Math.abs(signedVolume(buildPot(state).geometry));
  if (!Number.isFinite(v)) { P(`этап ${u.toFixed(2)}: объём не число`); break; }
  if (prevV !== null) {
    const jump = Math.abs(v - prevV) / Math.max(prevV, 1);
    if (jump > worst) { worst = jump; worstAt = u; }
  }
  prevV = v;
}
if (worst > 0.12) P(`на этапе ${worstAt.toFixed(2)} объём прыгает на ${(worst * 100).toFixed(0)} % за шаг 0.05 — форма меняется рывком`);
state.stage = 6;

// буферы переиспользуются: при неизменной топологии объект геометрии остаётся прежним
const gA = buildPot(state).geometry;
const gB = buildPot(state, gA).geometry;
if (gA !== gB) P('геометрия пересоздаётся там, где топология не менялась');
state.D = 170;
if (buildPot(state, gB).geometry !== gB) P('изменение размера не должно менять топологию');
state.D = 160;

/* ---------- прилепы: ручки и носики ---------- */
setShape(PRESETS[0].pts, 110, 90);
state.wall = 6;
{
  const h = sanitizePart({kind: 'handle', az: 0, top: 0.8, bot: 0.3, out: 40, thick: 10, wide: 20});
  const sp = sanitizePart({kind: 'spout', az: 180, at: 0.6, len: 55, rise: 20, bore: 14, tip: 7});
  state.parts = [h, sp];
  const prof = userProfileMM(state);

  const mh = partMetrics(prof, h), ms = partMetrics(prof, sp);
  if (!(mh.len > 50 && mh.len < 400)) P(`длина ручки ${mh.len.toFixed(0)} мм вне разумного`);
  if (!(ms.len > 20 && ms.len < 200)) P(`длина носика ${ms.len.toFixed(0)} мм вне разумного`);
  if (!(mh.volMl > 3 && ms.volMl > 1)) P('объёмы прилепов пустые');

  const withParts = computeProduction(state).massF;
  state.parts = [];
  const bare = computeProduction(state).massF;
  state.parts = [h, sp];
  const dm = withParts - bare;
  if (!(dm > 0)) P('прилепы не добавляют массы');
  if (Math.abs(dm - (mh.volMl + ms.volMl) * 1.92) > dm * 0.12) P('масса прилепов расходится с их объёмом');

  const pr = computeProduction(state);
  if (!pr.cutBySpout) P('носик ниже кромки, а вместимость не срезана');
  if (!(pr.fillMl > 0 && pr.fillMl < pr.capMl)) P(`налив ${pr.fillMl.toFixed(0)} мл не между нулём и полной ${pr.capMl.toFixed(0)}`);
  state.parts = [h];
  if (computeProduction(state).cutBySpout) P('без носика вместимость резать нечем');
  state.parts = [h, sp];

  const rAt = y => prof.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a)).r;
  const hp = partCurve(prof, h).getPoints(20);
  if (!(hp[0].x <= rAt(hp[0].y) + 0.5)) P('верхний прилеп ручки висит в воздухе');
  if (!(hp[20].x <= rAt(hp[20].y) + 0.5)) P('нижний прилеп ручки висит в воздухе');
  if (!(hp[10].x > rAt(hp[10].y) + h.out * 0.5)) P('середина ручки не вынесена наружу');
  const spp = partCurve(prof, sp).getPoints(20);
  if (!(spp[0].x <= rAt(spp[0].y) + 0.5)) P('корень носика висит в воздухе');
  if (!(spp[20].y > spp[0].y)) P('носик с положительным подъёмом должен смотреть вверх');

  state.parts = [{...h, thick: 2}];
  if (!partsWarnings(state, prof).some(w => w.lvl === 'bad')) P('лента тоньше стенки — нет замечания');
  state.parts = [h, {...h, az: 5}];
  if (!partsWarnings(state, prof).some(w => /друг от друга/.test(w.txt))) P('два прилепа рядом — нет замечания о слиянии');
  state.parts = [h, {...h, az: 180}];
  if (partsWarnings(state, prof).some(w => /друг от друга/.test(w.txt))) P('прилепы напротив ругаться не должны');

  if (azGap(makePart('handle', [{az: 0}]).az, 0) < 170) P('вторая деталь должна вставать напротив первой');
  if (partsHandMinutes([h, sp]) !== 10) P('ручная работа по прилепам считается не так');
  if (fillLevelY(prof, [h]) !== prof[prof.length - 1].y) P('без носика уровень налива — это кромка');

  /* слив: деформация кромки, а не приставная деталь */
  const lip = sanitizePart({kind: 'lip', az: 0, width: 34, out: 9, drop: 6});
  state.parts = [lip];
  if (partsVolumeMl(prof, [lip]) !== 0) P('слив глины не добавляет: это отогнутая стенка');
  const pl = computeProduction(state);
  if (!pl.cutBySpout) P('слив опускает кромку — налив обязан уменьшиться');
  if (fillLimitedBy(prof, [lip]) !== 'lip') P('налив режет слив, а не что-то другое');
  if (Math.abs(fillLevelY(prof, [lip]) - (prof[prof.length - 1].y - lip.drop)) > 0.01)
    P('уровень налива со сливом не совпадает с опущенной кромкой');
  if (partMouldEstimate(prof, lip) !== null) P('сливу гипсовая форма не нужна');
  state.wall = 12;
  if (!partsWarnings(state, prof).some(w => /оттянуть/.test(w.txt))) P('толстую кромку оттянуть нельзя — нет замечания');
  state.wall = 6;
  state.parts = [{...lip, drop: 0}];
  if (!partsWarnings(state, prof).some(w => /не опущена/.test(w.txt))) P('слив без понижения кромки — нет замечания');

  /* форма под прилеп: блок больше детали, гипса меньше блока */
  state.parts = [h];
  const est = partMouldEstimate(prof, h);
  if (!(est && est.halves === 2)) P('форма под ручку должна быть из двух половин');
  const boxL = est.boxMM[0] * est.boxMM[1] * est.boxMM[2] / 1e6;
  if (!(est.netL > 0 && est.netL < boxL)) P('гипса в форме должно быть меньше объёма блока');
  if (!(est.boxMM.every(v => v > 20))) P('габарит формы под прилеп подозрительно мал');
}
state.parts = [];
setShape(PRESETS[1].pts, 220, 160);

/* ---------- отверстие с ситечком ---------- */
{
  setShape(PRESETS[1].pts, 220, 160);
  state.wall = 5; state.hollow = true; state.stage = 6;
  const sp = sanitizePart({kind: 'spout', az: 0, at: 0.62, len: 60, rise: 22, bore: 16, tip: 8, mesh: 7});
  state.parts = [sp];

  const h = strainerHoles(sp);
  if (h.count !== 7) P(`ситечко на 7 отверстий дало ${h.count}`);
  if (!(h.ratio > 0 && h.ratio < 3)) P(`живое сечение ${h.ratio.toFixed(2)} вне разумного`);
  const wide = strainerHoles({...sp, mesh: 13});
  if (!(wide.ratio > h.ratio)) P('больше отверстий — больше живого сечения');
  const one = strainerHoles({...sp, mesh: 1});
  if (one.count !== 1) P('одно отверстие должно оставаться одним');
  if (!(one.holes[0].r * 2 > h.holes[0].r * 2)) P('единственное отверстие должно быть шире дырочки решета');

  const built = buildPot(state);
  if (!(built.strainers && built.strainers.length === 1)) P('разметка ситечка не построилась');
  const spec = built.strainers[0];
  const jRim = rimIndex(built.path);
  if (!(spec.box.jOut1 <= jRim && spec.box.jIn0 >= jRim))
    P('вырез должен лежать по одну сторону кромки на каждой стенке');
  if (!(spec.box.i1 > spec.box.i0)) P('вырез по кругу пустой');
  if (!(spec.holes.every(x => Math.hypot(x.x, x.y) + x.r < spec.holes[0].r + spec.field * 1.2)))
    P('дырочки вылезают за поле ситечка');

  // тело вращения обязано отдать клетки под вырез
  const noHole = buildPot({...state, parts: []});
  const withHole = buildPot(state);
  if (!(withHole.geometry.index.count < noHole.geometry.index.count))
    P('вырез не убрал ни одного треугольника из тела');

  // предупреждения: узкое решето душит носик
  state.parts = [{...sp, mesh: 3}];
  if (!strainerWarnings(state).some(x => /живое сечение/.test(x.txt))) P('узкое ситечко — нет замечания о сечении');
  state.parts = [{...sp, mesh: 13, bore: 8}];
  if (!strainerWarnings(state).some(x => /забьются/.test(x.txt))) P('мелкие дырочки — нет замечания о засоре');
  state.parts = [sp];
  if (strainerWarnings(state).some(x => x.lvl === 'bad')) P('нормальное ситечко ругаться не должно');
}
state.parts = [];
setShape(PRESETS[1].pts, 220, 160);

console.log(`\nУсилие пресса: ⌀200 → ${f200.toFixed(1)} тс, ⌀400 → ${f400.toFixed(1)} тс (растёт как площадь)`);
console.log(`Кинотеатр: самый резкий шаг меняет объём на ${(worst * 100).toFixed(1)} % (порог 12 %)`);
console.log(`Экономика (чашка, Гжель): 10 шт — ${Math.round(small.machinePerPiece)} ₽/шт машиной против ${Math.round(small.manualPerPiece)} ₽/шт руками; 20 000 шт — ${Math.round(big.machinePerPiece)} против ${Math.round(big.manualPerPiece)}; окупаемость с ${small.breakEven} шт`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nГеометрия оснастки в порядке.');
