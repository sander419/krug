// Проверка настроек расчёта:
//   node --import ./tools/node-three.mjs tools/check-tuning.mjs
//
// Настройка, которая ни на что не влияет, хуже её отсутствия: человек крутит
// ручку, число на экране не меняется, и он перестаёт верить всему остальному.
// Поэтому здесь у каждого порога есть проба: считаем величину с умолчанием,
// потом с изменённым значением и требуем, чтобы результат разошёлся.
import { TUNING, TUNING_BY_ID, TUNING_SCHEMA } from '../js/config/tuning.js';
import { tune, setTune, resetTune, isTuned, sanitizeTune, tunedCount } from '../js/core/tuning.js';
import { state } from '../js/core/state.js';
import { userProfileMM, computeProduction } from '../js/core/math.js';
import { analyzeFormability, checks } from '../js/core/tooling.js';
import { economics } from '../js/core/economics.js';
import { sanitizePart, partsWarnings } from '../js/core/parts.js';
import { partMouldFeatures, partMouldBlock } from '../js/three/partMould.js';
import { kilnLoad, firingCost } from '../js/core/kiln.js';
import { castMouldNumbers } from '../js/three/castMould.js';
import { byKilnId } from '../js/config/kilns.js';

const problems = [];
const P = t => problems.push(t);

/* ---------- реестр ---------- */
if (TUNING_SCHEMA !== 1) P('версия схемы настроек изменилась — проверьте читателей');
const ids = new Set();
for (const t of TUNING) {
  const L = `порог «${t.id}»`;
  if (ids.has(t.id)) P(`${L}: дубль id`);
  ids.add(t.id);
  for (const f of ['group', 'name', 'unit', 'what']) if (!t[f]) P(`${L}: нет поля ${f}`);
  if (!(t.what && t.what.length > 30)) P(`${L}: не сказано, что именно он меняет`);
  if (!(t.min < t.max)) P(`${L}: пределы перепутаны`);
  if (!(t.def >= t.min && t.def <= t.max)) P(`${L}: умолчание вне пределов`);
  if (!(t.step > 0)) P(`${L}: нет шага`);
}

/* ---------- поведение ---------- */
resetTune();
for (const t of TUNING) if (tune(t.id) !== t.def) P(`порог «${t.id}»: по умолчанию не умолчание`);
if (tunedCount() !== 0) P('после сброса не должно остаться переопределений');

const one = TUNING[0];
setTune(one.id, one.max * 2);
if (tune(one.id) !== one.max) P('значение выше предела не обрезалось');
setTune(one.id, one.def);
if (isTuned(one.id)) P('значение, равное умолчанию, не должно храниться как своё');
setTune(one.id, one.min);
if (!isTuned(one.id)) P('своё значение не запомнилось');
resetTune(one.id);
if (isTuned(one.id)) P('сброс одного порога не сработал');

const dirty = sanitizeTune({[one.id]: one.min, 'нет-такого': 5, [TUNING[1].id]: 'ерунда'});
if (dirty['нет-такого'] !== undefined) P('чужой id не отброшен при загрузке');
if (dirty[TUNING[1].id] !== undefined) P('нечисловое значение не отброшено');
if (dirty[one.id] !== one.min) P('своё значение не пережило загрузку');

/* ---------- каждая ручка обязана что-то менять ---------- */
state.parts = [sanitizePart({kind: 'handle', az: 0}), sanitizePart({kind: 'spout', az: 120})];
const prof = () => userProfileMM(state);
const kiln = byKilnId('studio-60');

/* Проба смотрит на содержание, а не на длину списка: замечание может не появиться
   и не исчезнуть, а поменять уровень или число внутри текста — это тоже влияние. */
const checkText = () => checks(state, analyzeFormability(state), 'ram')
  .map(c => `${c.lvl}:${c.txt}`).join('|');

