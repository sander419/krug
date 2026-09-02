// Все проверки одной командой:
//   node --import ./tools/node-three.mjs tools/check-all.mjs
// Резолвер three нужен только для проверки геометрии, но проще подключать его всегда.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const CHECKS = [
  ['Проверки',     'check-checks.mjs'],
  ['Массы',        'check-materials.mjs'],
  ['Процессы',     'check-processes.mjs'],
  ['Гипсы',        'check-plasters.mjs'],
  ['Глазури',      'check-glazes.mjs'],
  ['Энциклопедия', 'check-kb.mjs'],
  ['Геометрия',    'check-geometry.mjs'],
  ['Слайсер',      'check-gcode.mjs'],
  ['Задачи',       'check-routes.mjs'],
  ['Линия',        'check-trace.mjs'],
  ['Картинка',     'check-silhouette.mjs'],
  ['Автономность', 'check-offline.mjs'],
  ['Печи',         'check-kilns.mjs'],
  ['Литьё',        'check-casting.mjs'],
  ['Форма литья',  'check-castmould.mjs'],
  ['Схема',        'check-sheet.mjs'],
  ['Настройки',    'check-tuning.mjs'],
  ['Крышка',       'check-lid.mjs'],
  ['Деньги',       'check-cost.mjs'],
  ['Путь',         'check-next.mjs'],
  ['Читаемость',   'check-contrast.mjs'],
  ['Интерфейс',    'check-ui.mjs'],
  ['Пакет',        'check-zip.mjs'],
  ['Брендбук',     'check-brand.mjs'],
  ['Факт',         'check-fact.mjs'],
  ['Подсказки',    'check-hints.mjs'],
  ['Узор',         'check-pattern.mjs'],
  ['Заготовки',    'check-presets.mjs'],
  ['Источники',    'check-sources.mjs'],
];

let failed = 0;
const lines = [];

for (const [name, file] of CHECKS) {
  const r = spawnSync(process.execPath,
    ['--import', './tools/node-three.mjs', `tools/${file}`],
    {cwd: root, encoding: 'utf-8'});
  const ok = r.status === 0;
  if (!ok) failed++;
  lines.push(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`\n──── ${name} ────`);
    console.log((r.stdout || '') + (r.stderr || ''));
  }
}

console.log('\n' + lines.join('   '));
if (failed) {
  console.log(`\nНе прошло проверок: ${failed}. Подробности выше.`);
  process.exit(1);
}
console.log('\nВсё чисто: реестры, энциклопедия, геометрия и экономика сходятся.');
