// file: js/ui/compare.js
// Сравнение изделий: какую версию выгоднее производить.
//
// Мастер редко делает одну вещь: он делает вазу, потом ту же вазу на сантиметр
// ниже и с другой глазурью — и выбирает. Пока числа лежали в открытой работе,
// сравнить две версии можно было только по памяти: открыл одну, записал,
// открыл вторую.
//
// Здесь два столбца и разница между ними. Ничего нового не считается: каждая
// колонка — это те же функции ядра, посчитанные на чужой ДНК (withDNA).
import { state, withDNA } from '../core/state.js';
import { computeProduction, userProfileMM, computeWarnings, computeStrength } from '../core/math.js';
import { sanitizeCost, pieceCost, batchPlan } from '../core/cost.js';
import { byId as materialById } from '../config/materials.js';
import { byGlazeId } from '../config/glazes.js';
import { loadWorks } from '../core/works.js';
import { kilnNumbers } from './kiln.js';
import { currentWorkId } from './works.js';
import { openScreen, refreshScreen } from './screen.js';
import { $, esc, num, rub } from './dom.js';

let left = null, right = null;

/** Числа одной работы: тот же расчёт, что и на панели. */
function numbersOf() {
  const prod = computeProduction(state);
  const prof = userProfileMM(state);
  const mat = materialById(state.mat);
  const opt = sanitizeCost(state.cost);
  const kiln = kilnNumbers();
  const per = pieceCost(state, prod, prof,
    {...opt, firePerPiece: kiln.perItem || 0, glaze: byGlazeId(state.glazeId)});
  const plan = batchPlan(per, {n: opt.n, perFiring: kiln.load ? kiln.load.total : null});
  const k = 1 - mat.shrinkPct / 100;
  const bad = computeWarnings(state, prod, computeStrength(state)).filter(w => w.lvl === 'bad').length;
  return {
    H: state.H, D: state.D, firedH: state.H * k, firedD: state.D * k,
    capMl: prod.capMl, volMl: prod.volMl, clayG: prod.massN, massG: prod.massF,
    shrink: mat.shrinkPct, angle: prod.angle, sf: computeStrength(state).minSF,
    mat: mat.name, glaze: byGlazeId(state.glazeId).name,
    fire: kiln.perItem, cost: per.total, price: per.minPrice,
    margin: per.marginRub, workMin: opt.minPerPiece, n: opt.n,
    batchCost: plan.total, batchMargin: plan.margin, firings: plan.firings, bad,
  };
}

/* Строки сравнения. `better` говорит, в какую сторону лучше: по себестоимости
   меньше, по марже больше, а у размеров «лучше» не бывает — только разница. */
const ROWS = [
  {k: 'H', name: 'Высота на круге', unit: 'мм', dec: 0},
  {k: 'D', name: 'Диаметр на круге', unit: 'мм', dec: 0},
  {k: 'firedH', name: 'Высота после обжига', unit: 'мм', dec: 0},
  {k: 'firedD', name: 'Диаметр после обжига', unit: 'мм', dec: 0},
  {k: 'capMl', name: 'Вместимость', unit: 'мл', dec: 0},
  {k: 'clayG', name: 'Глины на изделие', unit: 'г', dec: 0, better: 'less'},
  {k: 'massG', name: 'Масса готового', unit: 'г', dec: 0},
  {k: 'shrink', name: 'Усадка', unit: '%', dec: 1},
  {k: 'angle', name: 'Устойчивость', unit: '°', dec: 0, better: 'more'},
  {k: 'sf', name: 'Запас стенки', unit: '×', dec: 1, better: 'more'},
  {k: 'fire', name: 'Обжиг штуки', unit: '₽', dec: 0, better: 'less', money: true},
  {k: 'workMin', name: 'Работы на изделие', unit: 'мин', dec: 0, better: 'less'},
  {k: 'cost', name: 'Себестоимость', unit: '₽', dec: 0, better: 'less', money: true, key: true},
  {k: 'price', name: 'Минимальная цена', unit: '₽', dec: 0, money: true},
  {k: 'margin', name: 'Маржа со штуки', unit: '₽', dec: 0, better: 'more', money: true, key: true},
  {k: 'n', name: 'Тираж', unit: 'шт', dec: 0},
  {k: 'firings', name: 'Обжигов на тираж', unit: '', dec: 0, better: 'less'},
  {k: 'batchCost', name: 'Себестоимость партии', unit: '₽', dec: 0, better: 'less', money: true},
  {k: 'batchMargin', name: 'Маржа с партии', unit: '₽', dec: 0, better: 'more', money: true, key: true},
];

