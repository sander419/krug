// file: js/ui/production.js
// Производство: работы, которые мастерская делает прямо сейчас.
//
// Мастерская держит в голове не одно изделие, а список: эту вазу отливаем
// пятьюдесятью, у той форма уже готова, третью пора ставить в печь. Раньше
// КРУГ показывал только открытую работу, и чтобы сравнить две, приходилось
// открывать их по очереди и запоминать числа.
//
// Здесь тот же расчёт, но по каждой сохранённой работе разом: тираж, глина,
// обжиги, формы, себестоимость и маржа. Ничего нового не считается — те же
// функции ядра, просто на чужой ДНК (state.withDNA подменяет состояние на
// время расчёта и возвращает назад).
//
// Это не ERP: ни сроков, ни людей, ни склада. Панель отвечает на один вопрос —
// «что у меня в работе и во что это обходится».
import { state, withDNA, encodeDNA } from '../core/state.js';
import { emit } from '../core/bus.js';
import { computeProduction, userProfileMM, computeWarnings, computeStrength } from '../core/math.js';
import { sanitizeCost, COST_LIMITS, pieceCost, batchPlan } from '../core/cost.js';
import { castMouldNumbers } from '../three/castMould.js';
import { plasterMix } from '../config/plasters.js';
import { byId as materialById } from '../config/materials.js';
import { byId as processById } from '../config/processes.js';
import { byGlazeId } from '../config/glazes.js';
import { savedWorks, updateWorkDNA, saveCurrent, saveCurrentAs, openWork } from './works.js';
import { PRESETS } from '../config/data.js';
import { MATERIALS } from '../config/materials.js';
import { kilnNumbers, kilnCurrent, kilnItem } from './kiln.js';
import { firingBill } from '../core/kiln.js';
import { $, esc, num, rub, plural } from './dom.js';
import { icon, paintIcons } from './icons.js';
import { toast } from './overlays.js';

const bag = (map, id, kg) => map.set(id, (map.get(id) || 0) + kg);

/* Закупка: сколько это в таре поставщика. Фасовку берём из паспорта — где её
   нет, там и не выдумываем: «столько-то килограммов» тоже ответ. */
function packList(map, lookup) {
  const parts = [];
  for (const [id, kg] of map) {
    const r = lookup(id);
    if (!r) continue;
    parts.push(r.packKg
      ? `${esc(r.name.toLowerCase())} — ${num(kg / r.packKg, 1)} × ${esc(r.pack || (r.packKg + ' кг'))}`
      : `${esc(r.name.toLowerCase())} — ${num(kg, 1)} кг, фасовка не опубликована`);
  }
  return parts.join(' · ');
}

/* Ресурс гипсовой формы — из реестра способов, одним числом на весь инструмент:
   в «Деньгах» и здесь оно обязано быть одним и тем же. */
const plasterWR = () => ({wr: 70, ...(state.plaster || {})}).wr;

function mouldLifePieces() {
  const p = processById('casting');
  return p && p.mouldLife ? p.mouldLife[0] : null;
}

/* До какой температуры греем эту работу: из паспорта её массы. Работы
   с разной температурой в одну садку не идут — это учитывает firingBill. */
function topOf() {
  const f = materialById(state.mat).firing || {};
  return (f.glazeC && f.glazeC[1]) || (f.bisqueC && f.bisqueC[1]) || 1050;
}

