// Проверка реестра масс: node tools/check-materials.mjs
// Падает с кодом 1, если запись не годится в производство.
import { MATERIALS, MATERIAL_TYPES, MATERIALS_SCHEMA, density, densityFromMoisture,
         SOLIDS_DENSITY, DEFAULT_MOISTURE } from '../js/config/materials.js';
import { checkContract } from './registry-contract.mjs';

const problems = [];
const warn = [];
const P = (id, t) => problems.push(`${id}: ${t}`);
const W = (id, t) => warn.push(`${id}: ${t}`);

const REQUIRED = ['id', 'name', 'vendor', 'type', 'grog', 'firing', 'shrinkPct', 'absorption',
                  'colors', 'cte', 'uses', 'note', 'est', 'src'];
const HEX = v => Number.isInteger(v) && v >= 0 && v <= 0xffffff;
const seen = new Set();

for (const m of MATERIALS) {
  const id = m.id || '(без id)';
  for (const f of REQUIRED) if (m[f] === undefined) P(id, `нет обязательного поля ${f}`);
  if (!/^[a-z0-9-]+$/.test(m.id || '')) P(id, 'id должен быть из латиницы, цифр и дефисов');
  if (seen.has(m.id)) P(id, 'дублирующийся id'); else seen.add(m.id);
  if (!MATERIAL_TYPES[m.type]) P(id, `неизвестный тип "${m.type}"`);

  const f = m.firing || {};
  for (const k of ['bisqueC', 'glazeC']) {
    const r = f[k];
    if (!Array.isArray(r) || r.length !== 2) { P(id, `firing.${k} должен быть [от, до]`); continue; }
    if (!(r[0] < r[1])) P(id, `firing.${k}: нижняя граница не меньше верхней`);
    if (r[0] < 600 || r[1] > 1400) P(id, `firing.${k}: температура вне 600…1400 °С`);
  }
  if (f.bisqueC && f.glazeC && f.bisqueC[0] > f.glazeC[1]) P(id, 'утильный обжиг горячее политого');

  if (!(m.shrinkPct > 0 && m.shrinkPct < 25)) P(id, `усадка ${m.shrinkPct} % вне разумного 0…25`);
  if (m.airShrinkPct != null && !(m.airShrinkPct > 0 && m.airShrinkPct < m.shrinkPct))
    P(id, `воздушная усадка ${m.airShrinkPct} % должна быть больше нуля и меньше полной ${m.shrinkPct} %`);
  if (!m.shrinkNote) W(id, 'нет shrinkNote — непонятно, при какой температуре усадка');

  if (!Array.isArray(m.absorption) || !m.absorption.length) P(id, 'нет данных о водопоглощении');
  else {
    const a = [...m.absorption].sort((x, y) => x.tempC - y.tempC);
    for (const p of a) {
      if (!(p.tempC >= 600 && p.tempC <= 1400)) P(id, `водопоглощение: температура ${p.tempC} вне 600…1400`);
      if (!(p.pct >= 0 && p.pct <= 30)) P(id, `водопоглощение ${p.pct} % вне 0…30`);
    }
    for (let i = 1; i < a.length; i++)
      if (a[i].pct > a[i - 1].pct) P(id, `водопоглощение растёт с температурой (${a[i - 1].tempC}→${a[i].tempC} °С) — проверьте паспорт`);
  }

  const g = m.grog || {};
  if (!(g.percent >= 0 && g.percent <= 60)) P(id, `шамот ${g.percent} % вне 0…60`);
  if (g.percent > 0 && !(g.grainMM > 0)) P(id, 'указан шамот, но не указано зерно');
  if (g.percent === 0 && g.grainMM > 0) W(id, 'зерно шамота при нулевой доле');

  for (const k of ['raw', 'bisque', 'glaze'])
    if (!HEX(m.colors?.[k])) P(id, `colors.${k} должен быть числом 0x000000…0xffffff`);

  if (!(m.cte > 2 && m.cte < 12)) P(id, `CTE ${m.cte} вне 2…12 ·10⁻⁶/°C`);
  if (m.moisturePct != null && !(m.moisturePct > 5 && m.moisturePct < 40)) P(id, `влажность ${m.moisturePct} % вне 5…40`);

  if (m.packKg != null && !(m.packKg > 0 && m.packKg < 100)) P(id, `фасовка ${m.packKg} кг вне 0…100`);
  if (m.priceRub != null && m.packKg == null) P(id, 'есть цена, но нет фасовки — цену за килограмм не посчитать');
  const d = density(m);
  if (!(d > 1.5 && d < 2.4)) P(id, `расчётная плотность ${d.toFixed(2)} г/см³ вне 1.5…2.4`);
  if (m.moisturePct == null && !m.est.includes('density')) P(id, 'плотность оценочная, но не отмечена в est');
  checkContract(m, ['moisturePct', 'priceRub', 'packKg', 'airShrinkPct', 'density', 'cte', 'colors'],
                id, problems);

  if (!Array.isArray(m.src) || !m.src.length) P(id, 'нет источника (src)');
  else for (const s of m.src) {
    if (!s.t) P(id, 'источник без названия');
    if (!/^https?:\/\//.test(s.u || '')) P(id, `источник без ссылки: ${s.t}`);
  }
  if (!Array.isArray(m.uses) || !m.uses.length) P(id, 'не указано назначение (uses)');
  if ((m.note || '').length < 30) W(id, 'слишком короткая заметка — пользователю нечего прочесть');
}

// контроль самой формулы плотности
if (!(SOLIDS_DENSITY > 2.4 && SOLIDS_DENSITY < 2.9)) problems.push(`плотность глинистого вещества ${SOLIDS_DENSITY} вне 2.4…2.9 г/см³`);
if (!(DEFAULT_MOISTURE > 0.1 && DEFAULT_MOISTURE < 0.35)) problems.push(`влажность по умолчанию ${DEFAULT_MOISTURE} вне 0.1…0.35`);
const d22 = densityFromMoisture(0.22);
if (Math.abs(d22 - 1.923) > 0.01) problems.push(`формула плотности сломана: при 22 % влажности ${d22.toFixed(3)} вместо ≈1.923`);

console.log(`Реестр масс: схема v${MATERIALS_SCHEMA}, записей ${MATERIALS.length}`);
for (const m of MATERIALS)
  console.log(`  ${m.id.padEnd(24)} ${String(m.firing.glazeC[0]) + '–' + m.firing.glazeC[1] + ' °С'} · усадка ${m.shrinkPct} % · ρ ${density(m).toFixed(2)} г/см³`);
if (warn.length) { console.log('\nЗамечания:'); for (const w of warn) console.log('  · ' + w); }
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nВсе записи проходят проверку.');
