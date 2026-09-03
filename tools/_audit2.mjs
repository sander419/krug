import { state } from '../js/core/state.js';
import { PRESETS } from '../js/config/data.js';
import { userProfileMM, computeProduction, footRecessMM3, footContour } from '../js/core/math.js';
import { sanitizePattern, patternRelief, patternMetrics, patternOffset } from '../js/core/pattern.js';
import { reliefCoat } from '../js/core/glazeCoat.js';
import { byGlazeId } from '../js/config/glazes.js';
import { firedSize } from '../js/core/kiln.js';
import { sanitizeLid, lidProfile, lidMetrics, lidReliefWeights, lidWarpFn } from '../js/core/lid.js';
import { byId, density } from '../js/config/materials.js';

const B = () => Object.assign(state, {
  points: PRESETS[1].pts.map(p => ({...p})), H: 220, D: 160, segments: 96, rings: 0,
  hollow: true, wall: 6, footH: 6, footK: 62, allow: 20, mat: 'gzhel-red', firing: 'raw',
  stage: 6, parts: [], lid: {on: false}, pattern: {layers: []}, glazeId: 'clear-gloss',
  pr: {printer: 1, nozzle: 4, lh: 2.4, feed: 1800, cart: 20, flow: 100, tau: 8},
  kiln: {id: 'studio-60', kwh: 6}, cast: {}, cost: {}, tune: {}, plaster: {id: 'gvvs-16', wr: 70},
});

console.log('--- 1. reliefCoat: чешуя против каннелюр при равной глубине');
{
  const look = byGlazeId('tenmoku').look;
  B();
  for (const [name, layers] of [['каннелюры (синус)', [{id:'flute', n:16, depth:2}]],
                                ['чешуя (бугорки)', [{id:'bump', n:16, depth:2, m:8}]],
                                ['грани (треугольник)', [{id:'facet', n:16, depth:2}]],
                                ['звезда (острая)', [{id:'star', n:16, depth:2}]]]) {
    const pat = sanitizePattern({layers});
    const M = patternMetrics(pat, {D: 160, H: 220});
    const rc = reliefCoat(look, {stepMM: M.stepMM, periodMM: M.periodMM, depth: Math.max(M.carve, M.raise)});
    console.log(`  ${name.padEnd(22)} шаг ${String(M.stepMM && M.stepMM.toFixed(1)).padStart(5)} ρ ${rc.radiusMM.toFixed(2)} гребень ${rc.crest.toFixed(2)} ложбина ${rc.valley.toFixed(2)}`);
  }
}

console.log('\n--- 2. reliefCoat на стопке: две мелкие борозды поверх крупной');
{
  const look = byGlazeId('tenmoku').look;
  const one = sanitizePattern({layers: [{id:'flute', n:8, depth:3}]});
  const two = sanitizePattern({layers: [{id:'flute', n:8, depth:3}, {id:'flute', n:40, depth:0.5, phase:10}]});
  for (const [n, p] of [['один слой', one], ['+ мелкая рябь', two]]) {
    const M = patternMetrics(p, {D: 160, H: 220});
    const rc = reliefCoat(look, {stepMM: M.stepMM, periodMM: M.periodMM, depth: Math.max(M.carve, M.raise)});
    console.log(`  ${n.padEnd(16)} шаг ${M.stepMM.toFixed(1)} глубина ${Math.max(M.carve,M.raise).toFixed(2)} ρ ${rc.radiusMM.toFixed(2)} гребень ${rc.crest.toFixed(2)}`);
  }
}

console.log('\n--- 3. габарит после обжига: где именно гребень');
{
  B();
  const prof = userProfileMM(state);
  const smooth = firedSize(prof, [], 0);
  for (const [n, layers] of [['каннелюры 3 мм', [{id:'flute', n:12, depth:3}]],
                             ['чешуя 3 мм', [{id:'bump', n:12, depth:3, m:6}]],
                             ['лунки 3 мм', [{id:'dimple', n:12, depth:3, m:6}]],
                             ['окна 3 мм', [{id:'window', n:10, depth:3, m:5}]]]) {
    const f = firedSize(prof, [], 0, null, {pattern: {layers}});
    const {carve, raise} = patternRelief(sanitizePattern({layers}), 220);
    console.log(`  ${n.padEnd(16)} ⌀${f.d.toFixed(1)} (+${(f.d-smooth.d).toFixed(1)}) · наружу ${raise.toFixed(2)} внутрь ${carve.toFixed(2)}`);
  }
}

console.log('\n--- 4. ножка: контур против интеграла и против сетки');
{
  B();
  for (const [fh, fk] of [[6,62],[12,40],[3,85],[0,62]]) {
    state.footH = fh; state.footK = fk;
    const prof = userProfileMM(state);
    const v = footRecessMM3(prof[0].r, fh, fk) / 1000;
    const pts = footContour(prof[0].r, fh, fk);
    console.log(`  ножка ${String(fh).padStart(2)} мм / ${fk}%: выемка ${v.toFixed(1)} см³, точек ${pts.length}`);
  }
}

console.log('\n--- 5. крышка: рельеф и посадка');
{
  B();
  state.lid = {on: true, h: 40, knobH: 16};
  state.pattern = {layers: [{id: 'bump', n: 14, depth: 2.5, m: 6}]};
  const prof = userProfileMM(state);
  const lid = sanitizeLid(state.lid);
  const L = lidProfile(prof, lid, state.wall);
  const w = lidReliefWeights(L);
  const warp = lidWarpFn(L, sanitizePattern(state.pattern));
  let maxOut = 0, seatMax = 0;
  for (let j = 0; j < L.pts.length; j++) {
    for (let k = 0; k < 24; k++) {
      const d = warp(k / 24 * Math.PI * 2, L.pts[j], j);
      if (L.pts[j].y <= L.rim.y) seatMax = Math.max(seatMax, Math.abs(d));
      maxOut = Math.max(maxOut, d);
    }
  }
  const m = lidMetrics(prof, lid, state.wall, density(byId(state.mat)), byId(state.mat).shrinkPct, state.pattern);
  console.log(`  рельеф на куполе до ${maxOut.toFixed(2)} мм, на посадке ${seatMax.toFixed(2)} мм`);
  console.log(`  кромка вазы r=${L.rim.r.toFixed(1)}, наружный радиус крышки ${L.outR.toFixed(1)} → с рельефом ${(L.outR+maxOut).toFixed(1)}`);
  console.log(`  глина крышки ${m.volMl.toFixed(1)} см³ (гладкая ${m.smoothMl.toFixed(1)}, рельеф ${m.patMl>=0?'+':''}${m.patMl.toFixed(2)})`);
}
