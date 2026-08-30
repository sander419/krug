// file: js/core/history.js
// Отмена и повтор. Редактор профиля разрушающий: точка удаляется правой кнопкой
// (на телефоне — долгим нажатием), пресет затирает нарисованное, «случайная форма»
// стирает всё разом. Без отмены одно случайное движение уносит работу, а сохранения
// у КРУГа нет — только ссылка, которую ещё надо было догадаться скопировать.
//
// Хранится не весь state, а рецепт: этап «Кинотеатра», вращение круга и каркас
// к работе не относятся, и откатывать их вместе с формой было бы неожиданно.
import { state } from './state.js';

const KEYS = ['name', 'points', 'activePreset', 'H', 'D', 'segments', 'rings',
              'hollow', 'wall', 'footH', 'footK', 'allow', 'mat', 'firing',
              'seed', 'pr', 'glaze', 'glazeId', 'parts', 'kiln', 'cast', 'tune', 'lid', 'plaster', 'cost'];

const LIMIT = 60;          // шагов назад; больше не нужно, а память не резиновая
const COALESCE = 350;      // мс: тянущийся ползунок — один шаг, а не сорок

const past = [];
const future = [];
let last = null, timer = null, applying = false;
let onApply = null;

const shot = () => JSON.stringify(Object.fromEntries(KEYS.map(k => [k, state[k]])));

function restore(json) {
  const d = JSON.parse(json);
  for (const k of KEYS) if (d[k] !== undefined) state[k] = d[k];
}

/** Запомнить текущий рецепт, если он отличается от последнего запомненного. */
function commit() {
  const now = shot();
  if (now === last) return;
  if (last !== null) {
    past.push(last);
    if (past.length > LIMIT) past.shift();
    future.length = 0;                 // новая правка обрывает ветку повтора
  }
  last = now;
  notify();
}

/* Правки идут пачками (тянут ползунок, тащат точку), поэтому не пишем каждую. */
export function record() {
  if (applying) return;
  clearTimeout(timer);
  timer = setTimeout(commit, COALESCE);
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

function notify() { if (onApply) onApply(); }

export function undo() {
  clearTimeout(timer);
  commit();                            // незаписанная правка тоже должна отменяться
  if (!past.length) return false;
  future.push(last);
  last = past.pop();
  applying = true;
  restore(last);
  applying = false;
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(last);
  last = future.pop();
  applying = true;
  restore(last);
  applying = false;
  return true;
}

/** Первый снимок — то состояние, в котором приложение открылось. */
export function initHistory(onChangeFn) {
  onApply = onChangeFn;
  last = shot();
  notify();
}
