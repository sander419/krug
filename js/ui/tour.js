// file: js/ui/tour.js
// Экскурсия по инструменту: подсветка живого элемента и объяснение рядом.
//
// Показывать интерфейс картинками бессмысленно — они устаревают в первый же
// день и не совпадают с тем, что у человека на экране (у него своя задача,
// своя тема, свой профиль). Поэтому экскурсия водит по **настоящему**
// интерфейсу: подсвечивает элемент там, где он есть сейчас, и говорит,
// зачем он.
//
// Шаг, элемента которого нет (задача спрятала вкладку), пропускается молча:
// обещать человеку кнопку, которой у него нет, хуже, чем промолчать.
//
// Позиционирует Floating UI — та же, что и подсказки: край экрана ловится
// двадцатью способами, и каждый разбирать вручную незачем.
import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom';
import { TOUR } from '../config/tour.js';
import { $ } from './dom.js';
import { icon } from './icons.js';

const KEY = 'krug.tour';

let box = null, hole = null, stopAuto = null, at = 0, steps = [], onEnd = null;

const el = sel => { try { return document.querySelector(sel); } catch (_) { return null; } };
const visible = node => !!(node && node.offsetParent !== null
  && node.getBoundingClientRect().width > 0);

/** Есть ли смысл показывать шаг: элемент на месте и виден. */
function stepReady(s) {
  const node = el(s.sel);
  return visible(node) ? node : null;
}

/* На телефоне половина шапки спрятана под кнопкой «ещё»: элемент в разметке
   есть, но не виден, и шаг молча пропадал — экскурсия из двенадцати остановок
   превращалась в шесть. Открываем меню сами. */
async function revealInHeader(sel) {
  const node = el(sel);
  if (!node || visible(node)) return;
  const more = el('#moreBtn');
  const menu = el('#headMenu');
  if (!more || !menu || menu.classList.contains('open')) return;
  more.click();
  await new Promise(r => setTimeout(r, 220));
}

function ensureDOM() {
  if (box) return;
  /* Затемнение — четыре шторки вокруг подсвеченного места, а не одна тень
     на пол-экрана: тень с огромным spread браузер местами не рисует вовсе,
     и человек остаётся без затемнения, не понимая, куда смотреть. Шторки —
     четыре обычных прямоугольника, они рисуются всегда. */
  hole = document.createElement('div');
  hole.className = 'tour-veil';
  hole.setAttribute('aria-hidden', 'true');
  hole.innerHTML = '<i data-veil="t"></i><i data-veil="b"></i>' +
                   '<i data-veil="l"></i><i data-veil="r"></i><u class="tour-ring"></u>';
  box = document.createElement('div');
  box.className = 'tour-card';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-live', 'polite');
  box.setAttribute('aria-label', 'Экскурсия по инструменту');
  document.body.append(hole, box);
}

/** Поставить шторки вокруг элемента и обвести его рамкой. */
function highlight(node) {
  const r = node.getBoundingClientRect();
  const pad = 6;
  const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
  const w = Math.min(innerWidth - x, r.width + pad * 2);
  const h = Math.min(innerHeight - y, r.height + pad * 2);
  const put = (sel, css) => Object.assign(hole.querySelector(sel).style, css);
  put('[data-veil="t"]', {left: '0px', top: '0px', width: '100%', height: y + 'px'});
  put('[data-veil="b"]', {left: '0px', top: (y + h) + 'px', width: '100%',
                          height: Math.max(0, innerHeight - y - h) + 'px'});
  put('[data-veil="l"]', {left: '0px', top: y + 'px', width: x + 'px', height: h + 'px'});
  put('[data-veil="r"]', {left: (x + w) + 'px', top: y + 'px',
                          width: Math.max(0, innerWidth - x - w) + 'px', height: h + 'px'});
  put('.tour-ring', {left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px'});
}

async function draw() {
  const s = steps[at];
  const node = stepReady(s);
  if (!node) return next();

  node.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  highlight(node);
  box.innerHTML = `
    <div class="tour-num">${at + 1} из ${steps.length}</div>
    <b>${s.title}</b>
    <p>${s.text}</p>
    <div class="tour-acts">
      <button class="btn small" data-tour="prev"${at ? '' : ' disabled'}>Назад</button>
      <button class="btn small primary" data-tour="next">${
        at === steps.length - 1 ? 'Готово' : 'Дальше'}</button>
      <button class="btn small" data-tour="stop">${icon('x', 14)}Закрыть</button>
    </div>`;
  box.querySelector('[data-tour="prev"]').onclick = prev;
  box.querySelector('[data-tour="next"]').onclick = next;
  box.querySelector('[data-tour="stop"]').onclick = stop;

  if (stopAuto) stopAuto();
  stopAuto = autoUpdate(node, box, async () => {
    highlight(node);
    /* На узком экране карточка шириной почти во весь экран: сбоку она не
       помещается никуда, и «слева от модели» превращается в «за краем». */
    const narrow = innerWidth < 760;
    const {x, y} = await computePosition(node, box, {
      placement: narrow ? 'bottom' : (s.at || 'bottom'),
      middleware: [offset(14),
        flip({padding: 12, fallbackPlacements: ['bottom', 'top']}),
        shift({padding: 12, crossAxis: true})],
    });
    box.style.left = x + 'px';
    box.style.top = y + 'px';
  });
  box.querySelector('[data-tour="next"]').focus({preventScroll: true});
}

/* Перед шагом иногда нужно что-то открыть: вкладку панели или целый экран.
   Экраны грузятся по требованию — экскурсию запускают не в первую секунду. */
async function prepare(s) {
  const go = s.go || {};
  if (go.close) {
    const {closeScreen, screenOpen} = await import('./screen.js');
    while (screenOpen()) closeScreen();
  }
  if (go.tab) {
    const t = document.querySelector(`.tab[data-tab="${go.tab}"]`);
    if (t && !t.hidden) t.click();
  }
  if (go.screen === 'works') (await import('./worksScreen.js')).openWorksScreen();
  if (go.screen === 'passport') (await import('./passport.js')).openPassport();
  if (go.screen === 'settings') (await import('./settings.js')).openSettings();
  await revealInHeader(s.sel);
  /* Экран рисуется синхронно, но браузеру нужен кадр, чтобы посчитать
     геометрию: без паузы подсветка встанет по старым координатам. */
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
}

async function go(i) {
  at = Math.max(0, Math.min(steps.length - 1, i));
  await prepare(steps[at]);
  draw();
}

function next() {
  if (at >= steps.length - 1) return stop(true);
  go(at + 1);
}
function prev() { if (at > 0) go(at - 1); }

function stop(done) {
  if (stopAuto) { stopAuto(); stopAuto = null; }
  if (box) box.remove();
  if (hole) hole.remove();
  box = hole = null;
  document.body.classList.remove('tour-on');
  removeEventListener('keydown', onKey, true);
  if (done) { try { localStorage.setItem(KEY, '1'); } catch (_) {} }
  if (onEnd) { const f = onEnd; onEnd = null; f(!!done); }
}

function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); stop(); }
  if (e.key === 'ArrowRight' || e.key === 'Enter') { e.stopPropagation(); next(); }
  if (e.key === 'ArrowLeft') { e.stopPropagation(); prev(); }
}

/** Запустить экскурсию. `after` вызовется по окончании. */
export function startTour(after) {
  stop();
  onEnd = after || null;
  steps = TOUR.slice();
  if (!steps.length) return;
  ensureDOM();
  document.body.classList.add('tour-on');
  addEventListener('keydown', onKey, true);
  go(0);
}
