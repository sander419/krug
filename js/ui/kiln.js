// file: js/ui/kiln.js
// Печь и садка: сколько изделий войдёт в обжиг и что стоит один обжиг.
//
// Это единственное место, где цена берётся не из прайса, а из геометрии: печь
// берёт киловатты за цикл, поэтому цена обжига на изделие зависит от того,
// сколько их влезло на полку. Схема садки нарисована не для красоты — по ней
// видно, что мешает: широкая ручка, высокая шейка или лишний зазор.
//
// Считает js/core/kiln.js, реестр печей — js/config/kilns.js. Здесь только показ.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { KILNS, byKilnId } from '../config/kilns.js';
import { kilnEconomy, firedSize } from '../core/kiln.js';
import { sanitizeLid, lidProfile } from '../core/lid.js';
import { tune } from '../core/tuning.js';
import { userProfileMM } from '../core/math.js';
import { partMetrics } from '../core/parts.js';
import { byId } from '../config/materials.js';
import { $, esc, num, plural } from './dom.js';

/* Печь, по которой считаем: из реестра или своя. */
function kilnNow() {
  const k = state.kiln || {};
  if (k.id === 'own') return {...k.own, id: 'own', name: 'своя печь'};
  return byKilnId(k.id);
}

/* Габарит обожжённого изделия: корпус, прилепы и усадка массы. */
function itemNow() {
  const prof = userProfileMM(state);
  const parts = (state.parts || []).map(p => partMetrics(prof, p));
  const lid = sanitizeLid(state.lid);
  const lidPts = lid.on ? lidProfile(prof, lid, state.wall).pts : null;
  return firedSize(prof, parts, byId(state.mat).shrinkPct, lidPts);
}

