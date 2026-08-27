// Проверка реестра гипсов: node tools/check-plasters.mjs
import { PLASTERS, PLASTERS_SCHEMA, plasterMix, PLASTER_SOLID_DENSITY } from '../js/config/plasters.js';
import { checkContract } from './registry-contract.mjs';

const problems = [];
const warn = [];
const seen = new Set();
const REQUIRED = ['id', 'name', 'vendor', 'grade', 'strengthMPa', 'setMin', 'use', 'note', 'est', 'unknown', 'na', 'src'];

for (const p of PLASTERS) {
  const id = p.id || '(без id)';
  for (const f of REQUIRED) if (p[f] === undefined) problems.push(`${id}: нет поля ${f}`);
  if (!/^[a-z0-9-]+$/.test(p.id || '')) problems.push(`${id}: id должен быть kebab-case`);
  if (seen.has(p.id)) problems.push(`${id}: дублирующийся id`); else seen.add(p.id);

  if (!(p.strengthMPa > 1 && p.strengthMPa < 60)) problems.push(`${id}: прочность ${p.strengthMPa} МПа вне 1…60`);
  if (!Array.isArray(p.setMin) || p.setMin.length !== 2 || !(p.setMin[0] < p.setMin[1]))
    problems.push(`${id}: сроки схватывания должны быть [начало, конец]`);
  else if (p.setMin[0] < 1 || p.setMin[1] > 120) problems.push(`${id}: сроки схватывания вне 1…120 мин`);

  if (p.waterRatio != null && !(p.waterRatio >= 40 && p.waterRatio <= 120))
    problems.push(`${id}: водогипсовое отношение ${p.waterRatio} вне 40…120 частей воды на 100 гипса`);
  checkContract(p, ['waterRatio', 'priceRub', 'packKg'], id, problems);
  if (p.waterRatio != null && !p.waterRatioNote) warn.push(`${id}: В/Г без пояснения, откуда взято`);

  if (p.priceRub != null && p.packKg == null) problems.push(`${id}: есть цена, но нет фасовки`);
  if (p.packKg != null && !(p.packKg > 0 && p.packKg < 2000)) problems.push(`${id}: фасовка ${p.packKg} кг вне разумного`);

  if (!Array.isArray(p.src) || !p.src.length) problems.push(`${id}: нет источника`);
  else for (const s of p.src) {
    if (!s.t) problems.push(`${id}: источник без названия`);
    if (!/^https?:\/\//.test(s.u || '')) problems.push(`${id}: источник без ссылки: ${s.t}`);
  }
  if ((p.note || '').length < 40) warn.push(`${id}: слишком короткая заметка`);
}

// расчёт замеса: объём смеси складывается из порошка и воды
const mix = plasterMix(1, 70);
const expected = 1000 / (1 / PLASTER_SOLID_DENSITY + 0.7) / 1000;
if (Math.abs(mix.plasterKg - expected) > 1e-9) problems.push('формула замеса разошлась с собственным определением');
if (Math.abs(mix.plasterKg - 0.927) > 0.01) problems.push(`на литр при В/Г 70 должно выходить ≈0,927 кг гипса, вышло ${mix.plasterKg.toFixed(3)}`);
if (Math.abs(mix.waterL - mix.plasterKg * 0.7) > 1e-9) problems.push('вода не сходится с водогипсовым отношением');
if (!(mix.slurryDensity > 1.5 && mix.slurryDensity < 2.2)) problems.push(`плотность замеса ${mix.slurryDensity.toFixed(2)} г/см³ вне разумного`);
const dry = plasterMix(1, 50), wet = plasterMix(1, 90);
if (!(dry.plasterKg > mix.plasterKg && mix.plasterKg > wet.plasterKg))
  problems.push('гуще замес — больше гипса на литр: зависимость нарушена');
if (plasterMix(0, 70) !== null || plasterMix(1, 0) !== null) problems.push('нулевые входные данные должны давать null');

console.log(`Реестр гипсов: схема v${PLASTERS_SCHEMA}, записей ${PLASTERS.length}`);
for (const p of PLASTERS)
  console.log(`  ${p.id.padEnd(16)} ${p.strengthMPa} МПа · схватывание ${p.setMin.join('–')} мин · ` +
              `В/Г ${p.waterRatio ?? 'не публикуется'}`);
console.log(`\nЗамес на 1 л при В/Г 70: ${mix.plasterKg.toFixed(2)} кг гипса + ${mix.waterL.toFixed(2)} л воды`);
if (warn.length) { console.log('\nЗамечания:'); for (const w of warn) console.log('  · ' + w); }
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nВсе записи проходят проверку.');
