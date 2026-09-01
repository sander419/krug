// file: js/ui/materials.js
// Экран «Материалы»: все реестры в одном месте и свои замеры поверх паспорта.
//
// Массы жили во вкладке «Масса», глазури — в «Глазури», гипсы — в «Отливке»
// и «Оснастке». Чтобы посмотреть, что вообще есть в инструменте и почём это,
// человек обходил три вкладки, а четвёртого списка (гипсы) не находил вовсе.
//
// Новых данных экран не заводит: те же реестры, тот же контракт
// «est / unknown / na». Единственное добавление — **свои замеры**: паспорт
// поставщика неприкосновенен, замеры мастерской лежат рядом и подписаны.
import { MATERIALS, byId as materialById, density } from '../config/materials.js';
import { GLAZES, byGlazeId } from '../config/glazes.js';
import { PLASTERS } from '../config/plasters.js';
import { MEASURABLE, getNote, addMeasure, removeMeasure, setNoteText, measureSummary }
  from '../core/notes.js';
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { firstHintHTML } from './hints.js';
import { openScreen, refreshScreen } from './screen.js';
import { $, esc, num, signed } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';

let tab = 'mat';
let openId = null;

const KINDS = [
  {id: 'mat', name: 'Массы', list: () => MATERIALS,
   lead: 'Керамические массы с рынка РФ: усадка, водопоглощение, шамот, фасовка и цена.'},
  {id: 'glaze', name: 'Глазури', list: () => GLAZES,
   lead: 'Семейства глазурей: конус, температура, поведение и риски. У части — цена товара рынка.'},
  {id: 'plaster', name: 'Гипсы', list: () => PLASTERS,
   lead: 'Формовочный гипс: прочность, схватывание, водогипсовое отношение.'},
];

/* Паспортные строки для карточки: у каждого реестра свои. */
function specOf(kind, r) {
  if (kind === 'mat') return [
    ['Усадка', `${num(r.shrinkPct, 1)} %`],
    ['Обжиг', r.firing && r.firing.glazeC ? `${r.firing.glazeC.join('–')} °C` : '—'],
    ['Шамот', r.grogPct != null ? `${r.grogPct} %` : 'нет данных'],
    ['Плотность', `${num(density(r), 2)} г/см³`],
    ['Фасовка', r.pack || '—'],
    ['Цена', r.priceRub && r.packKg ? `${num(r.priceRub / r.packKg, 0)} ₽/кг` : 'не опубликована'],
  ];
  if (kind === 'glaze') return [
    ['Конус', r.cone.join('–')],
    ['Температура', `${r.tempC.join('–')} °C`],
    ['Семейство', r.family],
    ['Вид', r.form === 'powder' ? 'порошок' : r.form === 'suspension' ? 'суспензия' : 'не указан'],
    ['Фасовка', r.pack || 'не опубликована'],
    ['Цена', r.priceRub && r.packKg ? `${num(r.priceRub / r.packKg, 0)} ₽/кг` : 'не опубликована'],
  ];
  return [
    ['Марка', r.grade || '—'],
    ['Прочность', `${r.strengthMPa} МПа`],
    ['Схватывание', `${r.setMin.join('–')} мин`],
    ['Водогипсовое', r.waterRatio != null ? `${r.waterRatio} %` : 'не публикуется'],
    ['Фасовка', r.pack || '—'],
    ['Цена', r.priceRub && r.packKg ? `${num(r.priceRub / r.packKg, 0)} ₽/кг` : 'не опубликована'],
  ];
}

function measuresHTML(kind, r) {
  const fields = MEASURABLE[kind] || [];
  const note = getNote(kind, r.id);
  return `<div class="mt-measures">
    <h4>Мои замеры</h4>
    <p class="dim">Паспорт остаётся паспортом: ваши числа лежат рядом и подписаны как ваши.
      Среднее считается по всем замерам.</p>
    ${fields.map(f => {
      const s = measureSummary(kind, r.id, f.k, f.of(r));
      return `<div class="mt-field">
        <div class="mt-field-head">
          <b>${f.name}</b>
          <span class="dim">паспорт: ${s.passport == null ? 'нет' : num(s.passport, f.dec) + ' ' + f.unit}</span>
          ${s.avg != null ? `<span class="fact-tag">моё среднее ${num(s.avg, f.dec)} ${f.unit}${
            s.deltaPct != null ? ` · ${signed(s.deltaPct, 1)} %` : ''}</span>` : ''}
        </div>
        <div class="mt-values">
          ${s.list.map((v, i) => `<button class="mt-val" data-drop="${kind}|${r.id}|${f.k}|${i}"
            title="Убрать замер">${num(v, f.dec)}${icon('x', 12)}</button>`).join('')}
          <label class="mt-add"><input type="number" step="${f.step}" placeholder="+ замер"
            data-measure="${kind}|${r.id}|${f.k}" aria-label="Новый замер: ${f.name}"><i>${f.unit}</i></label>
        </div>
      </div>`;
    }).join('')}
    <label class="field-row wide"><span>Заметка</span>
      <input type="text" data-note="${kind}|${r.id}" value="${esc(note.note)}"
             placeholder="что заметили: поведение в печи, партия, поставщик"
             aria-label="Заметка о материале"></label>
  </div>`;
}

