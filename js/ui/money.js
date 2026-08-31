// file: js/ui/money.js
// Деньги: во сколько обойдётся изделие и что будет на тираже.
//
// Мастеру нужен один ответ, а не бухгалтерия: сколько стоит сделать штуку
// и ниже какой цены её продавать нельзя. Поэтому первый блок — смета на одно
// изделие, и в ней видно, какие числа взяты из паспорта, а какие — ориентир.
// Второй блок отвечает на «хочу сделать N»: те же деньги, плюс то, что имеет
// смысл только на партии — сколько обжигов и сколько форм.
//
// Считает js/core/cost.js. Экономика «оснастка против рук» осталась в третьем
// блоке (js/ui/tooling.js) — это другой вопрос и другая аудитория.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { computeProduction, userProfileMM } from '../core/math.js';
import { sanitizeCost, COST_LIMITS, pieceCost, batchPlan } from '../core/cost.js';
import { byId as materialById } from '../config/materials.js';
import { byGlazeId } from '../config/glazes.js';
import { byId as processById } from '../config/processes.js';
import { tune } from '../core/tuning.js';
import { $, num, rub, esc, plural } from './dom.js';
import { kilnNumbers } from './kiln.js';

const costNow = () => sanitizeCost(state.cost);

const F = [
  {k: 'minPerPiece',  n: 'Работы на изделие', u: 'мин', step: 1,  est: true},
  {k: 'hourRate',     n: 'Ставка мастера',    u: '₽/ч', step: 50, est: true},
  {k: 'glazeRubPerKg', n: 'Глазурь, своя цена', u: '₽/кг', step: 50, empty: true},
  {k: 'lossPct',      n: 'Брак',              u: '%',   step: 1,  est: true},
  {k: 'otherPct',     n: 'Прочие расходы',    u: '%',   step: 1,  est: true},
  {k: 'marginPct',    n: 'Наценка',           u: '%',   step: 10},
  {k: 'toolingRub',   n: 'Оснастка на серию', u: '₽',   step: 500},
  {k: 'toolingPieces', n: '…на сколько изделий', u: 'шт', step: 10},
];

/** Все числа сметы: их же берёт «Производство» и лист для мастерской. */
export function moneyNumbers() {
  const o = costNow();
  const prod = computeProduction(state);
  const prof = userProfileMM(state);
  const kiln = kilnNumbers();
  const per = pieceCost(state, prod, prof,
    {...o, firePerPiece: kiln.perItem || 0, glaze: byGlazeId(state.glazeId)});
  const plan = batchPlan(per, {
    n: o.n,
    perFiring: kiln.load ? kiln.load.total : null,
    mouldLifePieces: mouldLife(),
  });
  return {per, plan, kiln, opt: o};
}

/* Ресурс формы — из реестра способов: у гипсовой формы он совсем не тот,
   что у пресс-формы, и у части способов его никто не публикует. */
function mouldLife() {
  const proc = processById('casting') || null;
  return proc && proc.mouldLife ? proc.mouldLife[0] : null;
}

const estTag = '<span class="est-tag" title="Ориентир, а не паспортное число">оценка</span>';

function fields(o) {
  return F.map(f => {
    const [lo, hi] = COST_LIMITS[f.k];
    const v = o[f.k] == null ? '' : o[f.k];
    return `<label class="field-row"><span>${f.n}${f.est ? ' ' + estTag : ''}</span>
      <input type="number" data-cost="${f.k}" min="${lo}" max="${hi}" step="${f.step}"
             value="${v}" inputmode="numeric"${f.empty ? ' placeholder="из паспорта"' : ''}
             ><i class="unit">${f.u}</i></label>`;
  }).join('');
}

function bindFields(box) {
  box.querySelectorAll('[data-cost]').forEach(inp => {
    inp.oninput = () => {
      const k = inp.dataset.cost;
      const [lo, hi] = COST_LIMITS[k];
      // пустое поле цены глазури — это «взять из паспорта», а не ноль
      const raw = inp.value.trim();
      const v = raw === '' && k === 'glazeRubPerKg'
        ? null : Math.min(hi, Math.max(lo, +raw || 0));
      state.cost = {...costNow(), [k]: v};
      emit();
    };
  });
}

