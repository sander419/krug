// file: js/core/notes.js
// Свои замеры поверх паспорта поставщика.
//
// Паспортная усадка 9 % — это средняя по партии, снятая в чужой мастерской
// на чужой печи. У мастера она своя, и он её знает по своим изделиям. Правило
// проекта — «ни одного числа без источника» — не запрещает такие числа,
// оно запрещает **подменять** ими паспорт.
//
// Отсюда устройство: паспорт неприкосновенен, свои замеры лежат рядом,
// показываются вместе с ним и подписаны как ваши. Среднее считается по всем
// замерам, но нигде не выдаётся за паспортное.
//
// Хранилище — localStorage. Ни DOM, ни реестров: сюда передают только id.

const KEY = 'krug.notes';

/** Какие поля можно замерять у своего материала. */
export const MEASURABLE = {
  mat: [
    {k: 'shrinkPct', name: 'Усадка', unit: '%', step: 0.1, dec: 1, of: m => m.shrinkPct},
    {k: 'density', name: 'Плотность', unit: 'г/см³', step: 0.01, dec: 2, of: m => m.density},
    {k: 'priceRub', name: 'Цена', unit: '₽/кг', step: 5, dec: 0,
     of: m => m.priceRub && m.packKg ? m.priceRub / m.packKg : null},
  ],
  glaze: [
    {k: 'gPerCm2', name: 'Расход', unit: 'г/см²', step: 0.01, dec: 2, of: () => null},
    {k: 'priceRub', name: 'Цена', unit: '₽/кг', step: 50, dec: 0,
     of: g => g.priceRub && g.packKg ? g.priceRub / g.packKg : null},
  ],
  plaster: [
    {k: 'waterRatio', name: 'Водогипсовое', unit: '%', step: 1, dec: 0, of: p => p.waterRatio},
    {k: 'priceRub', name: 'Цена', unit: '₽/кг', step: 5, dec: 0,
     of: p => p.priceRub && p.packKg ? p.priceRub / p.packKg : null},
  ],
};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; }
}
function save(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch (_) { return false; }
}

const slot = (kind, id) => `${kind}:${id}`;

/** Всё, что мастер записал про эту запись реестра. */
export function getNote(kind, id) {
  const rec = load()[slot(kind, id)] || {};
  return {measures: rec.measures || {}, note: rec.note || ''};
}

/** Добавить замер. Значения хранятся списком: среднее считается по всем. */
export function addMeasure(kind, id, field, value) {
  const v = +value;
  if (!Number.isFinite(v)) return null;
  const all = load();
  const k = slot(kind, id);
  const rec = all[k] || {measures: {}, note: ''};
  const list = (rec.measures[field] || []).concat(v).slice(-20);
  rec.measures = {...rec.measures, [field]: list};
  all[k] = rec;
  save(all);
  return list;
}

export function removeMeasure(kind, id, field, index) {
  const all = load();
  const rec = all[slot(kind, id)];
  if (!rec || !rec.measures[field]) return null;
  rec.measures[field] = rec.measures[field].filter((_, i) => i !== index);
  if (!rec.measures[field].length) delete rec.measures[field];
  save(all);
  return rec.measures[field] || [];
}

export function setNoteText(kind, id, text) {
  const all = load();
  const k = slot(kind, id);
  all[k] = {...(all[k] || {measures: {}}), note: String(text || '').slice(0, 2000)};
  save(all);
  return all[k].note;
}

/** Среднее по замерам и насколько оно расходится с паспортом. */
export function average(list) {
  if (!list || !list.length) return null;
  return list.reduce((s, v) => s + v, 0) / list.length;
}

export function measureSummary(kind, id, field, passport) {
  const list = getNote(kind, id).measures[field] || [];
  const avg = average(list);
  return {
    list, avg,
    passport: Number.isFinite(passport) ? passport : null,
    /* Расхождение считаем от паспорта: вопрос «насколько моя мастерская
       отличается от того, что обещает поставщик». */
    deltaPct: avg != null && passport ? (avg - passport) / passport * 100 : null,
  };
}

/** Сколько всего записей мастер сделал: по этому видно, стоит ли их показывать. */
export function noteCount() {
  const all = load();
  let n = 0;
  for (const k of Object.keys(all)) {
    const r = all[k];
    if (r.note) n++;
    for (const f of Object.keys(r.measures || {})) n += r.measures[f].length;
  }
  return n;
}
