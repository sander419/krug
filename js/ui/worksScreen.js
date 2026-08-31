// file: js/ui/worksScreen.js
// «Мои изделия» — точка, с которой начинается работа.
//
// Раньше КРУГ открывался конструктором: человек видел ползунки и чертёж
// раньше, чем свои изделия. Для инженерного инструмента это нормально,
// для рабочего — нет: мастер приходит не «строить профиль», а «доделать
// ту вазу» или «начать новую».
//
// Экран показывает карточки: миниатюра, размеры, масса, масса глины,
// себестоимость и этап производства. Всё это считается тем же ядром,
// что и для открытой работы, — состояние подменяется на время расчёта
// (withDNA) и возвращается назад.
import { state, withDNA, encodeDNA } from '../core/state.js';
import { emit } from '../core/bus.js';
import { computeProduction, userProfileMM, computeWarnings, computeStrength } from '../core/math.js';
import { sanitizeCost, pieceCost } from '../core/cost.js';
import { byGlazeId } from '../config/glazes.js';
import { byId as materialById } from '../config/materials.js';
import { loadWorks, selectWorks, upsertWork, patchWork, removeWork, duplicateWork,
         blankWork, phaseById, PHASES } from '../core/works.js';
import { hasFact } from '../core/fact.js';
import { openScreen, refreshScreen, closeScreen } from './screen.js';
import { kilnNumbers } from './kiln.js';
import { openWorkRecord, saveCurrentAs } from './works.js';
import { $, esc, num, rub, plural } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';

let view = {q: '', fav: false, archived: false, sort: 'ts'};

/** Числа карточки. Считается тем же ядром, что и открытая работа. */
function cardNumbers() {
  const prod = computeProduction(state);
  const prof = userProfileMM(state);
  const opt = sanitizeCost(state.cost);
  const kiln = kilnNumbers();
  const per = pieceCost(state, prod, prof,
    {...opt, firePerPiece: kiln.perItem || 0, glaze: byGlazeId(state.glazeId)});
  const bad = computeWarnings(state, prod, computeStrength(state))
    .filter(w => w.lvl === 'bad').length;
  return {
    mm: `${Math.round(state.H)}×${Math.round(state.D)}`,
    mat: materialById(state.mat).name,
    massF: prod.massF, clayKg: prod.massN / 1000,
    cost: per.total, n: opt.n, bad,
  };
}

