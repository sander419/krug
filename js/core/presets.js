// file: js/core/presets.js
// Свои пресеты: заготовки корпуса, крышки и прилепов.
//
// Инструмент даёт шесть силуэтов и несколько типовых ручек — этого хватает,
// чтобы начать, и не хватает, чтобы работать. У мастерской своя ручка, своя
// посадка крышки и свой силуэт кружки, который повторяют десятый год: их
// заводят один раз и потом ставят одним нажатием.
//
// Устройство: пресет — это кусок рецепта, вырезанный по границе части.
//
//   • **корпус** — точки профиля и размеры, от которых считается всё
//     остальное (высота, диаметр, стенка, ножка, следы, узор);
//   • **крышка** — её собственная запись целиком;
//   • **прилеп** — одна деталь: вид, вылет, толщина, нарисованная кривая.
//
// Почему не «сохранить всё изделие»: изделие уже сохраняется в «Мои изделия»
// вместе с производственным контекстом. Пресет — про другое: взять чужую
// ручку и поставить на новую вещь.
//
// Хранилище — localStorage этого браузера, как и всё остальное. Ни DOM,
// ни расчёта: сюда передают готовые данные.

import { sanitizePattern } from './pattern.js';

const KEY = 'krug.presets';
const LIMIT = 120;
export const PRESET_KINDS = ['body', 'lid', 'part'];
export const NAME_LIMIT = 40;

const KIND_NAME = {body: 'корпус', lid: 'крышка', part: 'прилеп'};
export const presetKindName = k => KIND_NAME[k] || k;

/** Пустая запись: у пресета всегда есть вид, имя и данные. */
export function blankPreset(over = {}) {
  return {
    id: 'up' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    kind: 'body', name: 'Без названия', data: {}, ts: Date.now(),
    ...over,
  };
}

/** Привести запись к схеме: чужие поля выбрасываются, имя обрезается. */
export function sanitizePreset(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const kind = PRESET_KINDS.includes(src.kind) ? src.kind : 'body';
  const data = src.data && typeof src.data === 'object' ? src.data : {};
  return {
    id: String(src.id || blankPreset().id).slice(0, 40),
    kind,
    name: String(src.name || '').trim().slice(0, NAME_LIMIT) || KIND_NAME[kind],
    data,
    ts: +src.ts || Date.now(),
  };
}

export function loadPresets() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(KEY)) || []; } catch (_) { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizePreset);
}

export function savePresets(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT))); return true; }
  catch (_) { return false; }
}

/** Пресеты одного вида, свежие сверху. */
export const presetsOf = kind => loadPresets().filter(p => p.kind === kind)
  .sort((a, b) => b.ts - a.ts);

/**
 * Добавить пресет. Одноимённый того же вида заменяется: человек, сохраняя
 * «Моя ручка» второй раз, имеет в виду «вот теперь правильная», а не
 * «пусть будет две».
 */
export function addPreset(kind, name, data) {
  const rec = sanitizePreset({kind, name, data});
  const list = loadPresets().filter(p => !(p.kind === rec.kind && p.name === rec.name));
  list.unshift(rec);
  savePresets(list);
  return rec;
}

export function removePreset(id) {
  const list = loadPresets().filter(p => p.id !== id);
  savePresets(list);
  return list;
}

export function renamePreset(id, name) {
  const list = loadPresets();
  const p = list.find(x => x.id === id);
  if (!p) return null;
  p.name = String(name || '').trim().slice(0, NAME_LIMIT) || p.name;
  savePresets(list);
  return p;
}

/* ---------- что именно попадает в пресет ---------- */

/**
 * Слепок корпуса. Точки копируются, а не берутся ссылкой: иначе пресет
 * начнёт меняться вместе с изделием, из которого его сняли.
 */
export function bodySnapshot(state) {
  return {
    points: (state.points || []).map(p => ({t: +p.t, r: +p.r})),
    H: +state.H, D: +state.D,
    wall: +state.wall, hollow: !!state.hollow,
    footH: +state.footH, footK: +state.footK,
    rings: +state.rings || 0,
    segments: +state.segments || 72,
    /* Узор копируется через очистку: стопка слоёв — это массив объектов,
       и поверхностная копия оставила бы заготовку связанной с изделием. */
    pattern: state.pattern ? {layers: sanitizePattern(state.pattern).layers.map(l => ({...l}))} : null,
  };
}

/**
 * Применить слепок корпуса к состоянию.
 * `opt.size === false` — взять только силуэт, оставив свои размеры: так
 * чужой профиль ложится на вашу высоту и ваш диаметр.
 */
export function applyBody(state, data, opt = {}) {
  const d = data && typeof data === 'object' ? data : {};
  if (Array.isArray(d.points) && d.points.length >= 2)
    state.points = d.points.map(p => ({t: +p.t, r: +p.r}));
  if (opt.size !== false) {
    if (Number.isFinite(+d.H)) state.H = +d.H;
    if (Number.isFinite(+d.D)) state.D = +d.D;
  }
  for (const k of ['wall', 'footH', 'footK', 'rings', 'segments'])
    if (Number.isFinite(+d[k])) state[k] = +d[k];
  if (typeof d.hollow === 'boolean') state.hollow = d.hollow;
  if (d.pattern && opt.pattern !== false) state.pattern = sanitizePattern(d.pattern);
  state.activePreset = -1;
  return state;
}

export const lidSnapshot = lid => ({...(lid || {})});
export const partSnapshot = part => JSON.parse(JSON.stringify(part || {}));
