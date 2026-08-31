// file: js/ui/firings.js
// Экран «Обжиги»: что поставить в печь и во что это обойдётся.
//
// Садку считал блок во вкладке «Масса», но считал он одно изделие: сколько
// таких влезет и почём выйдет штука при полной садке. Мастерская ставит
// в печь разное — и вопрос у неё другой: «что из моих работ поедет вместе
// и сколько я заплачу за этот обжиг».
//
// Математика та же (js/core/kiln.js): полка отдаётся одному наименованию,
// полки складываются, пока хватает высоты и числа полок, а работы с разной
// температурой в одну садку не идут. Здесь только состав загрузки.
//
// Два числа держатся врозь и подписаны: цена **при полной садке** — та, по
// которой считается себестоимость, и цена **по факту плана** — та, которую
// мастерская заплатит за электричество.
import { state, withDNA } from '../core/state.js';
import { firedSize, kilnLoad, mixedFirings, firingBill, firingCost } from '../core/kiln.js';
import { userProfileMM } from '../core/math.js';
import { partMetrics } from '../core/parts.js';
import { sanitizeLid, lidProfile } from '../core/lid.js';
import { sanitizeCost } from '../core/cost.js';
import { byId as materialById } from '../config/materials.js';
import { loadWorks } from '../core/works.js';
import { kilnCurrent } from './kiln.js';
import { openScreen, refreshScreen } from './screen.js';
import { $, esc, num, rub, plural } from './dom.js';
import { icon } from './icons.js';

/* Что кладём в печь: отмеченные работы. Отметки живут только на экране —
   это план на сегодня, а не свойство изделия. */
const picked = new Set();

/** Габарит после обжига, температура и тираж одной работы. */
function itemOf() {
  const prof = userProfileMM(state);
  const parts = (state.parts || []).map(p => partMetrics(prof, p));
  const lid = sanitizeLid(state.lid);
  const lidPts = lid.on ? lidProfile(prof, lid, state.wall).pts : null;
  const mat = materialById(state.mat);
  const f = mat.firing || {};
  const size = firedSize(prof, parts, mat.shrinkPct, lidPts);
  return {
    d: size.d, h: size.h,
    n: sanitizeCost(state.cost).n,
    topC: (f.glazeC && f.glazeC[1]) || (f.bisqueC && f.bisqueC[1]) || 1050,
    mat: mat.name,
  };
}

function bodyHTML() {
  const kiln = kilnCurrent();
  const works = loadWorks().filter(w => !w.archived);
  const rows = works.map(w => ({w, it: withDNA(w.dna, () => itemOf())})).filter(x => x.it);
  const inLoad = rows.filter(x => picked.has(x.w.id));
  const items = inLoad.map(x => x.it);
  const bill = items.length ? firingBill(kiln, items,
    {priceKWh: (state.kiln || {}).kwh || 6, glaze: state.firing === 'glaze'}) : null;
  const one = firingCost(kiln, {topC: 1050, glaze: false, priceKWh: (state.kiln || {}).kwh || 6});

  const list = rows.map(({w, it}) => {
    const load = kilnLoad(kiln, it);
    const on = picked.has(w.id);
    const fits = load.perShelf && load.tiers;
    return `<label class="fr-row${on ? ' on' : ''}${fits ? '' : ' bad'}">
      <input type="checkbox" data-pick="${w.id}" ${on ? 'checked' : ''} ${fits ? '' : 'disabled'}>
      <span class="fr-main">
        <b>${esc(w.name)}</b>
        <span class="dim">${Math.round(it.d)}×${Math.round(it.h)} мм после обжига ·
          ${esc(it.mat)} · ${it.topC} °C · ${it.n} шт</span>
      </span>
      <span class="fr-fit">${fits
        ? `${load.perShelf} на полке × ${load.tiers} ${plural(load.tiers, 'ярус', 'яруса', 'ярусов')}`
        : `<span class="bad">${esc(load.why || 'не входит')}</span>`}</span>
    </label>`;
  }).join('');

  const plan = bill && bill.firings ? `
    <dl class="pp-list fr-plan">
      <div class="pp-row"><dt>Загрузок</dt><dd><b>${bill.firings}</b>
        ${bill.groups.length > 1
          ? `<span class="dim">в ${bill.groups.length} температуры (${bill.groups.map(g => g.topC + ' °C').join(', ')}) — вместе их обжигать нельзя</span>`
          : `<span class="dim">${bill.apart > bill.firings
              ? `общей садкой вместо ${bill.apart} порознь` : 'плотнее не собрать'}</span>`}</dd></div>
      <div class="pp-row"><dt>Изделий</dt><dd>${bill.pieces} шт</dd></div>
      <div class="pp-row"><dt>Энергия</dt><dd>${num(bill.kWh, 0)} кВт·ч</dd></div>
      <div class="pp-row"><dt>По факту плана</dt><dd><b>${rub(bill.rub)}</b>
        <span class="dim">${rub(bill.perPiece)} на изделие — столько вы заплатите за электричество</span></dd></div>
      <div class="pp-row"><dt>При полной садке</dt><dd>${rub(one.rub)} за загрузку
        <span class="dim">по этой цене считается себестоимость: печь набита одним изделием</span></dd></div>
    </dl>`
    : `<p class="dim">Отметьте работы — и здесь появится план загрузки: сколько обжигов,
       сколько киловатт-часов и во что это обойдётся.</p>`;

  return `
    <section class="pp-sect">
      <h3>Печь</h3>
      <dl class="pp-list">
        <div class="pp-row"><dt>Камера</dt><dd><b>${esc(kiln.name)}</b>
          <span class="dim">${kiln.innerMM.join('×')} мм · ${kiln.powerKW} кВт · полок ${kiln.shelves}</span></dd></div>
        <div class="pp-row"><dt>Киловатт-час</dt><dd>${num((state.kiln || {}).kwh || 6, 2)} ₽
          <span class="dim">меняется во вкладке «Масса» → «Печь и садка»</span></dd></div>
      </dl>
    </section>

    <section class="pp-sect pp-wide">
      <h3>Что ставим в этот обжиг</h3>
      ${rows.length ? `<div class="fr-list">${list}</div>`
        : '<p class="dim">Сохранённых изделий пока нет: план садки собирать не из чего.</p>'}
    </section>

    <section class="pp-sect pp-wide">
      <h3>План загрузки</h3>
      ${plan}
      <p class="screen-note">Полка отдаётся одному наименованию: столько его влезает по площади,
        столько на полке и стоит. Модель не мешает два наименования на одной полке, даже если
        они влезли бы, — обещать садку плотнее той, что человек соберёт руками, нечестно.</p>
    </section>`;
}

function mount(box) {
  box.querySelectorAll('[data-pick]').forEach(inp => {
    inp.onchange = () => {
      if (inp.checked) picked.add(inp.dataset.pick); else picked.delete(inp.dataset.pick);
      refreshScreen(bodyHTML());
      mount(box);
    };
  });
}

export function openFirings() {
  openScreen({
    id: 'firings', wide: true,
    title: 'Обжиги',
    lead: 'Что поедет в печь вместе, сколько это загрузок и во что обойдётся.',
    html: bodyHTML(),
    onMount: mount,
  });
}
