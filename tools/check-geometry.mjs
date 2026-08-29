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
import { userProfileMM, radiusAt } from '../js/core/math.js';
import { buildDXF } from '../js/core/dxf.js';
import { buildPot } from '../js/core/geometry.js';
import { makePart, sanitizePart, partMetrics, partsWarnings, partCurve, azGap, partSelfOverlap,
         pathFromParams, pathFromStroke, syncFieldsFromPath,
         partsHandMinutes, fillLevelY, fillLimitedBy,
         partsVolumeMl } from '../js/core/parts.js';
import { partMouldGeometry, partMouldBlock, partMouldFeatures } from '../js/three/partMould.js';
import { kindOf, limitOf, PART_KINDS } from '../js/config/parts.js';
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
  if (!kindOf(lip).deform) P('слив должен быть деформацией, а не приставной деталью');
  state.wall = 12;
  if (!partsWarnings(state, prof).some(w => /оттянуть/.test(w.txt))) P('толстую кромку оттянуть нельзя — нет замечания');
  state.wall = 6;
  state.parts = [{...lip, drop: 0}];
  if (!partsWarnings(state, prof).some(w => /не опущена/.test(w.txt))) P('слив без понижения кромки — нет замечания');

  /* Счёт направленных рёбер: каждое обязано встретиться ровно раз вместе
     с обратным. Дырка в сетке или вывернутый треугольник ломают и заливку гипса,
     и печать STL, а на глаз не видны — эта проверка их и ловит. */
  const edgeAudit = geo => {
    const q = geo.attributes.position;
    const key = i => [q.getX(i), q.getY(i), q.getZ(i)].map(v => Math.round(v * 100) / 100).join(',');
    const dirs = new Map();
    for (let i = 0; i < q.count; i += 3) {
      const k = [key(i), key(i + 1), key(i + 2)];
      for (let e = 0; e < 3; e++) {
        const id = k[e] + '>' + k[(e + 1) % 3];
        dirs.set(id, (dirs.get(id) || 0) + 1);
      }
    }
    let open = 0, flipped = 0;
    for (const [id, n] of dirs) {
      if (n > 1) flipped++;
      const [x, y] = id.split('>');
      if (!dirs.has(y + '>' + x)) open++;
    }
    return {open, flipped};
  };

  /* полуформа под прилеп: замкнутое тело, канавка внутри блока */
  state.parts = [h];
  for (const p of [h, sanitizePart({kind: 'spout', az: 0})]) {
    const blk = partMouldBlock(prof, p, 20);
    if (!(blk.blockMM.every(v => v > 20))) P('габарит полуформы подозрительно мал');
    const m = partMouldGeometry(prof, p, 20, {half: 'bump'});
    const pos = m.geometry.attributes.position;
    let vol = 0;
    const a1 = new THREE.Vector3(), b1 = new THREE.Vector3(), c1 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a1.fromBufferAttribute(pos, i); b1.fromBufferAttribute(pos, i + 1); c1.fromBufferAttribute(pos, i + 2);
      vol += a1.dot(b1.clone().cross(c1)) / 6;
    }
    const solidL = vol / 1e6, halfPartL = partMetrics(prof, p).volMl / 2000;
    if (!(solidL > 0)) P(`полуформа ${p.kind}: нормали смотрят внутрь, STL уйдёт вывернутым`);
    if (!(solidL < blk.boxL)) P(`полуформа ${p.kind}: канавка не убавила объём блока`);
    // бугорки замков добавляют объём, облойная канавка убавляет
    const expect = halfPartL - m.keysL + m.flashL;
    if (!(m.flashL > 0)) P(`полуформа ${p.kind}: облойной канавки нет, облой держит половины враспор`);
    if (Math.abs((blk.boxL - solidL) - expect) > Math.abs(expect) * 0.12 + 0.0005)
      P(`полуформа ${p.kind}: канавка не совпадает с половиной детали (${((blk.boxL - solidL) * 1000).toFixed(1)} против ${(expect * 1000).toFixed(1)} см³)`);

    const {open, flipped} = edgeAudit(m.geometry);
    if (open) P(`полуформа ${p.kind}: ${open} рёбер без пары — тело не замкнуто`);
    if (flipped) P(`полуформа ${p.kind}: ${flipped} рёбер повторяются — треугольники смотрят в разные стороны`);
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    if (!(bb.min.y > -0.01)) P(`полуформа ${p.kind}: блок должен стоять на нуле`);
    // бугорки замков торчат над разъёмом, поэтому блок выше на их высоту
    if (Math.abs((bb.max.y - bb.min.y) - (blk.depth + m.keyH)) > 0.01)
      P(`полуформа ${p.kind}: высота блока не сходится`);
    m.geometry.dispose();

    /* вторая половина: те же требования, но замки лунками */
    const m2 = partMouldGeometry(prof, p, 20, {half: 'socket'});
    const {open: o2, flipped: f2} = edgeAudit(m2.geometry);
    if (o2 || f2) P(`вторая половина ${p.kind}: ${o2} открытых, ${f2} вывернутых рёбер`);
    if (m.keys !== m2.keys) P(`у половин ${p.kind} разное число замков`);
    if (!(m.keys >= 2)) P(`форма ${p.kind}: замков ${m.keys} — половины не сцентрировать`);
    m2.geometry.dispose();
  }

  /* Умолчание вида обязано пережить sanitizePart. «Вылет» у ручки и у слива —
     разные вещи, и общий предел 15…90 молча превращал отгиб кромки 9 мм в 15:
     умолчание, которого нельзя добиться руками, — это не умолчание. */
  for (const [kind, k] of Object.entries(PART_KINDS)) {
    const made = sanitizePart({kind, az: 0});
    for (const [f, v] of Object.entries(k.defaults))
      if (made[f] !== v) {
        const L = limitOf(kind, f);
        P(`${kind}: умолчание ${f}=${v} обрезано до ${made[f]} пределом ${L.min}…${L.max}`);
      }
  }

  /* Нарисованная кривая прилепа. Ручку правят на чертеже так же, как профиль,
     и кривая обязана быть равноправной с ползунками: та же геометрия, те же
     числа в панели, та же форма под неё. */
  {
    const base = sanitizePart({kind: 'handle', az: 0});
    const path = pathFromParams(prof, base);
    const drawn = sanitizePart({...base, path});
    if (!drawn.path) P('нарисованная кривая не пережила sanitizePart');
    const a = partCurve(prof, base), b = partCurve(prof, drawn);
    let worst = 0;
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      worst = Math.max(worst, a.getPointAt(u).distanceTo(b.getPointAt(u)));
    }
    if (worst > 3) P(`кривая, снятая с параметров, расходится с ними на ${worst.toFixed(1)} мм`);

    // числа в панели пересчитываются по кривой, а не остаются от ползунков
    const moved = sanitizePart({...drawn, path: path.map(q => ({...q, d: q.d * 1.5}))});
    syncFieldsFromPath(prof, moved);
    if (!(moved.out > base.out)) P('вылет не пересчитался по раздутой кривой');

    // штрих в кривую: ведём дугу от стенки наружу и обратно
    const H = prof[prof.length - 1].y;
    const mm = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30, ang = Math.PI * t - Math.PI / 2;
      mm.push({x: radiusAt(prof, 0.6 * H) + 40 * Math.cos(ang) + 2, y: 0.6 * H + 45 * Math.sin(ang)});
    }
    const fromStroke = pathFromStroke(prof, base, mm);
    if (!fromStroke) P('дуга от стенки наружу не сложилась в кривую прилепа');
    else {
      if (fromStroke[0].d > 0 || fromStroke[fromStroke.length - 1].d > 0)
        P('концы нарисованной ручки не сели на стенку');
      if (fromStroke.length < 3 || fromStroke.length > 24)
        P(`в нарисованной кривой ${fromStroke.length} точек`);
      // штрих, нарисованный в обратную сторону, даёт ту же деталь
      const back = pathFromStroke(prof, base, mm.slice().reverse());
      if (!back || Math.abs(back.length - fromStroke.length) > 1)
        P('ручка, нарисованная сверху вниз, вышла другой');
    }
    if (pathFromStroke(prof, base, mm.map(q => ({x: radiusAt(prof, q.y), y: q.y}))))
      P('линия по стенке принята за ручку');
    if (pathFromStroke(prof, sanitizePart({kind: 'spout', az: 0}), mm.slice(0, 3)))
      P('три точки приняты за носик');

    // форма под нарисованную ручку строится так же, как под параметрическую
    if (!partSelfOverlap(prof, drawn)) {
      const g = partMouldGeometry(prof, drawn, 20, {half: 'bump'}).geometry;
      const au = edgeAudit(g);
      if (au.open || au.flipped)
        P(`форма под нарисованную ручку: ${au.open} открытых, ${au.flipped} вывернутых рёбер`);
      g.dispose();
    }
  }

  /* Крайние прилепы. Здесь вылезли две вещи сразу: облойная канавка идёт
     смещением контура детали, а смещение внутрь крутого изгиба сворачивается
     петлёй; и сама деталь при толстой ленте на коротком пролёте входит в себя.
     Второе — не наша беда, а свойство детали, но форму под неё строить нельзя,
     и пользователь должен это увидеть замечанием, а не рваным STL. */
  let knots = 0, clean = 0;
  for (const out of [15, 25, 40, 60, 90])
    for (const thick of [4, 8, 12, 20, 30])
      for (const [top, bot] of [[0.8, 0.4], [1, 0.05], [0.4, 0.2]]) {
        const p = sanitizePart({kind: 'handle', az: 0, out, thick, wide: Math.round(thick * 1.6), top, bot});
        const tag = `ручка out=${out} thick=${thick} ${top}→${bot}`;
        if (partSelfOverlap(prof, p)) {
          knots++;
          const w = partsWarnings({...state, parts: [p]}, prof);
          if (!w.some(x => x.txt.includes('пересекает сама себя')))
            P(`${tag}: деталь в узле, а замечания нет`);
          continue;
        }
        clean++;
        const f = partMouldFeatures(prof, p, 20);
        if (!(f.flashL > 0)) P(`${tag}: облойная канавка выродилась`);
        if (f.keys !== 4) P(`${tag}: замков ${f.keys}, а место есть под четыре`);
      }
  if (!(knots > 0 && clean > 0)) P(`перебор ручек вырожден: узлов ${knots}, годных ${clean}`);

  /* Сетку строим не на всех — она дорогая, но на разных углах диапазона. */
  for (const v of [
    {kind: 'handle', out: 25, thick: 4,  wide: 6,  top: 0.8, bot: 0.4},
    {kind: 'handle', out: 40, thick: 4,  wide: 6,  top: 1,   bot: 0.05},
    {kind: 'handle', out: 90, thick: 12, wide: 19, top: 0.8, bot: 0.4},
    {kind: 'handle', out: 90, thick: 30, wide: 48, top: 1,   bot: 0.05},
    {kind: 'spout',  len: 20,  bore: 34, tip: 24, rise: 60,  at: 0.95},
    {kind: 'spout',  len: 140, bore: 6,  tip: 4,  rise: -10, at: 0.2},
    {kind: 'spout',  len: 20,  bore: 6,  tip: 4,  rise: -10, at: 0.2},
  ]) {
    const p = sanitizePart({az: 0, ...v});
    if (partSelfOverlap(prof, p)) { P(`образец ${JSON.stringify(v)} оказался узлом — выберите другой`); continue; }
    for (const half of ['bump', 'socket']) {
      const g = partMouldGeometry(prof, p, 20, {half}).geometry;
      const a = edgeAudit(g);
      if (a.open || a.flipped)
        P(`крайний ${JSON.stringify(v)}, половина ${half}: ${a.open} открытых, ${a.flipped} вывернутых рёбер`);
      g.dispose();
    }
  }
}
console.log('\nГеометрия оснастки в порядке.');
