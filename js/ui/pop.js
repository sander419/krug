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
