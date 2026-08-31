// file: js/core/works.js
// Изделия мастера: хранилище и схема записи. Чистая логика без DOM.
//
// Раньше работа была тремя полями — имя, ДНК, дата — и жила внутри всплывающего
// списка в шапке. Для версии 1.0 этого мало: у изделия есть жизнь после
// проектирования — его делают, сушат, обжигают, меряют и сравнивают расчёт
// с фактом. Всё это к рецепту не относится и в ДНК ему не место.
//
// Отсюда главное разделение:
//
//   • **ДНК** — рецепт. Что нарисовано и из чего сделано. Переносится ссылкой,
//     открывается у другого человека, обязана оставаться совместимой.
//   • **Запись работы** — рецепт плюс производственный контекст: этап, отметки
//     сделанного, фактические замеры, заметка, избранное, архив. Это личное
//     и в ссылку не уезжает.
//
// Хранилище — localStorage этого браузера. Сервера у КРУГа нет и не будет.
import { sanitizeFact } from './fact.js';

export const WORKS_SCHEMA = 2;
const KEY = 'krug.works';
const LIMIT = 200;          // было 40: список стал главным экраном, а не поповером

/**
 * Этапы производства. Часть из них выводится из данных (есть форма, выбрана
 * масса, нет красных замечаний), часть — физические действия, которые может
 * подтвердить только человек: высохло, обожглось, проверено.
 */
export const PHASES = [
  {id: 'draft',   name: 'Черновик',     what: 'рецепт есть, производство не начато'},
  {id: 'making',  name: 'Изготовление', what: 'формуется или печатается'},
  {id: 'drying',  name: 'Сушка',        what: 'сохнет до кожетвёрдого и дальше'},
  {id: 'bisque',  name: 'Утиль',        what: 'первый обжиг'},
  {id: 'glazing', name: 'Глазурь',      what: 'полито, ждёт политого обжига'},
  {id: 'firing',  name: 'Обжиг',        what: 'в печи'},
  {id: 'check',   name: 'Контроль',     what: 'меряем и записываем факт'},
  {id: 'done',    name: 'Готово',       what: 'изделие сделано'},
];

export const phaseById = id => PHASES.find(p => p.id === id) || PHASES[0];
export const phaseIndex = id => Math.max(0, PHASES.findIndex(p => p.id === id));

/** Пустая запись работы: всё, чего нет в ДНК. */
export function blankWork(over = {}) {
  return {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    name: 'Без названия', dna: '',
    ts: Date.now(), created: Date.now(),
    fav: false, archived: false,
    phase: 'draft',
    done: {},                 // отметки физических шагов: {drying:true, bisque:true, …}
    fact: {},                 // фактические замеры, см. js/core/fact.js
    note: '',
    thumb: '',                // маленький снимок вида, data:URL
    ...over,
  };
}

/* Чтение с миграцией: записи первой схемы (id, name, dna, ts) дополняются
   недостающими полями, а не выбрасываются. Человек не должен терять список
   из-за того, что мы добавили колонку. */
export function loadWorks() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(KEY)) || []; } catch (_) { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.filter(w => w && w.dna).map(w => ({
    ...blankWork(),
    ...w,
    fav: !!w.fav, archived: !!w.archived,
    phase: w.phase && PHASES.some(p => p.id === w.phase) ? w.phase : 'draft',
    done: w.done && typeof w.done === 'object' ? w.done : {},
    fact: sanitizeFact(w.fact),
    created: +w.created || +w.ts || Date.now(),
    ts: +w.ts || Date.now(),
  }));
}

export function saveWorks(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT))); return true; }
  catch (_) { return false; }
}

export const getWork = id => loadWorks().find(w => w.id === id) || null;

/** Добавить или заменить запись. Возвращает список после правки. */
export function upsertWork(rec) {
  const list = loadWorks();
  const i = list.findIndex(w => w.id === rec.id);
  if (i >= 0) list[i] = {...list[i], ...rec, ts: Date.now()};
  else list.unshift({...blankWork(), ...rec});
  saveWorks(list);
  return list;
}

/** Точечная правка полей записи: этап, избранное, факт, заметка. */
export function patchWork(id, patch) {
  const list = loadWorks();
  const w = list.find(x => x.id === id);
  if (!w) return null;
  Object.assign(w, patch, {ts: Date.now()});
  if (patch.fact) w.fact = sanitizeFact({...w.fact, ...patch.fact});
  saveWorks(list);
  return w;
}

export function removeWork(id) {
  const list = loadWorks().filter(w => w.id !== id);
  saveWorks(list);
  return list;
}

/** Копия работы: тот же рецепт, новое имя, чистый производственный контекст. */
export function duplicateWork(id) {
  const w = getWork(id);
  if (!w) return null;
  const copy = blankWork({
    name: nextCopyName(w.name), dna: w.dna, thumb: w.thumb, note: w.note,
  });
  upsertWork(copy);
  return copy;
}

/* «Ваза» → «Ваза (2)» → «Ваза (3)»: копия не должна затирать оригинал
   и не должна называться так же, иначе список превращается в загадку. */
function nextCopyName(name) {
  const list = loadWorks();
  const base = String(name).replace(/\s*\(\d+\)$/, '');
  let n = 2;
  while (list.some(w => w.name === `${base} (${n})`)) n++;
  return `${base} (${n})`;
}

/**
 * Отбор и порядок для экрана «Мои изделия».
 * @param opt {q, archived, fav, sort:'ts'|'name'|'created'}
 */
export function selectWorks(list, opt = {}) {
  const q = String(opt.q || '').trim().toLowerCase();
  let out = list.filter(w => !!w.archived === !!opt.archived);
  if (opt.fav) out = out.filter(w => w.fav);
  if (q) out = out.filter(w => (w.name + ' ' + (w.note || '')).toLowerCase().includes(q));
  const by = opt.sort || 'ts';
  out.sort((a, b) => by === 'name'
    ? a.name.localeCompare(b.name, 'ru')
    : (b[by] || 0) - (a[by] || 0));
  /* Избранное всегда наверху: его для того и отмечают. */
  return out.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
}
