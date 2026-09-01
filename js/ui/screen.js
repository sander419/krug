// file: js/ui/screen.js
// Полноэкранный экран поверх мастерской: одна оболочка на все.
//
// В КРУГе таких экранов уже было три — обучение, настройки расчёта, выбор
// задачи, — и каждый заводил свой оверлей, своё закрытие по Esc и свой заголовок.
// Версия 1.0 добавляет ещё пять; писать это в шестой раз значит гарантированно
// разойтись в мелочах: где-то Esc не закроет, где-то фокус уедет под слой.
//
// Здесь одна оболочка: заголовок, кнопка закрытия, Esc, клик по фону,
// блокировка прокрутки под слоем и возврат фокуса туда, откуда открыли.
import { $ } from './dom.js';
import { icon, paintIcons } from './icons.js';
import { applyHints, mountFirstHints } from './hints.js';

const stack = [];              // открытые экраны: закрываем верхний

function host() {
  let el = $('screenHost');
  if (!el) {
    el = document.createElement('div');
    el.id = 'screenHost';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

/* Отрисовка одного экрана в оболочку. Вынесена отдельно, потому что экран
   рисуется дважды: когда его открыли и когда к нему вернулись, закрыв верхний.
   `redraw` даёт свежую разметку — список изделий после отметки в процессе
   обязан показать новый этап, а не тот, что был при открытии. */
function render(rec) {
  const box = host();
  box.innerHTML = `
    <div class="screen${rec.wide ? ' wide' : ''}" role="dialog" aria-modal="true"
         aria-label="${rec.title}" tabindex="-1">
      <div class="screen-head">
        <div class="screen-title">
          <h2>${rec.title}</h2>
          ${rec.lead ? `<p>${rec.lead}</p>` : ''}
        </div>
        ${rec.tools || ''}
        <button class="btn icon screen-close" title="Закрыть (Esc)" aria-label="Закрыть">
          ${icon('x')}</button>
      </div>
      <div class="screen-body" id="screenBody">${
        (rec.redraw ? rec.redraw() : rec.html) || ''}</div>
    </div>`;
  box.classList.add('open');
  box.setAttribute('aria-hidden', 'false');
  document.body.classList.add('screen-open');

  box.querySelector('.screen-close').onclick = () => closeScreen();
  box.onclick = e => { if (e.target === box) closeScreen(); };
  paintIcons(box);
  applyHints(box);
  if (rec.onMount) rec.onMount(box);
  mountFirstHints(box);
  /* Фокус уводим внутрь, но на сам диалог, а не на первую кнопку: Tab тогда
     остаётся в слое, а подсказка над кнопкой закрытия не выскакивает первым,
     что человек видит на новом экране. */
  const dlg = box.querySelector('.screen');
  if (dlg) dlg.focus({preventScroll: true});
  return box;
}

/**
 * Открыть экран.
 * @param opt {id, title, lead, html, redraw, wide, onMount(root), onClose()}
 */
export function openScreen(opt) {
  const rec = {...opt, prev: document.activeElement};
  stack.push(rec);
  return render(rec);
}

/** Перерисовать содержимое открытого экрана, не теряя прокрутку. */
export function refreshScreen(html) {
  const body = $('screenBody');
  if (!body) return null;
  const top = body.scrollTop;
  body.innerHTML = html;
  body.scrollTop = top;
  paintIcons(body);
  applyHints(body);
  const rec = stack[stack.length - 1];
  if (rec && rec.onMount) rec.onMount(host());
  mountFirstHints(body);
  return body;
}

export function closeScreen() {
  const box = $('screenHost');
  const rec = stack.pop();
  if (!box) return;
  if (rec && rec.onClose) rec.onClose();
  /* Экран, открытый поверх другого (материалы из списка изделий, процесс
     из паспорта), закрывается **к нему**, а не в пустоту: иначе человек
     теряет место, откуда пришёл, и заходит заново. */
  if (stack.length) { render(stack[stack.length - 1]); return; }
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '';
  document.body.classList.remove('screen-open');
  if (rec && rec.prev && rec.prev.focus) rec.prev.focus({preventScroll: true});
}

export const screenOpen = () => stack.length > 0;

addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) { e.stopPropagation(); closeScreen(); }
});
