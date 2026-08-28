// Проверка реестра глазурей и модели покрытия: node tools/check-glazes.mjs
import { GLAZES, GLAZES_SCHEMA, GLAZE_FAMILIES, CONE_C, byGlazeId, firingFit } from '../js/config/glazes.js';
import { coatProfile, coatWarnings } from '../js/core/glazeCoat.js';
import { checkContract } from './registry-contract.mjs';
import { MATERIALS } from '../js/config/materials.js';

const problems = [];
const warn = [];
const seen = new Set();
const REQUIRED = ['id', 'name', 'family', 'cone', 'tempC', 'color', 'look', 'note', 'risk',
                  'est', 'unknown', 'na', 'src'];
const LOOK = ['opacity', 'gloss', 'breakEdge', 'pool', 'flow', 'speck', 'crystal', 'crackle'];

for (const g of GLAZES) {
  const id = g.id || '(без id)';
  for (const f of REQUIRED) if (g[f] === undefined) problems.push(`${id}: нет поля ${f}`);
  if (!/^[a-z0-9-]+$/.test(g.id || '')) problems.push(`${id}: id должен быть kebab-case`);
  if (seen.has(g.id)) problems.push(`${id}: дублирующийся id`); else seen.add(g.id);
  if (!GLAZE_FAMILIES[g.family]) problems.push(`${id}: неизвестное семейство «${g.family}»`);

  // конус и температура должны говорить одно и то же
  if (!Array.isArray(g.cone) || g.cone.length !== 2) problems.push(`${id}: конус задаётся парой [от, до]`);
  else for (const c of g.cone) if (CONE_C[c] === undefined) problems.push(`${id}: нет конуса ${c} в таблице`);
  if (!Array.isArray(g.tempC) || g.tempC.length !== 2 || !(g.tempC[0] <= g.tempC[1]))
    problems.push(`${id}: температура задаётся парой [от, до]`);
  else if (Array.isArray(g.cone) && CONE_C[g.cone[0]] !== undefined) {
    if (Math.abs(CONE_C[g.cone[0]] - g.tempC[0]) > 25)
      problems.push(`${id}: конус ${g.cone[0]} это ${CONE_C[g.cone[0]]} °C, а записано ${g.tempC[0]}`);
    if (Math.abs(CONE_C[g.cone[1]] - g.tempC[1]) > 25)
      problems.push(`${id}: конус ${g.cone[1]} это ${CONE_C[g.cone[1]]} °C, а записано ${g.tempC[1]}`);
  }

  // UMF должен попадать в диапазон ползунков лаборатории, иначе точка уедет с диаграммы
  if (g.umf) {
    const {al, si, ca} = g.umf;
    if (!(al >= 0.1 && al <= 0.6)) problems.push(`${id}: Al₂O₃ ${al} вне 0.1…0.6`);
    if (!(si >= 1.5 && si <= 7)) problems.push(`${id}: SiO₂ ${si} вне 1.5…7`);
    if (!(ca >= 0 && ca <= 1)) problems.push(`${id}: CaO/MgO ${ca} вне 0…1`);
  }

  for (const f of LOOK) {
    const v = g.look ? g.look[f] : undefined;
    if (v === undefined) problems.push(`${id}: в look нет поля ${f}`);
    else if (!(v >= 0 && v <= 1)) problems.push(`${id}: look.${f} = ${v} вне 0…1`);
  }
  if (typeof g.color !== 'number') problems.push(`${id}: цвет должен быть числом 0xrrggbb`);
  if (g.breakColor !== undefined && typeof g.breakColor !== 'number')
    problems.push(`${id}: breakColor должен быть числом 0xrrggbb`);

  checkContract(g, ['umf', 'priceRub', 'packKg', 'vendor'], id, problems);

  if (!Array.isArray(g.src) || !g.src.length) problems.push(`${id}: нет источника`);
  else for (const s of g.src) {
    if (!s.t) problems.push(`${id}: источник без названия`);
    if (!/^https?:\/\//.test(s.u || '')) problems.push(`${id}: источник без ссылки: ${s.t}`);
  }
  if ((g.note || '').length < 60) warn.push(`${id}: слишком короткая заметка`);
  if ((g.risk || '').length < 30) warn.push(`${id}: риск описан слишком коротко`);
}

/* ---------- модель покрытия ---------- */
const cyl = [];                                   // ровный цилиндр 40 мм на 200
for (let y = 0; y <= 200; y += 4) cyl.push({r: 40, y});
const look = f => Object.assign({opacity: .5, gloss: .9, breakEdge: .6, pool: .8, flow: 0,
                                 speck: 0, crystal: 0, crackle: 0}, f);

const flat = coatProfile(cyl, look({breakEdge: 0, pool: 0}));
const mid = flat.coat.slice(3, -3);
if (Math.max(...mid) - Math.min(...mid) > 1e-6)
  problems.push('на ровной стенке без стока толщина обязана быть постоянной');
if (Math.abs(mid[0] - 1) > 1e-6) problems.push(`базовая толщина должна быть 1, вышло ${mid[0]}`);

// выпуклое ребро тоньше соседей, канавка толще
const bump = cyl.map((p, i) => ({r: p.r + (i === 25 ? 6 : 0), y: p.y}));
const groove = cyl.map((p, i) => ({r: p.r - (i === 25 ? 6 : 0), y: p.y}));
const cb = coatProfile(bump, look({})).coat, cg = coatProfile(groove, look({})).coat;
if (!(cb[25] < cb[15])) problems.push('на выпуклом ребре плёнка обязана быть тоньше');
if (!(cg[25] > cg[15])) problems.push('в канавке плёнка обязана быть толще');

// текучесть копится вниз
const slow = coatProfile(cyl, look({flow: 0.1, breakEdge: 0, pool: 0}));
const fast = coatProfile(cyl, look({flow: 0.9, breakEdge: 0, pool: 0}));
if (!(fast.runMax > slow.runMax)) problems.push('чем текучее глазурь, тем больше натёк у подошвы');
if (!(fast.coat[4] > fast.coat[fast.coat.length - 2]))
  problems.push('натёк должен собираться внизу, а не наверху');

// сухой поясок
if (!(flat.coat[0] < 0.35)) problems.push(`у самой подошвы должен остаться сухой поясок, вышло ${flat.coat[0].toFixed(2)}`);

// ничего не должно уходить в NaN и отрицательные значения
for (const g of GLAZES) {
  const {coat} = coatProfile(cyl, g.look);
  for (const v of coat) if (!Number.isFinite(v) || v < 0) { problems.push(`${g.id}: толщина ${v}`); break; }
}

// текучая глазурь обязана давать предупреждение, спокойная — нет
const runny = coatWarnings(byGlazeId('crystal-zinc'), coatProfile(cyl, byGlazeId('crystal-zinc').look));
if (!runny.some(w => w.lvl === 'bad')) problems.push('кристаллическая обязана предупреждать о стекании');
const calm = coatWarnings(byGlazeId('satin-matte'), coatProfile(cyl, byGlazeId('satin-matte').look));
if (calm.some(w => w.lvl === 'bad')) problems.push('матовая сатиновая не течёт и пугать не должна');

/* ---------- сходимость обжига с реестром масс ---------- */
const lowMat = MATERIALS.find(m => m.firing.glazeC[1] < 1100);
const highGlaze = GLAZES.find(g => g.tempC[0] > 1200);
if (lowMat && highGlaze) {
  const fit = firingFit(highGlaze, lowMat);
  if (!fit || fit.ok) problems.push('высокая глазурь на низкой массе обязана давать несовпадение обжига');
}

console.log(`Реестр глазурей: схема v${GLAZES_SCHEMA}, записей ${GLAZES.length}, семейств ${Object.keys(GLAZE_FAMILIES).length}`);
for (const g of GLAZES) {
  const s = coatProfile(cyl, g.look);
  console.log(`  ${g.id.padEnd(17)} ${String(g.tempC[0]).padStart(4)}–${g.tempC[1]} °C · ` +
              `кроет ${g.look.opacity.toFixed(2)} · блеск ${g.look.gloss.toFixed(2)} · ` +
              `натёк ${s.runMax.toFixed(2)}×`);
}
if (warn.length) { console.log('\nЗамечания:'); for (const w of warn) console.log('  · ' + w); }
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nВсе записи проходят проверку, модель покрытия ведёт себя как задумано.');
