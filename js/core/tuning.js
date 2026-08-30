// file: js/core/tuning.js
// Текущее значение порога: своё, если задано, иначе умолчание инструмента.
//
// Одна функция `tune(id)` вместо констант по файлам. Всё, что её читает,
// автоматически считается по настройке мастерской — и в панели, и в техкарте,
// и в выгрузках, потому что читают её все одинаково.
//
// Значения лежат в state.tune и уезжают в ссылку-ДНК вместе с рецептом: иначе
// у автора и у получателя сойдутся формы, но разойдутся числа, и это худший
// вид расхождения — молчаливый.
import { TUNING_BY_ID } from '../config/tuning.js';
import { state } from './state.js';
import { clamp } from './util.js';

/** Значение порога по id. Неизвестный id — ошибка разработчика, а не ноль. */
export function tune(id) {
  const t = TUNING_BY_ID.get(id);
  if (!t) throw new Error(`неизвестный порог «${id}»`);
  const own = state.tune && state.tune[id];
  return Number.isFinite(own) ? clamp(own, t.min, t.max) : t.def;
}

/** Задать своё значение. Пустое или равное умолчанию — снять переопределение. */
export function setTune(id, v) {
  const t = TUNING_BY_ID.get(id);
  if (!t) return;
  if (!state.tune) state.tune = {};
  if (v === null || v === undefined || !Number.isFinite(+v)) { delete state.tune[id]; return; }
  const val = clamp(+v, t.min, t.max);
  if (val === t.def) delete state.tune[id];
  else state.tune[id] = val;
}

export const isTuned = id => !!(state.tune && Number.isFinite(state.tune[id]));
export const tunedCount = () => Object.keys(state.tune || {}).length;

/** Вернуть умолчания: одному порогу или всем сразу. */
export function resetTune(id) {
  if (!state.tune) return;
  if (id) delete state.tune[id];
  else state.tune = {};
}

/** Очистка чужих значений при загрузке ДНК: id из будущей версии игнорируем. */
export function sanitizeTune(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const t = TUNING_BY_ID.get(k);
    if (t && Number.isFinite(+v)) {
      const val = clamp(+v, t.min, t.max);
      if (val !== t.def) out[k] = val;
    }
  }
  return out;
}