/** Числа одной работы. Считается тем же ядром, что и открытая. */
function workNumbers() {
  const prod = computeProduction(state);
  const prof = userProfileMM(state);
  const opt = sanitizeCost(state.cost);
  const kiln = kilnNumbers();
  const per = pieceCost(state, prod, prof,
    {...opt, firePerPiece: kiln.perItem || 0, glaze: byGlazeId(state.glazeId)});
  const plan = batchPlan(per, {n: opt.n, perFiring: kiln.load ? kiln.load.total : null,
                               mouldLifePieces: mouldLifePieces()});
  const bad = computeWarnings(state, prod, computeStrength(state))
    .filter(w => w.lvl === 'bad').length;
  let mould = null;
  try { mould = castMouldNumbers(state); } catch (_) {}
  return {
    per, plan, bad,
    mat: materialById(state.mat).name,
    mm: `${Math.round(state.H)}×${Math.round(state.D)}`,
    parts: (state.parts || []).length,
    lid: !!(state.lid && state.lid.on),
    mouldParts: mould ? mould.parts : null,
    /* Гипс — сколько отвесить сухого порошка под замес мастерской: ровно то же
       число, что показывает вкладка «Отливка». Масса схватившейся формы больше
       (она держит воду), и смешивать эти два числа в одном инструменте нельзя. */
    mouldKg: mould ? plasterMix(mould.plasterL * 2, plasterWR()).plasterKg : null,
    item: kilnItem(),                       // габарит после обжига — для общей садки
    matId: state.mat, glazeId: state.glazeId,
    topC: topOf(),                          // до скольки греем: разные температуры не мешают
    glaze: state.firing === 'glaze',
    kwh: (state.kiln || {}).kwh || 6,
  };
}

function rowHTML(w, n) {
  const status = n.bad
    ? `<span class="prod-flag bad">${n.bad} ${plural(n.bad, 'замечание', 'замечания', 'замечаний')} «нельзя»</span>`
    : `<span class="prod-flag ok">форма готова</span>`;
  return `<div class="prod-row">
    <div class="prod-head">
      <b>${esc(w.name)}</b>
      <span class="prod-sub">${n.mm} мм · ${esc(n.mat)}${n.parts ? ` · прилепов ${n.parts}` : ''}${n.lid ? ' · с крышкой' : ''}</span>
      ${status}
    </div>
    <dl class="prod-nums">
      <div><dt>Тираж</dt><dd><label class="prod-batch">
        <input type="number" data-batch="${w.id}" min="${COST_LIMITS.n[0]}" max="${COST_LIMITS.n[1]}"
               step="1" value="${n.plan.n}" inputmode="numeric"
               aria-label="Тираж работы «${esc(w.name)}»"><i>шт</i></label></dd></div>
      <div><dt>Глина</dt><dd><b>${num(n.plan.clayKg, 1)}</b> кг</dd></div>
      <div><dt>Обжигов</dt><dd>${n.plan.firings
        ? `<b>${n.plan.firings}</b> × ${n.plan.perFiring} шт`
        : '<span class="dim">не входит в печь</span>'}</dd></div>
      <div><dt>Форм</dt><dd>${n.plan.moulds
        ? `<b>${n.plan.moulds}</b> × ${n.mouldParts || 2} ч.${n.mouldKg ? ` · ${num(n.mouldKg * n.plan.moulds, 1)} кг гипса` : ''}`
        : '<span class="dim">—</span>'}</dd></div>
      <div><dt>Себестоимость</dt><dd><b>${rub(n.plan.perPiece)}</b>/шт</dd></div>
      <div><dt>Цена</dt><dd>${rub(n.per.minPrice)}/шт</dd></div>
      <div><dt>Партия</dt><dd>${rub(n.plan.total)}</dd></div>
      <div><dt>Маржа</dt><dd class="prod-margin"><b>${rub(n.plan.margin)}</b></dd></div>
    </dl>
    <div class="btn-row">
      <button class="btn small" data-open-work="${w.id}">Открыть</button>
      <span class="dim">${n.per.complete ? '' : 'в смете есть пустые места'}</span>
    </div>
  </div>`;
}

/* Три работы для примера: без них «Производство» пустое, и попробовать его
   можно только сочинив себе три изделия. Это обычные работы, а не особая
   сущность: те же пресеты, массы и тиражи, удаляются как все.
   Текущее состояние не трогаем — работаем на копии и возвращаем как было. */