const PROBES = {
  draftDeg: checkText,
  thinWallRatio: checkText,
  minWallRamMM: checkText,
  minFilletMM: () => {
    /* На плавном профиле радиус перехода вообще не считается (null), и порог
       не на что применить. Ставим ступеньку — тогда острый угол появляется. */
    const was = state.points;
    state.points = [{t: 0, r: 0.5}, {t: 0.45, r: 0.5}, {t: 0.5, r: 0.95}, {t: 1, r: 0.9}];
    const out = checkText();
    state.points = was;
    return out;
  },
  minUndercutMM: () => analyzeFormability(state).parts,
  flashPct: () => economics(state, computeProduction(state), 'ram', {batch: 100}).machineTotal,
  gripMM: () => partsWarnings(state, prof()).map(w => w.txt).join('|'),
  joinSpanMM: () => partsWarnings(state, prof()).map(w => w.txt).join('|'),
  azMinDeg: () => {
    // два прилепа рядом: только на них и виден порог разноса по азимуту
    const was = state.parts;
    state.parts = [sanitizePart({kind: 'handle', az: 0}), sanitizePart({kind: 'handle', az: 20})];
    const out = partsWarnings(state, prof()).map(w => w.txt).join('|');
    state.parts = was;
    return out;
  },
  keyR: () => partMouldFeatures(prof(), state.parts[0], 20).keysL,
  keyH: () => partMouldFeatures(prof(), state.parts[0], 20).keysL,
  keyClear: () => partMouldBlock(prof(), state.parts[0], 20).boxL,
  land: () => partMouldFeatures(prof(), state.parts[0], 20).flashL,
  flashW: () => partMouldFeatures(prof(), state.parts[0], 20).flashL,
  flashD: () => partMouldFeatures(prof(), state.parts[0], 20).flashL,
  castWall: () => castMouldNumbers(state).plasterL,
  castBase: () => castMouldNumbers(state).plasterL,
  funnelR: () => castMouldNumbers(state).funnelL,
  funnelH: () => castMouldNumbers(state).funnelL,
  gapItem: () => kilnLoad(kiln, {d: 120, h: 140}).perShelf,
  gapWall: () => kilnLoad(kiln, {d: 120, h: 140}).perShelf,
  gapTier: () => kilnLoad(kiln, {d: 120, h: 200}).tiers,
  duty: () => firingCost(kiln, {topC: 1050, glaze: false, priceKWh: 6}).kWh,
  bisqueC: () => firingCost(kiln, {topC: 1050, glaze: true, priceKWh: 6}).kWh,
};

for (const t of TUNING) {
  const probe = PROBES[t.id];
  if (!probe) { P(`порог «${t.id}»: нет пробы — некому доказать, что он на что-то влияет`); continue; }
  resetTune();
  const before = String(probe());
  // двигаем к дальнему краю: у порога должно быть видимое действие
  const far = Math.abs(t.max - t.def) > Math.abs(t.def - t.min) ? t.max : t.min;
  setTune(t.id, far);
  const after = String(probe());
  resetTune();
  if (before === after)
    P(`порог «${t.id}» (${t.name}) ничего не изменил: ${before} и при ${t.def}, и при ${far}`);
}

/* ---------- умолчания не сдвинулись ---------- */
/* Включённый инструмент обязан считать так же, как считал до появления настроек:
   если умолчание поехало, у всех пользователей молча изменились числа. */
const WAS = {draftDeg: 1.5, thinWallRatio: 0.6, minWallRamMM: 3, minFilletMM: 2,
  minUndercutMM: 1, flashPct: 15, gripMM: 25, joinSpanMM: 40, azMinDeg: 25,
  keyR: 7, keyH: 4, keyClear: 3, land: 2, flashW: 4, flashD: 1.5,
  gapItem: 15, gapWall: 25, gapTier: 12, duty: 0.5, bisqueC: 900};
for (const [id, was] of Object.entries(WAS)) {
  const t = TUNING_BY_ID.get(id);
  if (!t) { P(`порог «${id}» исчез из реестра`); continue; }
  if (t.def !== was) P(`умолчание «${id}» изменилось: было ${was}, стало ${t.def}`);
}

resetTune();
state.parts = [];

console.log('Проверка настроек расчёта\n');
console.log(`  порогов ${TUNING.length} в ${new Set(TUNING.map(t => t.group)).size} группах, у каждого есть проба`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nКаждая настройка меняет расчёт, умолчания на месте.');
