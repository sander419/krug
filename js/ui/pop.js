// file: js/ui/pop.js
// Всплывающая панель у кнопки: окружение, работы, список задач.
//
// Раньше каждая такая панель прибивалась к кнопке вручную — `top: 100%` плюс
// медиазапрос «на узком экране прижать к правому краю». Это работает ровно до
// первого случая, который не предусмотрели: кнопка у нижнего края, узкое окно,
// увеличенный масштаб интерфейса. Позицию считает Floating UI: она переворачивает
// панель, когда снизу нет места, и подвигает, когда та упирается в край.
//
// strategy: 'fixed' — панель считается от окна, а не от родителя: иначе её
// режет любой предок с overflow, а таких в шапке хватает.
import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom';

/**
 * Привязать панель к кнопке. Возвращает функцию «отцепить» — звать при закрытии,
 * иначе слежение за прокруткой и размером окна останется висеть навсегда.
 */
export function anchorPop(btn, pop, opts = {}) {
  const place = async () => {
    const {x, y, placement} = await computePosition(btn, pop, {
      strategy: 'fixed',
      placement: opts.placement || 'bottom-end',
      middleware: [offset(8), flip({padding: 10}), shift({padding: 10})],
    });
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
    pop.dataset.at = placement;
  };
  return autoUpdate(btn, pop, place);
}

/* Кнопка с меню в шапке. Одна функция на все такие пары: открыть, закрыть
   по клику мимо, по Esc и по выбору внутри, отцепить слежение при закрытии.
   Каждая всплывашка, написанная заново, — это ещё один способ забыть про Esc. */
export function popover(btn, pop, opts = {}) {
  if (!btn || !pop) return;
  let detach = null;
  const close = () => {
    if (!pop.classList.contains('open')) return;
    pop.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    if (detach) { detach(); detach = null; }
  };
  const open = () => {
    pop.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    detach = anchorPop(btn, pop, opts);
  };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    pop.classList.contains('open') ? close() : open();
  });
  /* Выбрал пункт — меню закрылось. Кроме тех, что жмут подряд: тему перебирают
     по кругу, масштаб — по шагу, и закрывать меню на каждом шаге незачем. */
  pop.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.hasAttribute('data-keep-open')) close();
  });
  document.addEventListener('click', e => { if (!e.target.closest('#' + pop.id + ',#' + btn.id)) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