function cardHTML(kind, r) {
  const open = openId === `${kind}:${r.id}`;
  const note = getNote(kind, r.id);
  const mine = Object.keys(note.measures).length || note.note;
  const cur = kind === 'mat' ? state.mat === r.id : kind === 'glaze' ? state.glazeId === r.id
    : (state.plaster || {}).id === r.id;
  return `<article class="mt-card${open ? ' open' : ''}${cur ? ' current' : ''}">
    <button class="mt-head" data-card="${kind}:${r.id}">
      <span class="mt-name"><b>${esc(r.name)}</b>${cur ? '<i class="mt-cur">выбран</i>' : ''}
        ${mine ? '<i class="fact-tag">есть мои данные</i>' : ''}</span>
      <span class="mt-vendor">${esc(r.vendor || r.product || '')}</span>
      <span class="mt-chev">${icon(open ? 'chevron-up' : 'chevron-down', 15)}</span>
    </button>
    ${open ? `<div class="mt-body">
      <dl class="pp-list">${specOf(kind, r).map(([k, v]) =>
        `<div class="pp-row"><dt>${k}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>
      ${r.note ? `<p class="dim">${esc(r.note)}</p>` : ''}
      ${(r.src || []).length ? `<p class="screen-note">Источники: ${
        r.src.map(x => `<a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a>`).join(' · ')}</p>` : ''}
      ${measuresHTML(kind, r)}
      <div class="btn-row"><button class="btn small" data-use="${kind}:${r.id}">Выбрать для изделия</button></div>
    </div>` : ''}
  </article>`;
}

function bodyHTML() {
  const k = KINDS.find(x => x.id === tab);
  return `
    ${firstHintHTML('materials', 'Паспорт поставщика и ваши замеры',
      'Числа в карточках — из паспортов со ссылками на источник. Ваши собственные замеры ложатся рядом, подписанные как ваши, и показывают, насколько ваша мастерская отличается от того, что обещает поставщик.')}

    <div class="seg" role="group" aria-label="Реестр">
      ${KINDS.map(x => `<button data-kind="${x.id}"${x.id === tab ? ' class="active"' : ''}>
        ${x.name} <i class="dim">${x.list().length}</i></button>`).join('')}
    </div>
    <p class="screen-note">${k.lead} Числа — из паспортов поставщиков со ссылками;
      чего поставщик не публикует, помечено «не опубликована», а не выдумано.</p>
    <div class="mt-list">${k.list().map(r => cardHTML(k.id, r)).join('')}</div>`;
}

function mount(box) {
  const rerender = () => { refreshScreen(bodyHTML()); mount(box); };

  box.querySelectorAll('[data-kind]').forEach(b => {
    b.onclick = () => { tab = b.dataset.kind; openId = null; rerender(); };
  });
  box.querySelectorAll('[data-card]').forEach(b => {
    b.onclick = () => { openId = openId === b.dataset.card ? null : b.dataset.card; rerender(); };
  });
  box.querySelectorAll('[data-measure]').forEach(inp => {
    inp.onchange = () => {
      const [kind, id, field] = inp.dataset.measure.split('|');
      if (inp.value === '') return;
      addMeasure(kind, id, field, inp.value);
      rerender();
    };
  });
  box.querySelectorAll('[data-drop]').forEach(b => {
    b.onclick = () => {
      const [kind, id, field, i] = b.dataset.drop.split('|');
      removeMeasure(kind, id, field, +i);
      rerender();
    };
  });
  box.querySelectorAll('[data-note]').forEach(inp => {
    inp.onchange = () => {
      const [kind, id] = inp.dataset.note.split('|');
      setNoteText(kind, id, inp.value);
      toast('Заметка сохранена');
    };
  });
  box.querySelectorAll('[data-use]').forEach(b => {
    b.onclick = () => {
      const [kind, id] = b.dataset.use.split(':');
      if (kind === 'mat') state.mat = id;
      else if (kind === 'glaze') state.glazeId = id;
      else state.plaster = {...(state.plaster || {}), id};
      emit();
      rerender();
      toast('Выбрано для текущего изделия');
    };
  });
}

export function openMaterials(kind) {
  if (kind && KINDS.some(k => k.id === kind)) tab = kind;
  openScreen({
    id: 'materials', wide: true,
    title: 'Материалы',
    lead: 'Массы, глазури и гипсы: паспорта поставщиков и ваши собственные замеры.',
    html: bodyHTML(), redraw: bodyHTML,
    onMount: mount,
  });
}
