// file: js/ui/editorScreen.js
// «Редактор изделия» — отдельная мастерская для формы.
//
// Правка формы была рассыпана по вкладке: чертёж в узкой колонке, размеры
// в одном блоке, стенка в другом, прилепы в третьем, крышка в четвёртом.
// Чтобы поправить ручку, человек тянул точку на чертеже шириной в ладонь,
// потом искал ползунок вылета двумя блоками ниже. Здесь всё это собрано
// в одном месте и в том порядке, в каком думают: **что правим → чем правим →
// сохранить как заготовку**.
//
// Три решения, на которых держится экран:
//
//   • **Части изделия — первый вопрос.** Слева список: корпус, крышка, каждый
//     прилеп. Выбрали — чертёж и свойства показывают именно её. Раньше
//     «что сейчас правит чертёж» приходилось выводить из того, какая деталь
//     выделена в третьем блоке.
//   • **Ничего не дублируется.** Чертёж, поля прилепов и крышки — те самые
//     узлы разметки, что живут в панели: на время они переезжают в экран
//     и возвращаются назад. Копия этих панелей разошлась бы с оригиналом
//     в первую же правку.
//   • **Экран не закрывает модель.** Он прижат влево, справа остаётся живой
//     3D-вид: форму правят, глядя на вещь, а не на схему вещи.
import { state } from '../core/state.js';
import { sceneAPI } from '../three/scene.js';
import { emit } from '../core/bus.js';
import { openScreen, refreshScreen, closeScreen } from './screen.js';
import { selectedPart, selectPart, addPart, removePart, putPart } from './parts.js';
import { PART_KINDS, kindOf } from '../config/parts.js';
import { sanitizeLid } from '../core/lid.js';
import { userProfileMM, computeProduction } from '../core/math.js';
import { patternById, patternOn, sanitizePattern } from '../core/pattern.js';
import { presetsOf, addPreset, removePreset, bodySnapshot, applyBody,
         lidSnapshot, partSnapshot, presetKindName } from '../core/presets.js';
import { firstHintHTML } from './hints.js';
import { setDraftScale, draftScale } from './editor.js';
import { $, esc, num } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';

/* Что правим сейчас: 'body' | 'lid' | id прилепа. */
let target = 'body';
/* Куда вернуть одолженные узлы разметки, когда экран закроется. */
const borrowed = [];

function borrow(id, slot) {
  const el = $(id), box = $(slot);
  if (!el || !box) return;
  borrowed.push({el, parent: el.parentNode, next: el.nextSibling});
  box.appendChild(el);
}

function giveBack() {
  for (const b of borrowed.reverse())
    b.parent && b.parent.insertBefore(b.el, b.next || null);
  borrowed.length = 0;
}

/* Пока редактор открыт, панель и узкий чертёж прячутся: их содержимое здесь,
   а место отдаётся модели. Сцена об этом узнаёт сама — по изменению размера
   контейнера, — но кадр надо перестроить, иначе вид останется прежним. */
let scaleBefore = null;

function layout(on) {
  document.body.classList.toggle('editing', !!on);
  /* В широком поле редактора чертёж 1:1 с моделью показывает профиль кусками:
     на время правки он вписывается целиком, а на выходе возвращается как был. */
  if (on) { scaleBefore = draftScale(); setDraftScale('fit'); }
  else if (scaleBefore) { setDraftScale(scaleBefore); scaleBefore = null; }
  /* Сцене нужен не следующий кадр, а следующая раскладка: пока браузер
     не пересчитал грид, контейнер ещё нулевой ширины, и resize() запишет
     в рендерер ноль. Поэтому два захода — сразу и чуть погодя. */
  const fit = () => { sceneAPI.resize(); sceneAPI.frameView(); };
  requestAnimationFrame(() => requestAnimationFrame(fit));
  setTimeout(fit, 120);
}

/* ---------- список частей ---------- */

function partsHTML() {
  const parts = state.parts || [];
  const lid = sanitizeLid(state.lid);
  const sel = selectedPart();
  const row = (id, name, note, on) => `
    <button class="ed-part${on ? ' current' : ''}" data-target="${id}" aria-pressed="${on}">
      <b>${esc(name)}</b><span>${esc(note)}</span></button>`;

  const prof = userProfileMM(state);
  const prod = computeProduction(state);
  const pat = sanitizePattern(state.pattern);

  return `
    <div class="ed-part-list">
      ${row('body', 'Корпус',
        `${Math.round(state.H)}×${Math.round(state.D)} мм · стенка ${num(state.wall, 1)} мм` +
        (patternOn(pat) ? ` · ${patternById(pat.id).name.toLowerCase()}` : ''),
        target === 'body')}
      ${lid.on
        ? row('lid', 'Крышка', `${lid.type === 'inset' ? 'в горловину' : 'внахлёст'} · зазор ${num(lid.gap, 1)} мм`,
              target === 'lid')
        : `<button class="ed-part add" data-add-lid="1">
             ${icon('plus', 14)}<b>Добавить крышку</b><span>отдельная деталь, обжигается вместе</span></button>`}
      ${parts.map((p, i) => row(p.id, `${kindOf(p).name} ${i + 1}`,
        `азимут ${Math.round(p.az || 0)}°${p.path ? ' · кривая нарисована' : ''}`,
        target === p.id || (sel && sel.id === p.id && target === 'part'))).join('')}
    </div>
    <div class="ed-add">
      ${Object.entries(PART_KINDS).map(([id, k]) =>
        `<button class="chip-btn" data-add-part="${id}" title="${esc(k.lead || k.name)}">
          ${icon('plus', 13)}${k.name}</button>`).join('')}
    </div>`;
}