const DEMO = [
  {name: 'Чашка 120', preset: 'Чашка', H: 95, D: 90, mat: 'snezhny-porcelain', n: 120, wall: 4},
  {name: 'Ваза 024', preset: 'Ваза', H: 240, D: 170, mat: 'gzhel-red', n: 24, wall: 6},
  {name: 'Миска 60', preset: 'Миска', H: 80, D: 200, mat: 's-6015', n: 60, wall: 5},
];

function addDemo() {
  const snap = JSON.parse(JSON.stringify(state));
  try {
    for (const d of DEMO) {
      const preset = PRESETS.find(p => p.name === d.preset);
      if (preset) { state.points = preset.pts.map(p => ({...p})); state.activePreset = preset.name; }
      if (MATERIALS.some(m => m.id === d.mat)) state.mat = d.mat;
      state.name = d.name;
      state.H = d.H; state.D = d.D; state.wall = d.wall;
      state.lid = {on: false};
      state.parts = [];
      state.cost = {...sanitizeCost(state.cost), n: d.n};
      /* Именно saveCurrentAs: saveCurrent обновил бы одну и ту же запись,
         и три примера легли бы друг на друга. */
      saveCurrentAs(d.name, {thumb: false});
    }
  } finally {
    Object.assign(state, snap);
  }
}

