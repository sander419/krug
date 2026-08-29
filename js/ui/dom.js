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

/* Русское склонение по числу: 1 замечание, 2 замечания, 5 замечаний. */
export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};

/* Полоса, которая едет вбок: строка метрик, лента вкладок. Скрытый скроллбар
   выглядит опрятно ровно до момента, когда человек не догадывается, что полоса
   вообще едет: на ноутбуке из девяти метрик видно три, а четвёртая обрезана
   на полуслове. Отсюда две вещи — растворяющийся край как признак, что дальше
   есть ещё, и прокрутка колесом, потому что колесо у полосы вертикальное. */
export function hintScroll(el) {
  if (!el || el.dataset.hinted) return;
  el.dataset.hinted = '1';
  const upd = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.style.setProperty('--fadeL', (el.scrollLeft > 2 ? 26 : 0) + 'px');
    el.style.setProperty('--fadeR', (el.scrollLeft < max - 2 ? 26 : 0) + 'px');
  };
  el.addEventListener('scroll', upd, {passive: true});
  el.addEventListener('wheel', e => {
    if (!e.deltaY || el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, {passive: false});
  new ResizeObserver(upd).observe(el);
  // содержимое переписывается целиком при каждом пересчёте — край пересчитываем с ним
  new MutationObserver(upd).observe(el, {childList: true, subtree: true});
  upd();
}

/* Цвет из реестра (0xb4643c) в css-запись. */
export const hex = n => '#' + n.toString(16).padStart(6, '0');