function pickHTML(side, id, works) {
  return `<select data-side="${side}" aria-label="Изделие ${side === 'left' ? 'слева' : 'справа'}">
    <option value="">— выберите изделие —</option>
    ${works.map(w => `<option value="${w.id}"${w.id === id ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}
  </select>`;
}

function bodyHTML() {
  const works = loadWorks().filter(w => !w.archived);
  const a = works.find(w => w.id === left);
  const b = works.find(w => w.id === right);
  const na = a ? withDNA(a.dna, () => numbersOf()) : null;
  const nb = b ? withDNA(b.dna, () => numbersOf()) : null;

  const rows = (na && nb) ? ROWS.map(r => {
    const x = na[r.k], y = nb[r.k];
    const fmt = v => v == null ? '—' : (r.money ? rub(v) : num(v, r.dec) + (r.unit ? ' ' + r.unit : ''));
    let cls = '', d = '';
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const diff = y - x;
      const pct = x ? diff / x * 100 : null;
      d = `${diff > 0 ? '+' : ''}${r.money ? rub(diff) : num(diff, r.dec)}${
        pct == null ? '' : ` · ${diff > 0 ? '+' : ''}${num(pct, 1)} %`}`;
      if (r.better && Math.abs(pct || 0) > 0.5)
        cls = (r.better === 'less' ? diff < 0 : diff > 0) ? 'win-b' : 'win-a';
    }
    return `<tr class="${cls}${r.key ? ' key' : ''}">
      <td>${r.name}</td><td>${fmt(x)}</td><td>${fmt(y)}</td><td>${d || '—'}</td></tr>`;
  }).join('') : '';

  const head = `<div class="cmp-pick">
    ${pickHTML('left', left, works)}
    <span class="cmp-vs">против</span>
    ${pickHTML('right', right, works)}
  </div>`;

  if (!na || !nb) return `${head}
    <div class="screen-empty"><p>${works.length < 2
      ? 'Для сравнения нужно хотя бы два сохранённых изделия.'
      : 'Выберите два изделия — и увидите, чем они отличаются и что из этого выгоднее.'}</p></div>`;

  const verdict = (() => {
    const dm = nb.margin - na.margin, dc = nb.cost - na.cost;
    if (Math.abs(dm) < 1 && Math.abs(dc) < 1) return 'Разницы в деньгах почти нет — выбирайте по форме.';
    const better = dm > 0 ? b.name : a.name;
    return `Со штуки выгоднее «${esc(better)}»: маржа отличается на ${rub(Math.abs(dm))}` +
      `, себестоимость — на ${rub(Math.abs(dc))}.`;
  })();

  return `${head}
    <div class="cmp-heads">
      <div><b>${esc(a.name)}</b><span class="dim">${esc(na.mat)} · ${esc(na.glaze.toLowerCase())}${
        na.bad ? ` · ${na.bad} замечаний «нельзя»` : ''}</span></div>
      <div><b>${esc(b.name)}</b><span class="dim">${esc(nb.mat)} · ${esc(nb.glaze.toLowerCase())}${
        nb.bad ? ` · ${nb.bad} замечаний «нельзя»` : ''}</span></div>
    </div>
    <div class="cmp-thumbs">
      ${a.thumb ? `<img src="${a.thumb}" alt="" width="240" height="180">` : '<div class="cmp-noimg">без снимка</div>'}
      ${b.thumb ? `<img src="${b.thumb}" alt="" width="240" height="180">` : '<div class="cmp-noimg">без снимка</div>'}
    </div>
    <div class="pp-verdict ok cmp-verdict">${verdict}</div>
    <table class="cmp-table">
      <thead><tr><th>Величина</th><th>${esc(a.name)}</th><th>${esc(b.name)}</th><th>Разница</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="screen-note">Разница считается от левого к правому. Зелёным подсвечено там, где
      понятно, что «лучше»: меньше себестоимость, больше маржа и запас. У размеров лучше
      не бывает — там только разница.</p>`;
}

function mount(box) {
  box.querySelectorAll('[data-side]').forEach(sel => {
    sel.onchange = () => {
      if (sel.dataset.side === 'left') left = sel.value || null;
      else right = sel.value || null;
      refreshScreen(bodyHTML());
      mount(box);
    };
  });
}

export function openCompare() {
  const works = loadWorks().filter(w => !w.archived);
  /* По умолчанию слева — то, что открыто, справа — соседнее: сравнивать
     обычно хотят «эту и ту». */
  if (!left) left = currentWorkId() || (works[0] && works[0].id) || null;
  if (!right) right = (works.find(w => w.id !== left) || {}).id || null;
  openScreen({
    id: 'compare', wide: true,
    title: 'Сравнение изделий',
    lead: 'Две версии рядом: чем отличаются и какую выгоднее производить.',
    html: bodyHTML(),
    onMount: mount,
  });
}
