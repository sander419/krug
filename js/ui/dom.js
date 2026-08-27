// file: js/ui/dom.js
// Мелкие помощники интерфейса. Раньше каждый модуль объявлял их заново — семь копий
// одного и того же, и в каждой можно было ошибиться по-своему.
export const $ = id => document.getElementById(id);

/* Экранирование для вставки в innerHTML. Всё, что приходит из реестров и от
   пользователя, проходит через него. */
export const esc = s => String(s).replace(/[&<>"]/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

/* Число по-русски: пробел между разрядами, запятая в дробной части. */
export const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ru');

/* Десятичная запятая в готовой строке — для чисел из реестров (4.5 → 4,5). */
export const dec = v => String(v).replace('.', ',');

export const rub = v => Math.round(v).toLocaleString('ru') + ' ₽';

/* Цвет из реестра (0xb4643c) в css-запись. */
export const hex = n => '#' + n.toString(16).padStart(6, '0');
