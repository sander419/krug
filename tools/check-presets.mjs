// Проверка своих заготовок: node tools/check-presets.mjs
//
// Заготовка живёт дольше изделия, из которого её сняли: её ставят на новую
// вещь через месяц. Значит два обещания — она не должна меняться вместе
// с исходником и не должна принести с собой мусор из чужого браузера.
//
// Отдельно проверяется главное свойство корпуса: заготовку можно поставить
// «как есть» или взять только силуэт, оставив свои высоту и диаметр.
import { blankPreset, sanitizePreset, bodySnapshot, applyBody, lidSnapshot,
         partSnapshot, presetKindName, PRESET_KINDS, NAME_LIMIT } from '../js/core/presets.js';

const problems = [];
const P = t => problems.push(t);

/* ---------- схема ---------- */
{
  const p = sanitizePreset({kind: 'вазочка', name: '  ' + 'я'.repeat(80),
                            data: 'не объект', чужое: 1, ts: 'вчера'});
  if (p.kind !== 'body') P('неизвестный вид не сводится к корпусу');
  if (p.name.length !== NAME_LIMIT) P(`имя не обрезано до ${NAME_LIMIT}: ${p.name.length}`);
  if (typeof p.data !== 'object') P('данные не приведены к объекту');
  if ('чужое' in p) P('санитайзер пропускает чужие поля');
  if (!Number.isFinite(p.ts)) P('время не число — список не отсортируется');
  const empty = sanitizePreset(null);
  if (JSON.stringify(Object.keys(empty)) !== JSON.stringify(Object.keys(blankPreset())))
    P('пустая заготовка и санитайзер расходятся по полям');
  for (const k of PRESET_KINDS)
    if (!presetKindName(k)) P(`у вида «${k}» нет русского имени`);
}

/* ---------- слепок корпуса ---------- */
{
  const state = {
    points: [{t: 0, r: 0.5}, {t: 1, r: 0.4}], H: 200, D: 150, wall: 5, hollow: true,
    footH: 6, footK: 62, rings: 0.4, segments: 72,
    pattern: {layers: [{id: 'flute', depth: 2}]},
  };
  const snap = bodySnapshot(state);
  /* Слепок обязан быть копией: иначе заготовка начнёт меняться вместе
     с изделием, из которого её сняли, и «сохранил» перестанет значить
     «запомнил». */
  state.points[0].r = 0.9;
  /* Стопка слоёв — массив объектов: поверхностная копия оставила бы заготовку
     связанной с изделием, и правка глубины уехала бы в обе стороны. */
  state.pattern.layers[0].depth = 9;
  if (snap.points[0].r !== 0.5) P('точки в заготовке — ссылка на живой рецепт');
  if (snap.pattern.layers[0].depth !== 2) P('узор в заготовке — ссылка на живой рецепт');

  const target = {points: [], H: 300, D: 90, wall: 9, hollow: false,
                  footH: 0, footK: 50, rings: 0, segments: 24, pattern: null};
  applyBody(target, snap);
  if (target.H !== 200 || target.D !== 150) P('заготовка не принесла свои размеры');
  if (target.wall !== 5 || target.footH !== 6) P('заготовка не принесла стенку и ножку');
  if (target.hollow !== true) P('полость не восстановилась');
  if (!target.pattern || (target.pattern.layers[0] || {}).id !== 'flute') P('узор не восстановился');
  if (target.points.length !== 2) P('точки профиля не восстановились');
  if (target.activePreset !== -1) P('после заготовки не сброшен пресет силуэта');

  /* «Только силуэт»: чужая кривая на своей высоте и своём диаметре —
     то, ради чего заготовки и заводят. */
  const keepSize = {points: [], H: 300, D: 90, wall: 9, hollow: false,
                    footH: 0, footK: 50, rings: 0, segments: 24, pattern: null};
  applyBody(keepSize, snap, {size: false, pattern: false});
  if (keepSize.H !== 300 || keepSize.D !== 90) P('«только силуэт» всё равно переписал размеры');
  if (keepSize.pattern) P('«только силуэт» принёс чужой узор');
  if (keepSize.points.length !== 2) P('«только силуэт» не принёс саму кривую');

  /* Мусор вместо данных не должен ронять применение. */
  const safe = {points: [{t: 0, r: 0.3}], H: 111, D: 77};
  applyBody(safe, {points: 'нет', H: 'сто', wall: null});
  if (safe.H !== 111 || safe.D !== 77) P('мусорная заготовка переписала размеры');
  if (safe.points.length !== 1) P('мусорная заготовка испортила профиль');
}

/* ---------- крышка и прилеп ---------- */
{
  const lid = {on: true, type: 'inset', gap: 1.2};
  const snap = lidSnapshot(lid);
  lid.gap = 9;
  if (snap.gap !== 1.2) P('слепок крышки — ссылка на живую крышку');

  const part = {id: 'p1', kind: 'handle', out: 38, path: [{t: 0, d: 0}, {t: 1, d: 20}]};
  const ps = partSnapshot(part);
  part.path[1].d = 99;
  if (ps.path[1].d !== 20) P('слепок прилепа — ссылка на живую деталь');
}

console.log('\nПроверка своих заготовок');
console.log(`  видов: ${PRESET_KINDS.map(presetKindName).join(', ')}`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nЗаготовка не меняется вслед за изделием и не приносит чужого мусора.');