/* ---------- свойства выбранной части ---------- */

function propsSlotHTML() {
  if (target === 'body') return '<div class="ed-slot" id="edBodySlot"></div>';
  if (target === 'lid') return '<div class="ed-slot" id="edLidSlot"></div>';
  return '<div class="ed-slot" id="edPartSlot"></div>';
}

function fillProps() {
  if (target === 'body') {
    borrow('sizeBlock', 'edBodySlot');
    borrow('wallsBlock', 'edBodySlot');
    borrow('patternBlock', 'edBodySlot');
  } else if (target === 'lid') {
    borrow('lidBody', 'edLidSlot');
  } else {
    borrow('partsBox', 'edPartSlot');
  }
}

/* ---------- пресеты ---------- */

const kindOfTarget = () => target === 'body' ? 'body' : target === 'lid' ? 'lid' : 'part';

function presetsHTML() {
  const kind = kindOfTarget();
  const list = presetsOf(kind);
  return `
    <div class="ed-presets">
      <div class="ed-presets-head">
        <b>Мои заготовки · ${presetKindName(kind)}</b>
        <button class="chip-btn" id="edSavePreset">${icon('save', 13)}Сохранить эту</button>
      </div>
      ${list.length ? `<div class="ed-preset-list">${list.map(p => `
        <span class="ed-preset">
          <button class="ed-preset-use" data-use="${p.id}"
                  title="Поставить заготовку на изделие">${esc(p.name)}</button>
          <button class="ed-preset-del" data-drop="${p.id}" title="Убрать заготовку">${icon('x', 12)}</button>
        </span>`).join('')}</div>`
        : `<p class="dim">Заготовок ${presetKindName(kind)} пока нет. Доведите деталь до толка
           и сохраните — она встанет на любое изделие одним нажатием.</p>`}
    </div>`;
}

/* ---------- экран ---------- */

function bodyHTML() {
  return `
    ${firstHintHTML('editor', 'Здесь правят форму',
      'Слева — части изделия: корпус, крышка, прилепы. Выберите часть, и чертёж с полями ' +
      'будут править именно её. Модель справа видна всё время: она меняется, пока вы тянете. ' +
      'Доведённую деталь сохраняйте как заготовку — она встанет на любое другое изделие.')}
    <div class="ed-grid">
      <aside class="ed-side">${partsHTML()}</aside>
      <div class="ed-main">
        <div class="ed-draft" id="edDraftSlot"></div>
        ${propsSlotHTML()}
      </div>
    </div>
    ${presetsHTML()}`;
}

function mount(box) {
  const rerender = () => {
    giveBack();
    refreshScreen(bodyHTML());
    mount($('screenHost'));
  };

  /* Одолженные узлы вставляются после перерисовки: сначала слоты, потом
     содержимое, иначе вставлять некуда. */
  borrow('draft', 'edDraftSlot');
  fillProps();

  box.querySelectorAll('[data-target]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.target;
      target = id;
      if (id !== 'body' && id !== 'lid') selectPart(id);
      rerender();
    };
  });
  box.querySelectorAll('[data-add-part]').forEach(b => {
    b.onclick = () => {
      const p = addPart(b.dataset.addPart);
      target = p.id;
      rerender();
      toast(`${kindOf(p).name} добавлен — правьте вылет и кривую`);
    };
  });
  const addLid = box.querySelector('[data-add-lid]');
  if (addLid) addLid.onclick = () => {
    state.lid = sanitizeLid({...state.lid, on: true});
    emit();
    target = 'lid';
    rerender();
  };

  const save = $('edSavePreset');
  if (save) save.onclick = () => {
    const kind = kindOfTarget();
    const def = kind === 'body' ? (state.name || 'Мой корпус')
      : kind === 'lid' ? 'Моя крышка'
      : `Мой ${kindOf(selectedPart() || {kind: 'handle'}).name.toLowerCase()}`;
    const name = prompt('Имя заготовки', def);
    if (name === null) return;
    const data = kind === 'body' ? bodySnapshot(state)
      : kind === 'lid' ? lidSnapshot(sanitizeLid(state.lid))
      : partSnapshot(selectedPart());
    if (!data) { toast('Нечего сохранять: деталь не выбрана'); return; }
    const rec = addPreset(kind, name, data);
    rerender();
    toast(`Заготовка «${rec.name}» сохранена`);
  };

  box.querySelectorAll('[data-use]').forEach(b => {
    b.onclick = () => {
      const kind = kindOfTarget();
      const rec = presetsOf(kind).find(p => p.id === b.dataset.use);
      if (!rec) return;
      if (kind === 'body') applyBody(state, rec.data);
      else if (kind === 'lid') state.lid = sanitizeLid({...rec.data, on: true});
      else { const p = putPart(rec.data); target = p.id; }
      emit();
      rerender();
      toast(`Поставлена заготовка «${rec.name}»`);
    };
  });
  box.querySelectorAll('[data-drop]').forEach(b => {
    b.onclick = () => { removePreset(b.dataset.drop); rerender(); };
  });
}

/** Открыть редактор. `what` — с какой части начать. */
export function openEditorScreen(what) {
  if (what) target = what;
  const parts = state.parts || [];
  if (target !== 'body' && target !== 'lid' && !parts.some(p => p.id === target))
    target = 'body';
  openScreen({
    id: 'editor', wide: true, side: true,
    title: 'Редактор изделия',
    lead: 'Части, чертёж и свойства в одном месте. Модель справа меняется, пока правите.',
    html: bodyHTML(), redraw: bodyHTML,
    onMount: mount,
    onClose: () => { giveBack(); layout(false); },
  });
  layout(true);
}
