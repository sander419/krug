// file: js/core/bus.js
// Мини-шина изменений: любое изменение рецепта вызывает подписчиков.
const subs = new Set();
export function onChange(fn){ subs.add(fn); }
/* Отписка пока никому не нужна, но шина без неё — мина: подписчик, который
   переживает свою панель, продолжает считать. Оставлено осознанно. */
export function offChange(fn){ subs.delete(fn); }
export function emit(){ for(const f of subs) f(); }