/* ---------- смета на одно изделие ---------- */
function renderPiece(m) {
  const box = $('costBody');
  if (!box) return;
  const {per, opt} = m;
  const mat = materialById(state.mat);
  const row = (name, value, note) =>
    `<dt>${name}</dt><dd>${value}${note ? ` <span class="dim">${note}</span>` : ''}</dd>`;

  box.innerHTML = `
    <div class="cost-total">
      <span class="cost-cap">Себестоимость изделия</span>
      <b class="cost-sum">${rub(per.total)}</b>
      <span class="cost-sub">продавать дешевле <b>${rub(per.minPrice)}</b> — работать в минус;
        маржа при этой цене ${rub(per.marginRub)}</span>
    </div>
    <dl class="spec cost-list">
      ${row('Глина', per.clayRub == null
        ? '<span class="dim">цена массы не опубликована</span>'
        : `<b>${rub(per.clayRub)}</b>`,
        `${num(per.clayKg, 2)} кг сырья${per.clayPerKg ? ` · ${num(per.clayPerKg, 0)} ₽/кг по паспорту` : ''}`)}
      ${row('Глазурь', per.glazeRub == null
        ? '<span class="dim">цена не взята</span>'
        : `<b>${rub(per.glazeRub)}</b>${per.glazePrice.from === 'passport' ? '' : ' ' + estTag}`,
        `${num(per.areaCm2, 0)} см² поверхности · ${num(per.glazeKg * 1000, 0)} г смеси
         <span class="src-note">${esc(per.glazePrice.note)}</span>`)}
      ${row('Обжиг', per.fireRub == null
        ? '<span class="dim">изделие не входит в выбранную печь</span>'
        : `<b>${rub(per.fireRub)}</b>`,
        per.fireRub == null ? '' : 'из садки: сколько влезло, столько и делит киловатт-часы')}
      ${row('Работа', `<b>${rub(per.labourRub)}</b> ${estTag}`,
        `${opt.minPerPiece} мин по ${num(opt.hourRate, 0)} ₽/ч`)}
      ${per.toolingRub > 0
        ? row('Оснастка', `<b>${rub(per.toolingRub)}</b>`,
              `${rub(opt.toolingRub)} на ${opt.toolingPieces} изделий`)
        : ''}
      ${row('Прочие', `<b>${rub(per.otherRub)}</b> ${estTag}`, `${opt.otherPct} % — упаковка, расходники`)}
      ${row('Брак', `<b>${rub(per.lossRub)}</b> ${estTag}`,
        `${opt.lossPct} %: разбитое оплачивают уцелевшие`)}
    </dl>
    ${fields(opt)}
    <p class="note">Из паспорта берётся только цена массы (${esc(mat.name)}${per.clayPerKg
      ? `, ${num(per.clayPerKg, 0)} ₽/кг` : ' — цена не опубликована'}) и киловатт-часы печи.
      Остальное — ваши числа: ставка, минуты, цена глазури, брак. Помеченное «оценка» —
      ориентир инструмента, замените своим, и расчёт станет вашим.
      Расход глазури (${tune('glazeGperCm2')} г/см²) меняется в «Настройках расчёта».</p>`;
  bindFields(box);
}

/* ---------- тираж ---------- */
function renderBatch(m) {
  const box = $('batchBody');
  if (!box) return;
  const {per, plan, kiln, opt} = m;
  const [lo, hi] = COST_LIMITS.n;

  box.innerHTML = `
    <label class="field-row big"><span>Сделать изделий</span>
      <input type="number" data-cost="n" min="${lo}" max="${hi}" step="1"
             value="${opt.n}" inputmode="numeric"><i class="unit">шт</i></label>
    <dl class="spec">
      <dt>Глина</dt><dd><b>${num(plan.clayKg, 1)} кг</b> сырья
        <span class="dim">(${num(plan.clayKg / 20, 1)} валюшки по 20 кг)</span></dd>
      <dt>Глазурь</dt><dd><b>${num(plan.glazeKg, 2)} кг</b> сухой смеси
        <span class="dim">оценка по площади поверхности</span></dd>
      <dt>Обжиги</dt><dd>${plan.firings
        ? `<b>${plan.firings}</b> ${plural(plan.firings, 'загрузка', 'загрузки', 'загрузок')}
           <span class="dim">(в печь входит ${plan.perFiring} шт за раз)</span>`
        : '<span class="dim">изделие не входит в выбранную печь — см. «Печь и садка»</span>'}</dd>
      <dt>Форм под литьё</dt><dd>${plan.moulds
        ? `<b>${plan.moulds}</b> ${plural(plan.moulds, 'форма', 'формы', 'форм')}
           <span class="dim">(гипсовая форма живёт ${plan.mouldLifePieces} отливок)</span>`
        : '<span class="dim">ресурс формы не подтверждён</span>'}</dd>
      <dt>Себестоимость</dt><dd><b>${rub(plan.total)}</b> за партию ·
        ${rub(plan.perPiece)} за штуку</dd>
      <dt>Выручка</dt><dd>${rub(plan.revenue)} по минимальной цене ·
        маржа <b>${rub(plan.margin)}</b></dd>
    </dl>
    <p class="note">Тираж не меняет цену штуки сам по себе: дешевле становится там, где
      появляется оснастка и машинный цикл — это считает блок «Тираж и экономика»
      (задача «Тираж в гипсе»). Здесь партия — это умноженная штука плюс обжиги и формы,
      которые на партии становятся видны.</p>`;
  bindFields(box);
}

export function syncMoney() {
  const m = moneyNumbers();
  renderPiece(m);
  renderBatch(m);
}

export function initMoney() { syncMoney(); }
