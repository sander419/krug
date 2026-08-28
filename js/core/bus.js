// file: js/core/bus.js
// Мини-шина изменений: любое изменение рецепта вызывает подписчиков.
const subs = new Set();
/* Номер правки рецепта. По нему кэшируются выборки профиля: за кадр их просят
   четыре раза (геометрия, масса, прочность, чертёж), а меняются они только тут. */
let rev = 0;
export const revision = () => rev;
export function onChange(fn){ subs.add(fn); }
/* Отписка пока никому не нужна, но шина без неё — мина: подписчик, который
   переживает свою панель, продолжает считать. Оставлено осознанно. */
export function offChange(fn){ subs.delete(fn); }
export function emit(){ rev++; for(const f of subs) f(); }