const when = ts => {
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `сегодня ${p(d.getHours())}:${p(d.getMinutes())}`
                 : `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

function cardHTML(w, n) {
  const ph = phaseById(w.phase);
  return `<article class="work-card${w.fav ? ' fav' : ''}">
    <button class="work-thumb" data-open="${w.id}" title="Открыть «${esc(w.name)}»">
      ${w.thumb ? `<img src="${w.thumb}" alt="" width="160" height="120">`
                : `<span class="work-noimg">${icon('circle-dot', 22)}</span>`}
    </button>
    <div class="work-main">
      <button class="work-name" data-open="${w.id}">${esc(w.name)}</button>
      <div class="work-meta">
        <span class="work-phase" data-phase="${w.phase}">${ph.name}</span>
        ${n ? `<span>${n.mm} мм · ${esc(n.mat)}</span>` : '<span class="dim">рецепт не читается</span>'}
        ${w.fact && hasFact(w.fact) ? '<span class="work-flag">есть факт</span>' : ''}
        ${n && n.bad ? `<span class="work-flag bad">${n.bad} ${plural(n.bad, 'замечание', 'замечания', 'замечаний')}</span>` : ''}
      </div>
      ${n ? `<dl class="work-nums">
        <div><dt>Масса</dt><dd>${n.massF >= 1000 ? num(n.massF / 1000, 2) + ' кг' : Math.round(n.massF) + ' г'}</dd></div>
        <div><dt>Глины</dt><dd>${num(n.clayKg, 2)} кг</dd></div>
        <div><dt>Себестоимость</dt><dd>${rub(n.cost)}</dd></div>
        <div><dt>Тираж</dt><dd>${n.n} шт</dd></div>
      </dl>` : ''}
      <div class="work-when">${when(w.ts)}</div>
    </div>
    <div class="work-acts">
      <button class="btn icon small" data-fav="${w.id}" aria-pressed="${w.fav}"
              title="${w.fav ? 'Убрать из избранного' : 'В избранное'}">${icon(w.fav ? 'star-on' : 'star', 15)}</button>
      <button class="btn icon small" data-copy="${w.id}" title="Дублировать">${icon('copy', 15)}</button>
      <button class="btn icon small" data-arch="${w.id}"
              title="${w.archived ? 'Вернуть из архива' : 'В архив'}">${icon(w.archived ? 'undo-2' : 'archive', 15)}</button>
      ${w.archived ? `<button class="btn icon small" data-del="${w.id}" title="Удалить навсегда">${icon('trash-2', 15)}</button>` : ''}
    </div>
  </article>`;
}

function bodyHTML() {
  const all = loadWorks();
  const list = selectWorks(all, view);
  const rows = list.map(w => {
    const n = withDNA(w.dna, () => cardNumbers());
    return cardHTML(w, n);
  }).join('');

  const empty = `<div class="screen-empty">
    <p>${view.archived ? 'В архиве пусто.'
        : view.q ? 'Ничего не нашлось. Попробуйте другое слово.'
        : view.fav ? 'В избранном пусто. Отметьте звёздочкой то, к чему возвращаетесь.'
        : 'Изделий пока нет. Создайте первое — или начните с готовой формы.'}</p>
    ${!view.archived && !view.q && !view.fav
      ? `<div class="btn-row"><button class="btn primary" id="wsNew">${icon('plus', 15)}Создать изделие</button></div>`
      : ''}</div>`;

  return `
    <div class="works-bar">
      <label class="works-search">${icon('search', 15)}
        <input type="search" id="wsQ" value="${esc(view.q)}" placeholder="Поиск по названию…"
               autocomplete="off" aria-label="Поиск по изделиям"></label>
      <div class="seg" role="group" aria-label="Что показывать">
        <button data-vw="all"${!view.fav && !view.archived ? ' class="active"' : ''}>Все</button>
        <button data-vw="fav"${view.fav ? ' class="active"' : ''}>Избранное</button>
        <button data-vw="arch"${view.archived ? ' class="active"' : ''}>Архив</button>
      </div>
      <label class="field-row works-sort"><span>Порядок</span>
        <select id="wsSort" aria-label="Порядок">
          <option value="ts"${view.sort === 'ts' ? ' selected' : ''}>по изменению</option>
          <option value="created"${view.sort === 'created' ? ' selected' : ''}>по созданию</option>
          <option value="name"${view.sort === 'name' ? ' selected' : ''}>по названию</option>
        </select></label>
      <button class="btn" id="wsMat">${icon('layers', 15)}Материалы</button>
      <button class="btn primary" id="wsNew2">${icon('plus', 15)}Создать</button>
    </div>
    <p class="screen-note">Изделий ${all.length}, показано ${list.length}. Всё лежит в этом
      браузере: у КРУГа нет сервера. Чтобы работа пережила смену устройства, скопируйте
      ссылку-ДНК на вкладке «Выпуск».</p>
    ${list.length ? `<div class="work-grid">${rows}</div>` : empty}`;
}

function mount(box) {
  const rerender = () => refreshScreen(bodyHTML());

  const q = $('wsQ');
  if (q) q.oninput = () => {
    view.q = q.value;
    const at = q.selectionStart;
    rerender();
    const f = $('wsQ');
    if (f) { f.focus(); f.setSelectionRange(at, at); }
  };
  const sort = $('wsSort');
  if (sort) sort.onchange = () => { view.sort = sort.value; rerender(); };
  box.querySelectorAll('[data-vw]').forEach(b => {
    b.onclick = () => {
      view.fav = b.dataset.vw === 'fav';
      view.archived = b.dataset.vw === 'arch';
      rerender();
    };
  });
  const mat = $('wsMat');
  if (mat) mat.onclick = async () => {
    const {openMaterials} = await import('./materials.js');
    openMaterials();
  };
  for (const id of ['wsNew', 'wsNew2']) {
    const b = $(id);
    if (b) b.onclick = () => newWork();
  }
  box.querySelectorAll('[data-open]').forEach(b => {
    b.onclick = () => { openWorkRecord(b.dataset.open); closeScreen(); };
  });
  box.querySelectorAll('[data-fav]').forEach(b => {
    b.onclick = () => {
      const w = loadWorks().find(x => x.id === b.dataset.fav);
      patchWork(b.dataset.fav, {fav: !(w && w.fav)});
      rerender();
    };
  });
  box.querySelectorAll('[data-copy]').forEach(b => {
    b.onclick = () => {
      const c = duplicateWork(b.dataset.copy);
      rerender();
      if (c) toast(`Копия: «${c.name}»`);
    };
  });
  box.querySelectorAll('[data-arch]').forEach(b => {
    b.onclick = () => {
      const w = loadWorks().find(x => x.id === b.dataset.arch);
      patchWork(b.dataset.arch, {archived: !(w && w.archived)});
      rerender();
    };
  });
  box.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = () => {
      /* Удаление насовсем — только из архива и только с подтверждением:
         отменить его нечем, ДНК уйдёт вместе с записью. */
      const w = loadWorks().find(x => x.id === b.dataset.del);
      if (!w || !confirm(`Удалить «${w.name}» навсегда? Отменить будет нечем.`)) return;
      removeWork(b.dataset.del);
      rerender();
      toast('Изделие удалено');
    };
  });
}

/** Новое изделие: текущий рецепт сохраняется под новым именем. */
function newWork() {
  const name = prompt('Название нового изделия', 'Новое изделие');
  if (name === null) return;
  const rec = saveCurrentAs(String(name).trim() || 'Новое изделие');
  refreshScreen(bodyHTML());
  mount($('screenHost'));
  toast(`Создано «${rec.name}» — рецепт можно менять на панели`);
}

export function openWorksScreen() {
  openScreen({
    id: 'works', wide: true,
    title: 'Мои изделия',
    lead: 'Всё, что вы делали: рецепт, числа и этап производства.',
    html: bodyHTML(),
    onMount: mount,
  });
}
