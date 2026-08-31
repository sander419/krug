// file: js/ui/tips.js
// Подсказки у кнопок — свои, а не браузерные.
//
// В КРУГе больше полутора сотен элементов с title. Браузерная подсказка
// появляется через секунду, выглядит как системное окошко мимо темы, не
// переносится по словам и на телефоне не показывается вовсе. Для инструмента,
// где половина кнопок — иконки без подписи, это и есть «непонятно, что нажимать».
//
// Позиционирует Floating UI (vendor/floating-ui, MIT): она сама переворачивает
// подсказку, когда та не влезает вниз, и подвигает, когда упирается в край.
// Своей арифметики здесь нет — её и не должно быть: попасть в край экрана
// можно двадцатью способами, и каждый ловится отдельно.
//
// title при этом не выбрасывается, а переезжает в data-tip: если элемент
// остался без доступного имени, из подсказки делается aria-label — читалка
// экрана не должна пострадать от красоты.
import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom';

const DELAY = 380;             // мс: подсказка не должна выскакивать на пролёте мыши
const KEEP = 60;               // мс: перескок между соседними кнопками не мигает

let box = null, stop = null, timer = null, current = null, shown = false;

function ensureBox() {
  if (box) return box;
  box = document.createElement('div');
  box.className = 'tip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.appendChild(box);
  return box;
}

/* Подсказка живёт в data-tip. Переносим её из title один раз при первой
   встрече: пока title на месте, браузер покажет своё окошко поверх нашего. */
function tipOf(el) {
  // title сильнее уже сохранённого: тема, окружение и задача меняют его на ходу,
  // и подсказка, снятая один раз при первой встрече, врала бы до перезагрузки
  const t = el.getAttribute('title');
  if (!t) return el.dataset.tip || '';
  el.dataset.tip = t;
  el.removeAttribute('title');
  // у иконки без текста title был единственным именем — сохраняем его для читалки
  if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
  return t;
}

function targetOf(node) {
  if (!(node instanceof Element)) return null;
  const el = node.closest('[title],[data-tip]');
  return el && tipOf(el) ? el : null;
}

async function place(el) {
  const b = ensureBox();
  const {x, y} = await computePosition(el, b, {
    placement: el.dataset.tipAt || 'top',
    middleware: [offset(8), flip({padding: 8}), shift({padding: 8})],
  });
  b.style.left = x + 'px';
  b.style.top = y + 'px';
}

function show(el) {
  const b = ensureBox();
  b.textContent = tipOf(el);
  b.hidden = false;
  b.classList.add('on');
  shown = true;
  if (stop) stop();
  stop = autoUpdate(el, b, () => place(el));
}

export function hideTip() {
  clearTimeout(timer);
  current = null;
  if (stop) { stop(); stop = null; }
  if (box) { box.classList.remove('on'); box.hidden = true; }
  shown = false;
}

function over(el) {
  if (el === current) return;
  current = el;
  clearTimeout(timer);
  // уже показанная подсказка перескакивает почти мгновенно: пауза нужна только
  // на первую, чтобы она не выпрыгивала на каждом пролёте курсора
  timer = setTimeout(() => { if (current === el) show(el); }, shown ? KEEP : DELAY);
}

export function initTips() {
  ensureBox();
  addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;      // на касании подсказка перекрывает то, что нажали
    const el = targetOf(e.target);
    el ? over(el) : hideTip();
  }, {passive: true});
  addEventListener('pointerdown', hideTip, {passive: true});
  addEventListener('focusin', e => {
    const el = targetOf(e.target);
    /* Только настоящий приход с клавиатуры: фокус, поставленный кодом
       (открылся экран — фокус на кнопку закрытия), не должен выбрасывать
       подсказку, которую никто не просил. */
    let byKey = true;
    try { byKey = e.target.matches(':focus-visible'); } catch (_) {}
    if (el && byKey) { current = el; show(el); }
  });
  addEventListener('focusout', hideTip);
  addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
  addEventListener('scroll', hideTip, {passive: true, capture: true});
  addEventListener('blur', hideTip);
}
