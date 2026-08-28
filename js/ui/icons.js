// file: js/ui/icons.js
// Одна оболочка на все иконки: размер, вес линии и скругления задаются здесь,
// а не в каждой кнопке. Раньше половина иконок была нарисована руками с разной
// толщиной обводки, половина — эмодзи, и интерфейс выглядел собранным из кусков.
//
// В разметке пишется только имя: <button data-icon="camera">Снимок</button>.
// paintIcons() подставляет <svg> перед текстом кнопки и повторно ничего не рисует,
// поэтому её можно звать после каждой перерисовки списка.
import { ICONS } from '../config/icons.js';

/** Разметка одной иконки. size — в пикселях, наследует цвет текста. */
export function icon(name, size) {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="ico" viewBox="0 0 24 24" width="${size || 18}" height="${size || 18}"` +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
    ` stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Заполнить все [data-icon] внутри root. Повторный вызов безопасен. */
export function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (el.dataset.iconDone === el.dataset.icon) return;
    const svg = icon(el.dataset.icon, +el.dataset.iconSize || undefined);
    if (!svg) return;
    const old = el.querySelector(':scope > svg.ico');
    if (old) old.remove();
    el.insertAdjacentHTML('afterbegin', svg);
    el.dataset.iconDone = el.dataset.icon;
  });
}