function shelfSVG(load, itemD) {
  const s = load.shelf, r = load.step / 2, ri = itemD / 2;
  const W = s.form === 'round' ? s.w : Math.max(s.w, s.h);
  const pad = 6, k = (200 - pad * 2) / W;
  const cx = 100, cy = 100;
  const body = s.form === 'round'
    ? `<circle cx="${cx}" cy="${cy}" r="${(s.w / 2) * k}" class="kiln-shelf"/>`
    : `<rect x="${cx - s.w / 2 * k}" y="${cy - s.h / 2 * k}" width="${s.w * k}" height="${s.h * k}"
             rx="3" class="kiln-shelf"/>`;
  /* Два круга на изделие: само изделие и его пятно с зазором. Иначе не видно,
     что мешает поставить ещё один — сама вещь или требуемый просвет. */
  const items = load.pts.map(p => {
    const x = (cx + p.x * k).toFixed(1), y = (cy + p.y * k).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="${(r * k).toFixed(1)}" class="kiln-gap"/>
            <circle cx="${x}" cy="${y}" r="${(ri * k).toFixed(1)}" class="kiln-item"/>`;
  }).join('');
  return `<svg class="kiln-map" viewBox="0 0 200 200" role="img"
    aria-label="Схема полки: ${load.perShelf} ${plural(load.perShelf, 'изделие', 'изделия', 'изделий')}">
    ${body}${items}</svg>`;
}

export function syncKiln() {
  const box = $('kilnBody');
  if (!box) return;
  const k = kilnNow(), own = (state.kiln || {}).id === 'own';
  const item = itemNow();
  const mat = byId(state.mat);
  // верх цикла берём из паспорта массы: политой обжиг идёт по её температуре
  const fire = mat.firing || {};
  const topC = (fire.glazeC && fire.glazeC[1]) || (fire.bisqueC && fire.bisqueC[1]) || 1050;
  const eco = kilnEconomy(k, item, {
    topC,
    glaze: state.firing === 'glaze',
    priceKWh: (state.kiln || {}).kwh || 6,
  });
  const tooHot = topC > k.maxC;
  const L = eco.load;

  const opts = KILNS.map(x =>
    `<option value="${x.id}"${x.id === k.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')
    + `<option value="own"${own ? ' selected' : ''}>Своя печь — ввести размеры</option>`;

  const ownFields = own ? `
    <div class="seg" id="kilnForm" role="group" aria-label="Форма камеры">
      <button data-kform="round"${k.form === 'round' ? ' class="active"' : ''}>Круглая</button>
      <button data-kform="box"${k.form !== 'round' ? ' class="active"' : ''}>Камерная</button>
    </div>
    <label class="field-row"><span>${k.form === 'round' ? 'Диаметр камеры' : 'Ширина камеры'}</span>
      <input type="number" data-kf="a" min="100" max="2000" step="10" value="${k.innerMM[0]}"><i class="unit">мм</i></label>
    ${k.form === 'round' ? '' : `
    <label class="field-row"><span>Глубина камеры</span>
      <input type="number" data-kf="b" min="100" max="2000" step="10" value="${k.innerMM[1]}"><i class="unit">мм</i></label>`}
    <label class="field-row"><span>Высота камеры</span>
      <input type="number" data-kf="h" min="100" max="2000" step="10" value="${k.form === 'round' ? k.innerMM[1] : k.innerMM[2]}"><i class="unit">мм</i></label>
    <label class="field-row"><span>Мощность</span>
      <input type="number" data-kf="p" min="0.5" max="99" step="0.5" value="${k.powerKW}"><i class="unit">кВт</i></label>` : '';

  const load = L.total
    ? `<b>${L.total} ${plural(L.total, 'изделие', 'изделия', 'изделий')}</b> за обжиг:
       ${L.perShelf} на полке × ${L.tiers} ${plural(L.tiers, 'ярус', 'яруса', 'ярусов')}`
    : `<b class="bad">Не входит</b>: ${L.why}. Изделие ⌀${Math.round(item.d)}×${Math.round(item.h)} мм после обжига.`;

  const money = L.total
    ? `<p class="tool-note">${eco.cost.runs === 2 ? 'Два обжига' : 'Один обжиг'}
        (${eco.cost.names.join(' и ')}) · ${num(eco.cost.hours, 1)} ч под нагрузкой ·
        <b>${num(eco.cost.kWh, 1)} кВт·ч</b> · ${num(eco.cost.rub, 0)} ₽ за садку ·
        <b>${num(eco.perItem, 1)} ₽ на изделие</b></p>`
    : '';

  box.innerHTML = `
    <label class="field-row"><span>Печь</span>
      <select id="kilnSel">${opts}</select></label>
    ${ownFields}
    <label class="field-row"><span>Цена киловатт-часа</span>
      <input type="number" id="kilnPrice" min="0" max="100" step="0.5"
             value="${(state.kiln || {}).kwh || 6}"><i class="unit">₽</i></label>
    <div class="kiln-out">
      ${shelfSVG(L, item.d)}
      <div class="kiln-nums">
        <p class="tool-note">${load}</p>
        ${money}
        <p class="hint">Изделие после обжига ⌀${Math.round(item.d)}×${Math.round(item.h)} мм,
          с зазорами по ${tune('gapItem')} мм между соседями и ${tune('gapWall')} мм до стенки
          <span class="dim">(меняются в настройках расчёта)</span>.</p>
      </div>
    </div>
    ${tooHot ? `<p class="tool-note bad">Масса просит ${topC} °C, печь держит ${k.maxC} °C —
      этой массы в этой печи не обжечь.</p>` : ''}
    <p class="note">Размеры печей в списке — типовые для класса, а не паспортные: возьмите
      свои из паспорта. Доля времени под полной мощностью принята за 0,5 — печь греет
      ступенями, точную цифру даёт счётчик. Остывание не считается: оно бесплатно.</p>`;

  bind();
}

function setOwn(patch) {
  const k = state.kiln || (state.kiln = {id: 'studio-60', kwh: 6});
  const base = k.own || {form: 'box', innerMM: [500, 500, 600], powerKW: 9,
                         shelves: 4, shelfMM: 20, maxC: 1300, volumeL: 150};
  k.own = {...base, ...patch};
  emit();
}

function bind() {
  const sel = $('kilnSel');
  if (sel) sel.onchange = () => {
    state.kiln = {...(state.kiln || {}), id: sel.value};
    if (sel.value === 'own' && !state.kiln.own) setOwn({});
    else emit();
  };
  const price = $('kilnPrice');
  if (price) price.oninput = () => {
    state.kiln = {...(state.kiln || {}), kwh: Math.max(0, +price.value || 0)};
    emit();
  };
  document.querySelectorAll('#kilnForm [data-kform]').forEach(b => {
    b.onclick = () => {
      const k = kilnNow();
      const [a, b2, c] = k.innerMM;
      setOwn(b.dataset.kform === 'round'
        ? {form: 'round', innerMM: [a, k.form === 'round' ? b2 : c]}
        : {form: 'box', innerMM: [a, a, k.form === 'round' ? b2 : c]});
    };
  });
  document.querySelectorAll('#kilnBody [data-kf]').forEach(inp => {
    inp.onchange = () => {
      const k = kilnNow(), v = Math.max(50, +inp.value || 0);
      const dims = k.innerMM.slice();
      const f = inp.dataset.kf;
      if (f === 'a') dims[0] = v;
      else if (f === 'b') dims[1] = v;
      else if (f === 'h') dims[k.form === 'round' ? 1 : 2] = v;
      if (f === 'p') setOwn({powerKW: Math.max(0.5, +inp.value || 0.5)});
      else setOwn({innerMM: dims});
    };
  });
}

/** Печь, по которой считаем сейчас: из реестра или своя. */
export const kilnCurrent = () => kilnNow();

/** Габарит текущего изделия после обжига: {d, h}. */
export const kilnItem = () => itemNow();

/** Садка и цена обжига текущего изделия: {load, cost, perItem}. */
export function kilnNumbers() {
  const k = kilnNow(), mat = byId(state.mat), fire = mat.firing || {};
  const topC = (fire.glazeC && fire.glazeC[1]) || (fire.bisqueC && fire.bisqueC[1]) || 1050;
  return kilnEconomy(k, itemNow(), {
    topC, glaze: state.firing === 'glaze', priceKWh: (state.kiln || {}).kwh || 6,
  });
}

/** Цена обжига одного изделия — для себестоимости. null, если не влезает. */
export function kilnPerItem() { return kilnNumbers().perItem; }

export function initKiln() { syncKiln(); }
