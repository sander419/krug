// file: js/core/bus.js
// Мини-шина изменений: любое изменение рецепта вызывает подписчиков.
const subs = new Set();
export function onChange(fn){ subs.add(fn); }
export function offChange(fn){ subs.delete(fn); }
export function emit(){ for(const f of subs) f(); }
