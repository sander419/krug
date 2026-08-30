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
import { state, withDNA, encodeDNA, applyDNA } from '../core/state.js';
import { emit } from '../core/bus.js';
import { computeProduction, userProfileMM, computeWarnings, computeStrength } from '../core/math.js';
import { sanitizeCost, pieceCost, batchPlan } from '../core/cost.js';
import { castMouldNumbers } from '../three/castMould.js';
import { byId as materialById } from '../config/materials.js';
import { savedWorks } from './works.js';
import { kilnNumbers } from './kiln.js';
import { $, esc, num, rub } from './dom.js';
import { icon, paintIcons } from './icons.js';
import { toast } from './overlays.js';

/** Числа одной работы. Считается тем же ядром, что и открытая. */
function workNumbers() {
  const prod = computeProduction(state);
  const prof = userProfileMM(state);
  const opt = sanitizeCost(state.cost);
  const kiln = kilnNumbers();
  const per = pieceCost(state, prod, prof, {...opt, firePerPiece: kiln.perItem || 0});
  const plan = batchPlan(per, {n: opt.n, perFiring: kiln.load ? kiln.load.total : null,
                               mouldLifePieces: 50});
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
    mouldKg: mould ? mould.plasterL * 2 * 1.42 : null,
  };
}

function rowHTML(w, n) {
  const status = n.bad
    ? `<span class="prod-flag bad">${n.bad} замечани${n.bad === 1 ? 'е' : 'я'} «нельзя»</span>`
    : `<span class="prod-flag ok">форма готова</span>`;
  return `<div class="prod-row">
    <div class="prod-head">
      <b>${esc(w.name)}</b>
      <span class="prod-sub">${n.mm} мм · ${esc(n.mat)}${n.parts ? ` · прилепов ${n.parts}` : ''}${n.lid ? ' · с крышкой' : ''}</span>
      ${status}
    </div>
    <dl class="prod-nums">
      <div><dt>Тираж</dt><dd><b>${n.plan.n}</b> шт</dd></div>
      <div><dt>Глина</dt><dd><b>${num(n.plan.clayKg, 1)}</b> кг</dd></div>
      <div><dt>Обжигов</dt><dd>${n.plan.firings
        ? `<b>${n.plan.firings}</b> × ${n.plan.perFiring} шт`
        : '<span class="dim">не входит в печь</span>'}</dd></div>
      <div><dt>Форм</dt><dd>${n.plan.moulds
        ? `<b>${n.plan.moulds}</b> × ${n.mouldParts || 2} ч.${n.mouldKg ? ` · ${num(n.mouldKg * n.plan.moulds, 0)} кг гипса` : ''}`
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

export function syncProduction() {
  const box = $('prodBody');
  if (!box) return;
  const list = savedWorks();

  if (!list.length) {
    box.innerHTML = `
      <p class="hint">Пока пусто. «Производство» показывает сохранённые работы: сохраните
        текущую кнопкой «Работы» в шапке — и она появится здесь вместе с тиражом,
        обжигами, формами и деньгами.</p>
      <button class="btn primary wide" id="prodSave">${icon('save', 15)}Сохранить текущую работу</button>`;
    const b = $('prodSave');
    if (b) b.onclick = () => { document.getElementById('worksBtn').click(); };
    paintIcons(box);
    return;
  }

  const rows = [];
  let clay = 0, cost = 0, margin = 0, firings = 0;
  for (const w of list) {
    const n = withDNA(w.dna, () => workNumbers());
    if (!n) continue;
    clay += n.plan.clayKg; cost += n.plan.total; margin += n.plan.margin;
    firings += n.plan.firings || 0;
    rows.push(rowHTML(w, n));
  }

  box.innerHTML = `
    <dl class="spec prod-total">
      <dt>Всего в работе</dt><dd><b>${rows.length}</b> ${rows.length === 1 ? 'работа' : 'работ'}</dd>
      <dt>Глины</dt><dd><b>${num(clay, 0)} кг</b> <span class="dim">(${num(clay / 20, 1)} валюшек по 20 кг)</span></dd>
      <dt>Обжигов</dt><dd><b>${firings || '—'}</b></dd>
      <dt>Себестоимость</dt><dd><b>${rub(cost)}</b> · маржа ${rub(margin)}</dd>
    </dl>
    <div class="prod-list">${rows.join('')}</div>
    <p class="note">Числа считаются тем же ядром, что и для открытой работы: тираж берётся
      из её собственной ДНК («Деньги» → «Тираж»), обжиги — из садки печи, формы — из ресурса
      гипсовой формы. Работы лежат в этом браузере: сервера у КРУГа нет.</p>`;

  box.querySelectorAll('[data-open-work]').forEach(b => {
    b.onclick = () => {
      const w = savedWorks().find(x => x.id === b.dataset.openWork);
      if (w && applyDNA(w.dna)) { emit(); toast(`Открыта работа «${w.name}»`); }
    };
  });
}

export function initProduction() { syncProduction(); }
