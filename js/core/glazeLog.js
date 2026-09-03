// file: js/core/glazeLog.js
// Журнал замеров глазури: то, чего инструмент не знает и знать не может.
//
// Толщину плёнки в миллиметрах КРУГ не считает и считать не будет. Она зависит
// от вещей, которых нет ни в одном паспорте: сколько секунд держали в ведре,
// какой плотности был шликер в тот день, насколько пористым вышел утиль,
// сколько слоёв положили и как сохло. Модель покрытия даёт **оценку** формы
// плёнки — где тоньше, где копится, — и множители к ней; миллиметры остаются
// `unknown`.
//
// Единственный честный способ получить миллиметры — записать их. Мастерская
// и так это делает: пробники, полоски, бирки на полке. Здесь та же запись,
// только в схеме, которую можно считать и сверять с расчётом.
//
// **Чем это не является.** Это не CRM и не журнал производства: ни заказов,
// ни клиентов, ни планов. Одна запись — один замер одной глазури на одном
// черепке. Всё, что не про замер, сюда не кладётся.
//
// Хранилище — тот же localStorage этого браузера, что и у работ: у КРУГа
// нет сервера, и запись не уезжает никуда сама.


export const GLAZE_LOG_SCHEMA = 1;
const KEY = 'krug.glazeLog';
const LIMIT = 500;

/** Как наносили. Расход и толщина у этих способов разные, и смешивать их нельзя. */
export const APPLY_WAYS = [
  {id: 'dip',    name: 'Макание',      what: 'изделие целиком в ведро на несколько секунд'},
  {id: 'pour',   name: 'Полив',        what: 'льют из ковша, изделие поворачивают'},
  {id: 'spray',  name: 'Пульверизатор', what: 'слоями с просушкой между ними'},
  {id: 'brush',  name: 'Кистью',       what: 'обычно три слоя крест-накрест'},
];
export const wayById = id => APPLY_WAYS.find(w => w.id === id) || APPLY_WAYS[0];

/** Чем кончилось. Ради этого столбца журнал и ведут. */
export const OUTCOMES = [
  {id: 'good',   name: 'Как задумано',  tone: 'ok'},
  {id: 'thin',   name: 'Тонко',         tone: 'warn', what: 'просвечивает черепок, цвет бледный'},
  {id: 'thick',  name: 'Толсто',        tone: 'warn', what: 'наплывы, стекло мутное'},
  {id: 'crawl',  name: 'Сборка',        tone: 'bad',  what: 'глазурь стянулась и оголила черепок'},
  {id: 'craze',  name: 'Цек',           tone: 'bad',  what: 'сетка трещин по глазури'},
  {id: 'shiver', name: 'Отскок',        tone: 'bad',  what: 'глазурь отслаивается чешуйками'},
  {id: 'pin',    name: 'Наколы',        tone: 'warn', what: 'точечные проколы до черепка'},
  {id: 'run',    name: 'Потёк',         tone: 'bad',  what: 'стекла на полку'},
];
export const outcomeById = id => OUTCOMES.find(o => o.id === id) || OUTCOMES[0];

/* Пределы полей. Не «красивые» числа, а границы, за которыми запись означает
   опечатку: глазурь плотностью 5 г/см³ не бывает, макание на два часа тоже. */
export const LOG_LIMITS = {
  densityGcm3: [1.2, 2.2],      // плотность шликера ареометром
  dipSec:      [0.5, 120],      // сколько держали
  coats:       [1, 6],          // слоёв
  dryMM:       [0.05, 5],       // толщина после сушки, замер штангенциркулем по срезу
  firedMM:     [0.05, 5],       // толщина после обжига
  tempC:       [600, 1400],     // температура политого обжига
};

/**
 * Пустая запись замера. Поля, которых мастер не мерил, остаются `null` —
 * и это не «ноль», а честное «не мерили»: среднее по журналу считается
 * только по тем записям, где число есть.
 */
