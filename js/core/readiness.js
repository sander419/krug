// file: js/core/readiness.js
// Готовность изделия: можно ли это отдавать в работу.
//
// У мастера на экране два десятка чисел и список замечаний. Пока он смотрит
// на форму, всё это читается; когда доходит до «печатать или нет», ему нужен
// один ответ — и не украшенный, а собранный из тех же проверок, которые уже
// прошли. Здесь этот ответ и собирается.
//
// Четыре уровня и что каждый значит:
//
//   • `blocked` — **производство невозможно**: вещь не выйдет из машины или
//     не выйдет из печи. Не «плохо получится», а не получится: не влезает
//     в камеру, слой толще сопла, стенка прорвана насквозь, крышка не сядет.
//   • `unknown` — **не хватает данных**: инструмент не знает числа, без
//     которого ответ был бы выдумкой. Водогипсовое отношение марки, мощность
//     своей печи, цена глазури. Это не ошибка мастера — это честное «нечем
//     считать».
//   • `warn` — **есть технологические замечания**: сделать можно, но вылезет
//     то, о чём сказано.
//   • `ready` — ничего из перечисленного.
//
// Правило, которое здесь важнее всего: **уровень не выдумывается**. Каждая
// причина ссылается на то же замечание или тот же расчёт, что человек уже
// видит в панели. Красный статус без причины — это украшение, а украшение
// в производственном инструменте хуже, чем его отсутствие.

import { sanitizeLid } from './lid.js';
import { byId } from '../config/materials.js';
import { byGlazeId } from '../config/glazes.js';
import { byKilnId } from '../config/kilns.js';
import { byId as byPlasterId } from '../config/plasters.js';
import { firedSize, kilnLoad } from './kiln.js';

export const LEVELS = {
  ready:   {id: 'ready',   name: 'Готово к производству', tone: 'ok',
            what: 'Ни одного замечания и ни одного неизвестного числа.'},
  warn:    {id: 'warn',    name: 'Есть замечания',        tone: 'warn',
            what: 'Сделать можно, но вылезет то, о чём сказано ниже.'},
  unknown: {id: 'unknown', name: 'Не хватает данных',     tone: 'unknown',
            what: 'Часть чисел инструменту неизвестна — считать их было бы выдумкой.'},
  blocked: {id: 'blocked', name: 'Производство невозможно', tone: 'bad',
            what: 'Вещь не выйдет из машины или из печи, пока это не исправлено.'},
};

/* Порядок «что хуже». Технологическое замечание хуже неизвестного числа:
   первое говорит, что вещь треснет, второе — что мы чего-то не знаем о цене
   или замесе. Отказ хуже всего. */
const ORDER = ['ready', 'unknown', 'warn', 'blocked'];
const worse = (a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a);

/**
 * Готовность изделия к производству.
 *
 * @param state   рецепт
 * @param ctx     {prod, str, warnings, gcode} — уже посчитанное; ничего
 *                не пересчитывается заново, чтобы статус не разошёлся
 *                с числами на экране
 * @returns {level, name, tone, what, reasons: [{lvl, txt, where}]}
 */
export function readiness(state, ctx = {}) {
  const reasons = [];
  let level = 'ready';
  const add = (lvl, txt, where) => { reasons.push({lvl, txt, where}); level = worse(level, lvl); };

  /* 1. Замечания мастера — те же, что в панели. Красное значит «не выйдет». */
  for (const w of ctx.warnings || []) {
    if (w.lvl === 'bad') add('blocked', w.txt, 'Контроль мастера');
    else if (w.lvl === 'warn') add('warn', w.txt, 'Контроль мастера');
  }

  /* 2. Печать. Слайсер говорит своим языком (e/w), но «e» — это тот же отказ:
        такой файл машина не примет. */
  for (const w of (ctx.gcode && ctx.gcode.warnings) || []) {
    if (w.cls === 'e') add('blocked', w.txt, 'G-code');
    else if (w.cls === 'w') add('warn', w.txt, 'G-code');
  }

  /* 3. Печь. Вещь, которая не влезает в камеру, не обжигается — и это
        не замечание, а отказ. Считается по габариту после обжига вместе
        с рельефом, прилепами и крышкой. */
  const mat = byId(state.mat);
  if (ctx.prof && mat) {
    const lid = sanitizeLid(state.lid);
    const fired = firedSize(ctx.prof, state.parts, mat.shrinkPct, ctx.lidPts,
                            {pattern: state.pattern, lidPattern: lid.on && lid.pattern});
    const kiln = byKilnId(state.kiln && state.kiln.id);
    const load = kilnLoad(kiln, fired);
    if (load && load.perShelf === 0)
      add('blocked', `После обжига ⌀${(fired.d / 10).toFixed(1)} × ${(fired.h / 10).toFixed(1)} см — ` +
        `в «${kiln.name}» не входит ни одно изделие.`, 'Печь');
  }

  /* 4. Неизвестные числа. Не ошибка, а честная нехватка данных: пока их нет,
        часть ответов инструмент не даёт вовсе. Проверяются только те, которые
        и правда участвуют в расчёте этого изделия. */
  const unknownOf = rec => (rec && Array.isArray(rec.unknown) ? rec.unknown : []);
  for (const f of unknownOf(mat))
    if (['shrinkPct', 'densityGcm3', 'tauKPa'].includes(f))
      add('unknown', `У массы «${mat.name}» не опубликовано «${f}» — считаем по оценке.`, 'Материал');
  if (state.firing === 'glaze') {
    const gl = byGlazeId(state.glazeId);
    if (gl && unknownOf(gl).length)
      add('unknown', `У глазури «${gl.name}» неизвестно: ${unknownOf(gl).join(', ')}.`, 'Глазурь');
  }
  /* Гипс участвует в расчёте только у того, кто делает форму. Мастеру,
     который печатает вазу, водогипсовое отношение марки не мешает ничем,
     и статус «не хватает данных» на этом основании был бы шумом. */
  const tabs = ctx.tabs || null;
  const uses = t => !tabs || tabs.includes(t);
  const pl = byPlasterId(state.plaster && state.plaster.id);
  if (pl && pl.waterRatio == null && (uses('tool') || uses('cast')))
    add('unknown', `У гипса «${pl.name}» водогипсовое отношение не публикуется — ` +
      'замес считается по вашему числу, а не по паспорту.', 'Гипс');
  if (state.kiln && state.kiln.id === 'own' && !(state.kiln.own && +state.kiln.own.kw > 0))
    add('unknown', 'У своей печи не задана мощность — цену обжига посчитать не из чего.', 'Печь');

  /* Причины показываются от худшей: человек, увидевший красный статус, должен
     первой строкой прочитать именно то, из-за чего он красный. */
  reasons.sort((a, b) => ORDER.indexOf(b.lvl) - ORDER.indexOf(a.lvl));

  const L = LEVELS[level];
  return {level, name: L.name, tone: L.tone, what: L.what, reasons};
}

/** Короткая строка для шапки и паспорта: «Готово» / «3 замечания» / … */
export function readinessLabel(r) {
  if (!r) return '';
  if (r.level === 'ready') return LEVELS.ready.name;
  const n = r.reasons.length;
  const word = n % 10 === 1 && n % 100 !== 11 ? 'причина'
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'причины' : 'причин';
  return `${LEVELS[r.level].name} · ${n} ${word}`;
}