export function syncProduction() {
  const box = $('prodBody');
  if (!box) return;
  const list = savedWorks();

  if (!list.length) {
    box.innerHTML = `
      <p class="hint">Пока пусто. «Производство» показывает сохранённые работы: сохраните
        текущую — и она появится здесь вместе с тиражом, обжигами, формами и деньгами.</p>
      <button class="btn primary wide" id="prodSave">${icon('save', 15)}Сохранить текущую работу</button>
      <button class="btn wide" id="prodDemo">${icon('layers', 15)}Загрузить три работы для примера</button>
      <p class="note">Пример — это три обычные работы (чашка, ваза, миска) с разными массами
        и тиражами: видно, как считаются общая садка и деньги на несколько наименований.
        Удаляются как любые другие — в списке «Работы» в шапке.</p>`;
    const b = $('prodSave');
    if (b) b.onclick = () => { saveCurrent(); emit(); toast('Работа сохранена'); };
    const d = $('prodDemo');
    if (d) d.onclick = () => { addDemo(); emit(); toast('Три работы для примера добавлены'); };
    paintIcons(box);
    return;
  }

  const rows = [];
  let clay = 0, cost = 0, margin = 0, pieces = 0, revenue = 0;
  let glaze = false, kwh = 6, glazeKg = 0, glazeRub = 0;
  const items = [];
  const clayBy = new Map(), glazeBy = new Map();
  for (const w of list) {
    const n = withDNA(w.dna, () => workNumbers());
    if (!n) continue;
    clay += n.plan.clayKg; cost += n.plan.total; margin += n.plan.margin;
    pieces += n.plan.n; revenue += n.plan.revenue;
    items.push({...n.item, n: n.plan.n, topC: n.topC});
    glaze = glaze || n.glaze; kwh = n.kwh;
    /* Глину и глазурь покупают тарой, поэтому копим по каждой массе отдельно:
       две работы на разных массах — это два мешка, а не один. */
    bag(clayBy, n.matId, n.plan.clayKg);
    bag(glazeBy, n.glazeId, n.plan.glazeKg);
    glazeKg += n.plan.glazeKg; glazeRub += (n.per.glazeRub || 0) * n.plan.n;
    rows.push(rowHTML(w, n));
  }

  /* Обжиги считаются на все работы разом: греть печь ради неполной полки
     мастерская не станет, она соберёт садку из разных наименований. */
  const mix = firingBill(kilnCurrent(), items, {priceKWh: kwh, glaze});

  box.innerHTML = `
    <dl class="spec prod-total">
      <dt>Всего в работе</dt><dd><b>${rows.length}</b> ${plural(rows.length, 'работа', 'работы', 'работ')} ·
        ${pieces} ${plural(pieces, 'изделие', 'изделия', 'изделий')}</dd>
      <dt>Глины</dt><dd><b>${num(clay, 0)} кг</b>
        <span class="dim">${packList(clayBy, id => materialById(id))}</span></dd>
      <dt>Глазури</dt><dd><b>${num(glazeKg, 1)} кг</b> сухой смеси${glazeRub > 0
        ? ` · ${rub(glazeRub)}` : ' <span class="dim">· цена не взята из паспорта</span>'}
        <span class="dim">${packList(glazeBy, id => byGlazeId(id))}</span></dd>
      <dt>Обжигов</dt><dd>${mix.firings
        ? `<b>${mix.firings}</b> ${plural(mix.firings, 'загрузка', 'загрузки', 'загрузок')}
           <span class="dim">${mix.groups.length > 1
             ? `в ${mix.groups.length} температуры (${mix.groups.map(g => g.topC + ' °C').join(', ')}) —
                вместе их обжигать нельзя`
             : mix.apart > mix.firings
               ? `общей садкой вместо ${mix.apart} порознь — полки заняты разными работами`
               : 'плотнее не собрать: высокие работы съедают высоту камеры'}</span>`
        : `<span class="dim">${esc(mix.why || 'изделия не входят в выбранную печь')}</span>`}</dd>
      ${mix.rub ? `<dt>Электричество</dt><dd><b>${rub(mix.rub)}</b> ·
        ${num(mix.kWh, 0)} кВт·ч <span class="dim">по вашему плану выходит
        ${rub(mix.perPiece)} на изделие; в смете стоит цена при полной садке</span></dd>` : ''}
      <dt>Себестоимость</dt><dd><b>${rub(cost)}</b> на всё</dd>
      <dt>Выручка</dt><dd>${rub(revenue)} по минимальной цене · маржа <b>${rub(margin)}</b></dd>
    </dl>
    <div class="prod-list">${rows.join('')}</div>
    <button class="btn wide" id="prodSaveMore">${icon('save', 15)}Добавить открытую работу в список</button>
    <p class="note">Тираж правится прямо здесь и остаётся в самой работе; остальное считается
      тем же ядром, что и для открытой: обжиги — из садки печи, формы — из ресурса гипсовой
      формы, деньги — из сметы. Правка тиража меняет сохранённую работу, а не открытую:
      чтобы работать с изделием, нажмите «Открыть». Работы лежат в этом браузере:
      сервера у КРУГа нет.</p>`;

  /* Тираж правится прямо в карточке: мастерская думает списком — «этой
     пятьдесят, той двадцать», — и ради каждой цифры открывать работу незачем.
     Число живёт в ДНК самой работы, поэтому её ДНК и переписывается. */
  box.querySelectorAll('[data-batch]').forEach(inp => {
    inp.onchange = () => {
      const id = inp.dataset.batch;
      const [lo, hi] = COST_LIMITS.n;
      const n = Math.min(hi, Math.max(lo, Math.round(+inp.value) || lo));
      const w = savedWorks().find(x => x.id === id);
      if (!w) return;
      const dna = withDNA(w.dna, () => {
        state.cost = {...sanitizeCost(state.cost), n};
        return encodeDNA();
      });
      if (dna && updateWorkDNA(id, dna)) emit();
    };
  });

  const more = $('prodSaveMore');
  if (more) more.onclick = () => {
    const name = saveCurrent();
    emit();
    toast(`Работа «${name}» в списке производства`);
  };
  paintIcons(box);

  box.querySelectorAll('[data-open-work]').forEach(b => {
    // открываем той же дверью, что и список в шапке: там пересобирается вся
    // панель, а не только сцена — иначе имя и ползунки остаются от прежней работы
    b.onclick = () => { openWork(b.dataset.openWork); };
  });
}

export function initProduction() { syncProduction(); }
