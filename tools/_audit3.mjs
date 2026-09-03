/* Второй заход аудита: физический смысл там, где арифметика уже сходится. */
import { state } from '../js/core/state.js';
import { PRESETS } from '../js/config/data.js';
import { userProfileMM, computeProduction, computeStrength } from '../js/core/math.js';
import { sanitizePattern, patternRelief, patternVolumeMl, patternAreaMM2 } from '../js/core/pattern.js';
import { sanitizeLid, lidProfile, lidMetrics } from '../js/core/lid.js';
import { firedSize, kilnLoad } from '../js/core/kiln.js';
import { byKilnId } from '../js/config/kilns.js';
import { byId, density } from '../js/config/materials.js';
import { sliceGCode } from '../js/core/slicer.js';

const B = () => Object.assign(state, {
  points: PRESETS[1].pts.map(p => ({...p})), H: 220, D: 160, segments: 96, rings: 0,
  hollow: true, wall: 6, footH: 6, footK: 62, allow: 20, mat: 'gzhel-red', firing: 'raw',
  stage: 6, parts: [], lid: {on: false}, pattern: {layers: []}, glazeId: 'clear-gloss',
  pr: {printer: 1, nozzle: 4, lh: 2.4, feed: 1800, cart: 20, flow: 100, tau: 8},
  kiln: {id: 'studio-60', kwh: 6}, cast: {}, cost: {}, tune: {}, plaster: {id: 'gvvs-16', wr: 70},
});

console.log('--- A. прочность: рельеф добавляет сечение или отнимает?');
{
  B();
  const base = computeStrength(state).minSF;
  for (const [n, layers] of [['каннелюры 3', [{id:'flute',n:12,depth:3}]],
                             ['чешуя 3', [{id:'bump',n:12,depth:3,m:6}]],
                             ['лунки 3', [{id:'dimple',n:12,depth:3,m:6}]],
                             ['окна 4', [{id:'window',n:10,depth:4,m:5}]]]) {
    state.pattern = {layers};
    const sf = computeStrength(state).minSF;
    const prof = userProfileMM(state);
    const H = prof[prof.length-1].y;
    const a = patternAreaMM2(sanitizePattern({layers}), 60, H*0.5, H);
    console.log(`  ${n.padEnd(14)} запас ${sf.toFixed(2)} (гладкая ${base.toFixed(2)}) · сечение ${a>=0?'+':''}${a.toFixed(0)} мм²`);
  }
}

console.log('\n--- B. вместимость и рельеф: полость гладкая?');
{
  B();
  const smooth = computeProduction(state);
  state.pattern = {layers:[{id:'flute',n:12,depth:4}]};
  const carved = computeProduction(state);
  console.log(`  вместимость ${smooth.capMl.toFixed(0)} → ${carved.capMl.toFixed(0)} мл (обязана не меняться)`);
  console.log(`  глина ${smooth.volMl.toFixed(1)} → ${carved.volMl.toFixed(1)} см³`);
}

console.log('\n--- C. садка: рельеф против зазора между изделиями');
{
  B();
  state.pattern = {layers:[{id:'bump',n:12,depth:4,m:6}]};
  const prof = userProfileMM(state);
  const f1 = firedSize(prof, [], 9, null, {});
  const f2 = firedSize(prof, [], 9, null, {pattern: state.pattern});
  const k = byKilnId('studio-60');
  console.log(`  ⌀ гладкой ${f1.d.toFixed(1)} → с рельефом ${f2.d.toFixed(1)}`);
  console.log(`  на полке: ${kilnLoad(k, f1).perShelf} → ${kilnLoad(k, f2).perShelf} шт`);
}

console.log('\n--- D. G-code: что печатается при рельефе глубже стенки');
{
  B();
  state.wall = 4;
  state.pattern = {layers:[{id:'flute',n:12,depth:6}]};
  const g = sliceGCode(state);
  console.log(`  стенка 4 мм, рельеф 6 мм: слоёв ${g.stats.layers}, пасты ${g.stats.grams.toFixed(0)} г`);
  console.log('  замечания:', g.warnings.map(w=>w.cls+': '+w.txt.slice(0,60)).join(' | ') || 'нет');
  const prod = computeProduction(state);
  console.log(`  масса по расчёту ${prod.massN.toFixed(0)} г — вещь с прорванной стенкой считается как целая?`);
}

console.log('\n--- E. крышка: рельеф на посадке «внахлёст»');
{
  B();
  state.lid = {on: true, type: 'over', over: 8};
  state.pattern = {layers:[{id:'bump',n:14,depth:3,m:6}]};
  const prof = userProfileMM(state);
  const L = lidProfile(prof, sanitizeLid(state.lid), state.wall);
  const m = lidMetrics(prof, sanitizeLid(state.lid), state.wall, density(byId(state.mat)), byId(state.mat).shrinkPct, state.pattern);
  console.log(`  посадка ⌀${(m.seatR*2).toFixed(1)} сырая, зазор ${m.gapRaw} → ${m.gapFired.toFixed(2)} после обжига`);
  console.log(`  юбка снаружи: outR ${L.outR.toFixed(1)}, кромка ${L.rim.r.toFixed(1)}`);
}