export function blankEntry(over = {}) {
  return {
    id: 'gl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    ts: Date.now(),
    matId: null,          // масса черепка (id из реестра) — пористость утиля разная
    glazeId: null,        // семейство глазури (id из реестра)
    glazeName: '',        // марка поставщика: реестр знает семейства, не марки
    way: 'dip',           // способ нанесения
    densityGcm3: null,    // плотность шликера
    dipSec: null,         // секунд в ведре
    coats: 1,             // слоёв
    tempC: null,          // температура политого обжига
    dryMM: null,          // толщина после сушки
    firedMM: null,        // толщина после обжига
    outcome: 'good',      // чем кончилось
    defects: [],          // что вылезло, кроме основного исхода
    note: '',
    ...over,
  };
}

/* Число вне пределов здесь **не обрезается**, а становится «не записано».
   Журнал — это замеры: обрезав опечатку «−5 секунд» до половины секунды,
   мы получили бы правдоподобное число, которого никто не мерил, и потом
   считали бы по нему среднее. Пределы взяты с запасом, чтобы настоящий
   замер в них помещался. */
const numOrNull = (v, key) => {
  if (v === null || v === undefined || v === '') return null;
  const n = +v;
  if (!Number.isFinite(n)) return null;
  const [lo, hi] = LOG_LIMITS[key];
  return (n < lo || n > hi) ? null : n;
};

/** Привести запись к схеме. Мусор становится «не мерили», а не нулём. */
export function sanitizeEntry(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const e = blankEntry({id: String(src.id || blankEntry().id).slice(0, 40)});
  e.ts = +src.ts || Date.now();
  e.matId = src.matId ? String(src.matId).slice(0, 40) : null;
  e.glazeId = src.glazeId ? String(src.glazeId).slice(0, 40) : null;
  e.glazeName = String(src.glazeName || '').slice(0, 60);
  e.way = wayById(src.way).id;
  for (const k of ['densityGcm3', 'dipSec', 'coats', 'tempC', 'dryMM', 'firedMM'])
    e[k] = numOrNull(src[k], k);
  e.outcome = outcomeById(src.outcome).id;
  e.defects = Array.isArray(src.defects)
    ? src.defects.filter(d => OUTCOMES.some(o => o.id === d)).slice(0, 8) : [];
  e.note = String(src.note || '').slice(0, 400);
  return e;
}

export function loadLog() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(KEY)) || []; } catch (_) { return []; }
  return Array.isArray(raw) ? raw.map(sanitizeEntry) : [];
}

export function saveLog(list) {
  const keep = (Array.isArray(list) ? list : []).slice(-LIMIT).map(sanitizeEntry);
  try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch (_) {}
  return keep;
}

export function addEntry(entry) {
  const list = loadLog();
  list.push(sanitizeEntry(entry));
  return saveLog(list);
}

export function removeEntry(id) {
  return saveLog(loadLog().filter(e => e.id !== id));
}

/**
 * Что журнал знает про эту пару «масса + глазурь + способ».
 *
 * Возвращает `null`, пока замеров нет: **отсутствие данных — это ответ**,
 * и подставлять вместо него среднее по всем глазурям было бы ровно тем
 * враньём, ради ухода от которого журнал и заводится.
 *
 * Одного замера мало, чтобы называть его толщиной этой глазури, поэтому
 * запись про число замеров идёт вместе с числом — и та, и другая честны.
 *
 * @returns {n, firedMM, dryMM, spread, sameGlaze, sameMat} | null
 */
export function summarize(list, {matId, glazeId, way} = {}) {
  const rows = (list || []).filter(e =>
    (!glazeId || e.glazeId === glazeId) &&
    (!matId || e.matId === matId) &&
    (!way || e.way === way));
  const fired = rows.map(e => e.firedMM).filter(v => v != null);
  const dry = rows.map(e => e.dryMM).filter(v => v != null);
  if (!fired.length && !dry.length) return null;
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    n: rows.length,
    firedMM: fired.length ? mean(fired) : null,
    dryMM: dry.length ? mean(dry) : null,
    /* Разброс важнее среднего: два замера по 0,3 и 1,1 мм — это не «0,7 мм»,
       а «мы пока не умеем повторять». */
    spread: fired.length > 1 ? Math.max(...fired) - Math.min(...fired) : null,
    sameGlaze: !!glazeId, sameMat: !!matId,
  };
}
