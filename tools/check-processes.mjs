// Проверка реестра процессов: node tools/check-processes.mjs
import { PROCESSES, PROCESSES_SCHEMA, LIMITS } from '../js/config/processes.js';

const problems = [];
const warn = [];
const seen = new Set();
const REQUIRED = ['id', 'name', 'short', 'what', 'tooling', 'wares', 'good', 'bad', 'est', 'na', 'src'];

for (const p of PROCESSES) {
  const id = p.id || '(без id)';
  for (const f of REQUIRED) if (p[f] === undefined) problems.push(`${id}: нет поля ${f}`);
  if (!/^[a-z0-9-]+$/.test(p.id || '')) problems.push(`${id}: id должен быть kebab-case`);
  if (seen.has(p.id)) problems.push(`${id}: дублирующийся id`); else seen.add(p.id);

  if (p.pressureMPa !== null) {
    const r = p.pressureMPa;
    if (!Array.isArray(r) || r.length !== 2) problems.push(`${id}: pressureMPa должен быть [от, до] или null`);
    else {
      if (!(r[0] < r[1])) problems.push(`${id}: давление — нижняя граница не меньше верхней`);
      if (r[0] <= 0 || r[1] > 1000) problems.push(`${id}: давление ${r[0]}–${r[1]} МПа вне разумного 0…1000`);
    }
  } else if (!p.pressureNote) problems.push(`${id}: давление не задано и не объяснено в pressureNote`);

  if (p.mouldLife !== null) {
    const m = p.mouldLife;
    if (!Array.isArray(m) || m.length !== 2 || !(m[0] < m[1])) problems.push(`${id}: mouldLife должен быть [от, до] или null`);
    else if (!p.mouldLifeNote) warn.push(`${id}: ресурс формы без пояснения`);
  }

  // главное правило: пустое поле объяснено — либо данных нет (est), либо неприменимо (na)
  for (const f of ['pressureMPa', 'cycleSec', 'mouldLife'])
    if (p[f] === null && !(p.est || []).includes(f) && !(p.na || []).includes(f))
      problems.push(`${id}: ${f} пустое и не объяснено — добавьте в est (данных нет) или в na (неприменимо)`);
  for (const f of (p.na || []))
    if (p[f] !== null) problems.push(`${id}: ${f} помечено как неприменимое, но значение задано`);

  if (typeof p.allowsUndercut !== 'boolean') problems.push(`${id}: allowsUndercut должен быть true/false`);
  if (!Array.isArray(p.src) || !p.src.length) problems.push(`${id}: нет источника`);
  else for (const s of p.src) {
    if (!s.t) problems.push(`${id}: источник без названия`);
    if (!/^https?:\/\//.test(s.u || '')) problems.push(`${id}: источник без ссылки: ${s.t}`);
  }
  if ((p.what || '').length < 40) warn.push(`${id}: слишком короткое описание процесса`);
}

// пороги технологичности
if (!(LIMITS.minDraftDeg > 0 && LIMITS.minDraftDeg < 15)) problems.push(`порог уклона ${LIMITS.minDraftDeg}° вне 0…15`);
if (!(LIMITS.flatMaxHD > 0 && LIMITS.flatMaxHD < LIMITS.deepMinHD)) problems.push('пороги H/D перепутаны местами');
if (!(LIMITS.thinWallRatio > 0 && LIMITS.thinWallRatio <= 1)) problems.push('thinWallRatio вне 0…1');
if (!(LIMITS.flashPct >= 0 && LIMITS.flashPct <= 100)) problems.push('облой вне 0…100 %');
if (!PROCESSES.some(p => p.allowsUndercut)) problems.push('ни один процесс не допускает поднутрений — форму с горлом некуда отправить');

console.log(`Реестр процессов: схема v${PROCESSES_SCHEMA}, записей ${PROCESSES.length}`);
for (const p of PROCESSES)
  console.log(`  ${p.id.padEnd(10)} ${p.pressureMPa ? p.pressureMPa.join('–') + ' МПа' : 'давление не задано'} · ` +
              `${p.mouldLife ? 'ресурс ' + p.mouldLife.join('–') : 'ресурс неизвестен'} · ` +
              `поднутрения ${p.allowsUndercut ? 'допустимы' : 'нет'}`);
if (warn.length) { console.log('\nЗамечания:'); for (const w of warn) console.log('  · ' + w); }
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nВсе процессы проходят проверку.');
