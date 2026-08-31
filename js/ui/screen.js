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

/**
 * Открыть экран.
 * @param opt {id, title, lead, html, wide, onMount(root), onClose()}
 */
export function openScreen(opt) {
  const box = host();
  const prev = document.activeElement;
  const rec = {...opt, prev};
  stack.push(rec);

  box.innerHTML = `
    <div class="screen${opt.wide ? ' wide' : ''}" role="dialog" aria-modal="true"
         aria-label="${opt.title}">
      <div class="screen-head">
        <div class="screen-title">
          <h2>${opt.title}</h2>
          ${opt.lead ? `<p>${opt.lead}</p>` : ''}
        </div>
        ${opt.tools || ''}
        <button class="btn icon screen-close" title="Закрыть (Esc)" aria-label="Закрыть">
          ${icon('x')}</button>
      </div>
      <div class="screen-body" id="screenBody">${opt.html || ''}</div>
    </div>`;
  box.classList.add('open');
  box.setAttribute('aria-hidden', 'false');
  document.body.classList.add('screen-open');

  box.querySelector('.screen-close').onclick = () => closeScreen();
  box.onclick = e => { if (e.target === box) closeScreen(); };
  paintIcons(box);
  if (opt.onMount) opt.onMount(box);
  /* Фокус уводим внутрь: иначе Tab уходит под слой, к кнопкам мастерской. */
  const first = box.querySelector('input,button,select,[tabindex]');
  if (first) first.focus({preventScroll: true});
  return box;
}

/** Перерисовать содержимое открытого экрана, не теряя прокрутку. */
export function refreshScreen(html) {
  const body = $('screenBody');
  if (!body) return null;
  const top = body.scrollTop;
  body.innerHTML = html;
  body.scrollTop = top;
  paintIcons(body);
  const rec = stack[stack.length - 1];
  if (rec && rec.onMount) rec.onMount(host());
  return body;
}

export function closeScreen() {
  const box = $('screenHost');
  const rec = stack.pop();
  if (!box) return;
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '';
  document.body.classList.remove('screen-open');
  if (rec) {
    if (rec.onClose) rec.onClose();
    if (rec.prev && rec.prev.focus) rec.prev.focus({preventScroll: true});
  }
}

export const screenOpen = () => stack.length > 0;

addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) { e.stopPropagation(); closeScreen(); }
});
