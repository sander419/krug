// file: js/ui/layout.js
// Раскладка под себя: ширина колонок и порядок блоков в панели.
//
// У разных работ разный центр тяжести. Тому, кто рисует профиль, нужен широкий
// чертёж; тому, кто считает тираж, — широкая панель; тому, кто показывает форму
// заказчику, — весь экран под 3D. Раньше пропорции были прибиты в CSS, а порядок
// блоков — в разметке, и подстроить их было нечем.
//
// Всё, что человек настроил, лежит в localStorage одним объектом и снимается
// кнопкой «сбросить раскладку»: настройка, из которой нет выхода, хуже её отсутствия.
import { $ } from './dom.js';
import { icon } from './icons.js';

const KEY = 'krug.layout';
const PHONE = '(max-width:940px)';
const isPhone = () => matchMedia(PHONE).matches;

const MIN_PANEL = 260, MIN_DRAFT = 150, COLLAPSE = 110;
const root = document.documentElement;

let saved = {panelW: null, draftW: null, order: {}};
let defaultOrder = {};          // порядок блоков из разметки — для сброса

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) saved = Object.assign(saved, JSON.parse(raw));
  } catch (_) {}
}
function store() {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (_) {}
}

/* ---------- ширины колонок ---------- */
function applyWidths() {
  if (saved.panelW) root.style.setProperty('--panelW', saved.panelW + 'px');
  else root.style.removeProperty('--panelW');
  if (saved.draftW !== null && saved.draftW !== undefined) root.style.setProperty('--draftW', saved.draftW + 'px');
  else root.style.removeProperty('--draftW');
  document.body.classList.toggle('draft-off', saved.draftW === 0);
}

function colWidth(el) { return el ? el.getBoundingClientRect().width : 0; }

function initSplitter(id, target, key, min) {
  const sp = $(id);
  if (!sp) return;
  let startX = 0, startW = 0, dragging = false;

  const setW = w => {
    const maxW = innerWidth * 0.55;
    // чертёж можно увести в ноль: иногда нужен весь экран под модель
    const v = (key === 'draftW' && w < COLLAPSE) ? 0 : Math.min(Math.max(w, min), maxW);
    saved[key] = v;
    applyWidths();
  };

  sp.addEventListener('pointerdown', e => {
    if (isPhone()) return;
    dragging = true;
    startX = e.clientX;
    startW = colWidth($(target));
    sp.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  sp.addEventListener('pointermove', e => {
    if (!dragging) return;
    setW(startW + (e.clientX - startX));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing');
    store();
  };
  sp.addEventListener('pointerup', end);
  sp.addEventListener('pointercancel', end);
  sp.addEventListener('dblclick', () => { saved[key] = null; applyWidths(); store(); });
  sp.addEventListener('keydown', e => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') setW(colWidth($(target)) - step);
    else if (e.key === 'ArrowRight') setW(colWidth($(target)) + step);
    else if (e.key === 'Home') saved[key] = null, applyWidths();
    else return;
    e.preventDefault();
    store();
  });
}

/* ---------- порядок блоков ---------- */
const paneOf = block => block.closest('.tabpane');
const paneId = pane => pane && pane.dataset.pane;
const blocksOf = pane => [...pane.querySelectorAll(':scope > details.block')];

function saveOrder(pane) {
  saved.order[paneId(pane)] = blocksOf(pane).map(b => b.dataset.block);
  store();
}

function applyOrder() {
  document.querySelectorAll('.tabpane').forEach(pane => {
    const want = saved.order[paneId(pane)];
    if (!Array.isArray(want)) return;
    const byId = new Map(blocksOf(pane).map(b => [b.dataset.block, b]));
    for (const id of want) {
      const el = byId.get(id);
      if (el) pane.appendChild(el);      // неизвестные и новые блоки останутся в конце
    }
    for (const [id, el] of byId) if (!want.includes(id)) pane.appendChild(el);
  });
}

/* перенос блока на шаг вверх или вниз — работает и пальцем, и с клавиатуры,
   в отличие от перетаскивания */
function move(block, dir) {
  const pane = paneOf(block);
  const list = blocksOf(pane);
  const i = list.indexOf(block);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  if (dir < 0) pane.insertBefore(block, list[j]);
  else pane.insertBefore(list[j], block);
  saveOrder(pane);
  block.querySelector('.block-title').focus?.();
}

function addHandles() {
  document.querySelectorAll('details.block').forEach(block => {
    const title = block.querySelector('.block-title');
    if (!title || title.querySelector('.block-move')) return;
    const box = document.createElement('span');
    box.className = 'block-move';
    box.innerHTML =
      `<button type="button" data-move="-1" title="Выше" aria-label="Переместить блок выше">${icon('chevron-up', 13)}</button>` +
      `<button type="button" data-move="1" title="Ниже" aria-label="Переместить блок ниже">${icon('chevron-down', 13)}</button>`;
    box.querySelectorAll('button').forEach(b => {
      b.onclick = e => { e.preventDefault(); e.stopPropagation(); move(block, +b.dataset.move); };
    });
    title.appendChild(box);
  });
}

let dragged = null;
function initDrag() {
  document.querySelectorAll('details.block').forEach(block => {
    block.draggable = true;
    block.addEventListener('dragstart', e => {
      // тянем только за заголовок: иначе не выделить текст и не двинуть ползунок
      if (!e.target.closest('.block-title') || e.target.closest('.block-move,.help-dot')) {
        e.preventDefault();
        return;
      }
      dragged = block;
      block.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', block.dataset.block); } catch (_) {}
    });
    block.addEventListener('dragend', () => {
      block.classList.remove('dragging');
      document.querySelectorAll('.drop-before,.drop-after').forEach(x =>
        x.classList.remove('drop-before', 'drop-after'));
      if (dragged) saveOrder(paneOf(dragged));
      dragged = null;
    });
    block.addEventListener('dragover', e => {
      if (!dragged || dragged === block || paneOf(dragged) !== paneOf(block)) return;
      e.preventDefault();
      const r = block.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      block.classList.toggle('drop-after', after);
      block.classList.toggle('drop-before', !after);
    });
    block.addEventListener('dragleave', () => block.classList.remove('drop-before', 'drop-after'));
    block.addEventListener('drop', e => {
      if (!dragged || dragged === block) return;
      e.preventDefault();
      const r = block.getBoundingClientRect();
      const pane = paneOf(block);
      if (e.clientY > r.top + r.height / 2) block.after(dragged);
      else block.before(dragged);
      block.classList.remove('drop-before', 'drop-after');
      saveOrder(pane);
    });
  });
}

/** Вернуть ширины колонок и порядок блоков к тому, что задано в разметке. */
export function resetLayout() {
  saved = {panelW: null, draftW: null, order: {}};
  store();
  applyWidths();
  document.querySelectorAll('.tabpane').forEach(pane => {
    const want = defaultOrder[paneId(pane)];
    if (!want) return;
    const byId = new Map(blocksOf(pane).map(b => [b.dataset.block, b]));
    for (const id of want) { const el = byId.get(id); if (el) pane.appendChild(el); }
  });
}

export function initLayout() {
  document.querySelectorAll('.tabpane').forEach(pane => {
    defaultOrder[paneId(pane)] = blocksOf(pane).map(b => b.dataset.block);
  });
  load();
  applyWidths();
  applyOrder();
  addHandles();
  initDrag();
  initSplitter('splitPanel', 'panel', 'panelW', MIN_PANEL);
  initSplitter('splitDraft', 'draft', 'draftW', MIN_DRAFT);
  const r = $('resetLayoutBtn');
  if (r) r.onclick = resetLayout;
}
