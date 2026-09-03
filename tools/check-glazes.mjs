// Проверка реестра глазурей и модели покрытия:
//   node --import ./tools/node-three.mjs tools/check-glazes.mjs
// (резолвер three нужен из-за умолчаний состояния: они тянут ядро целиком)
import { state as DEFAULTS } from '../js/core/state.js';   // модуль отдаёт умолчания до правок
import { GLAZES, GLAZES_SCHEMA, GLAZE_FAMILIES, CONE_C, byGlazeId, firingFit } from '../js/config/glazes.js';
import { coatProfile, coatWarnings, reliefCoat } from '../js/core/glazeCoat.js';
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

  /* `form` — порошок или суспензия. У семейств без конкретного товара его
     не публикуют, и это должно быть помечено, а не подразумеваться: интерфейс
     пишет «не указан», а реестр обязан говорить почему. */
  checkContract(g, ['umf', 'priceRub', 'packKg', 'vendor', 'form'], id, problems);

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

/* ---------- глазурь на рельефе узора ---------- */
/* Борозда узора — то же ребро и та же канавка, что на профиле: на гребне
   плёнка утоньшается до пробоя, в ложбине набирается. Считает это reliefCoat
   теми же константами, что и модель сечения, — иначе на экране была бы одна
   физика, а в замечаниях другая.

   Что здесь чем является: радиус гребня — геометрия (ρ = L²/4π²A), множители
   плёнки — оценка по параметрам семейства, толщина в миллиметрах — unknown. */
{
  const look = byGlazeId('tenmoku').look;
  /* Геометрия: вдвое мельче шаг — вчетверо острее гребень. */
  const wide = reliefCoat(look, {stepMM: 40, depth: 2});
  const fine = reliefCoat(look, {stepMM: 20, depth: 2});
  if (!wide || !fine) problems.push('рельеф есть, а плёнка на нём не посчиталась');
  else {
    if (Math.abs(wide.radiusMM / fine.radiusMM - 4) > 0.01)
      problems.push(`вдвое мельче шаг дал ${(wide.radiusMM / fine.radiusMM).toFixed(2)}× по радиусу вместо четырёх`);
    if (!(fine.crest < wide.crest)) problems.push('на более остром гребне плёнка не стала тоньше');
    if (!(fine.valley > wide.valley)) problems.push('в более глубокой ложбине плёнка не набралась');
    if (!(fine.crest < 1 && fine.valley > 1)) problems.push('гребень и ложбина ушли не в те стороны');
  }
  /* Глубже борозда — острее гребень при том же шаге. */
  const deep = reliefCoat(look, {stepMM: 30, depth: 4}), shallow = reliefCoat(look, {stepMM: 30, depth: 1});
  if (!(deep.radiusMM < shallow.radiusMM)) problems.push('глубина не влияет на радиус гребня');
  /* Нет рельефа — нет и ответа: «единица» вместо null означала бы, что плёнка
     посчитана, хотя считать было нечего. */
  if (reliefCoat(look, {stepMM: 30, depth: 0}) !== null) problems.push('без рельефа плёнка на нём всё равно посчиталась');
  if (reliefCoat(look, {depth: 2}) !== null) problems.push('без шага и периода радиус гребня взялся из ниоткуда');
  /* Спокойная глазурь на том же рельефе даёт меньше и пробоя, и набора:
     множители обязаны зависеть от семейства, а не быть общей константой. */
  const calm = reliefCoat(byGlazeId('clear-gloss').look, {stepMM: 20, depth: 2});
  if (!(calm.crest > fine.crest)) problems.push('у спокойной глазури пробой на гребне не меньше, чем у тенмоку');
  /* Пределы: множители не уходят в отрицательные и не превышают потолок модели. */
  for (const g of GLAZES) {
    const r = reliefCoat(g.look, {stepMM: 8, depth: 6});
    if (!(r.crest >= 0 && r.crest <= 2.6 && r.valley >= 0 && r.valley <= 2.6))
      problems.push(`«${g.name}»: множители плёнки вышли за пределы (${r.crest.toFixed(2)}, ${r.valley.toFixed(2)})`);
    if (!Number.isFinite(r.radiusMM)) problems.push(`«${g.name}»: радиус гребня не число`);
  }
}


console.log(`Реестр глазурей: схема v${GLAZES_SCHEMA}, записей ${GLAZES.length}, семейств ${Object.keys(GLAZE_FAMILIES).length}`);
for (const g of GLAZES) {
  const s = coatProfile(cyl, g.look);
  console.log(`  ${g.id.padEnd(17)} ${String(g.tempC[0]).padStart(4)}–${g.tempC[1]} °C · ` +
              `кроет ${g.look.opacity.toFixed(2)} · блеск ${g.look.gloss.toFixed(2)} · ` +
              `натёк ${s.runMax.toFixed(2)}×`);
}
if (warn.length) { console.log('\nЗамечания:'); for (const w of warn) console.log('  · ' + w); }
/* Формула по умолчанию обязана быть паспортной у глазури по умолчанию:
   разошедшиеся умолчания означают, что инструмент с первой секунды считает
   не ту глазурь, которая горит в списке. */
{
  const g = GLAZES.find(x => x.id === DEFAULTS.glazeId);
  if (!g) problems.push(`глазурь по умолчанию «${DEFAULTS.glazeId}» не найдена в реестре`);
  else if (g.umf) {
    const d = DEFAULTS.glaze;
    for (const k of ['al', 'si', 'ca'])
      if (Math.abs(d[k] - g.umf[k]) > 1e-9)
        problems.push(`умолчание формулы ${k}=${d[k]} не совпадает с паспортом «${g.name}» (${g.umf[k]})`);
  }
}

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nВсе записи проходят проверку, модель покрытия ведёт себя как задумано.');
