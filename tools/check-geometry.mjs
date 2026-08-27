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

console.log(`\nУсилие пресса: ⌀200 → ${f200.toFixed(1)} тс, ⌀400 → ${f400.toFixed(1)} тс (растёт как площадь)`);
console.log(`Экономика (чашка, Гжель): 10 шт — ${Math.round(small.machinePerPiece)} ₽/шт машиной против ${Math.round(small.manualPerPiece)} ₽/шт руками; 20 000 шт — ${Math.round(big.machinePerPiece)} против ${Math.round(big.manualPerPiece)}; окупаемость с ${small.breakEven} шт`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nГеометрия оснастки в порядке.');
