// file: js/ui/hints.js
// Расстановка подсказок из реестра и «первый заход» в раздел.
//
// Подсказки лежат данными (`js/config/hints.js`), а элементы, к которым они
// относятся, рождаются в разное время: часть в разметке, часть — строкой при
// каждой перерисовке экрана. Поэтому расстановка — не разовая, а по вызову:
// нарисовали кусок интерфейса — позвали `applyHints(root)`.
//
// Показывает подсказки прежний механизм (`js/ui/tips.js`): здесь только
// проставляется `data-tip`. Своё в разметке сильнее реестра: если у кнопки
// уже есть живой `title`, который меняется на ходу (тема, задача, окружение),
// перебивать его нельзя.
import { HINTS } from '../config/hints.js';
import { articleById } from '../config/kb/index.js';

/**
 * Проставить подсказки внутри root (по умолчанию — вся страница).
 * Идемпотентно: повторный вызов ничего не портит.
 */
export function applyHints(root = document) {
  for (const h of HINTS) {
    let nodes;
    try { nodes = root.querySelectorAll(h.sel); } catch (_) { continue; }
    for (const el of nodes) {
      if (el.dataset.hintDone === '1') continue;
      /* Живой title сильнее: он рассказывает текущее состояние («Тема: тёмная»),
         а реестр — устройство. Второе идёт следом, через тире. */
      const own = el.getAttribute('title') || el.dataset.tip || '';
      const article = h.kb ? articleById(h.kb) : null;
      const tail = article ? ` Подробнее — «${article.title}» в обучении.` : '';
      el.dataset.tip = own && own !== h.tip ? `${own} — ${h.tip}${tail}` : h.tip + tail;
      el.removeAttribute('title');
      if (h.at) el.dataset.tipAt = h.at;
      if (h.kb) el.dataset.tipKb = h.kb;
      /* Иконка без текста остаётся без имени для читалки — подсказка им и станет.
         Длинную подсказку читалке не зачитывают целиком: берём первую фразу. */
      if (!el.getAttribute('aria-label') && !el.textContent.trim())
        el.setAttribute('aria-label', h.tip.split('.')[0]);
      el.dataset.hintDone = '1';
    }
  }
}

/* ---------- первый заход ---------- */

const KEY = 'krug.hintsSeen';

function seen() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY)) || []); }
  catch (_) { return new Set(); }
}

function remember(id) {
  const s = seen();
  s.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-60))); } catch (_) {}
}

/** Показывали ли уже подсказку первого захода с таким id. */
export const hintSeen = id => seen().has(id);

/**
 * Разметка карточки «первый заход». Пустая строка, если её уже закрывали:
 * подсказка, которую нельзя убрать навсегда, через неделю читается как реклама.
 */
export function firstHintHTML(id, title, text) {
  if (hintSeen(id)) return '';
  return `<div class="hint-first" data-hint-first="${id}">
    <div class="hint-first-main"><b>${title}</b><p>${text}</p></div>
    <button class="btn small" data-hint-ok="${id}">Понятно</button>
  </div>`;
}

/** Повесить закрытие на карточки внутри root. */
export function mountFirstHints(root = document) {
  root.querySelectorAll('[data-hint-ok]').forEach(b => {
    b.onclick = () => {
      remember(b.dataset.hintOk);
      const card = root.querySelector(`[data-hint-first="${b.dataset.hintOk}"]`);
      if (card) card.remove();
    };
  });
}

/** Забыть все закрытые подсказки: «показать подсказки заново» в настройках. */
export function resetHints() {
  try { localStorage.removeItem(KEY); } catch (_) {}
}
