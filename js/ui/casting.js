// file: js/ui/casting.js
// Литьё в гипсовую форму: панель для маленькой мастерской.
//
// Заводской расчёт отвечает на вопрос «сколько это стоит при тираже 20 000».
// Мастерская спрашивает другое: сколько держать шликер, сколько его налить,
// сколько отливок форма примет до сушки и сколько форм нужно, чтобы делать
// десять штук в день. Этот блок отвечает на эти четыре вопроса.
//
// Считает js/core/casting.js. Здесь только показ и поля ввода — все числа,
// зависящие от конкретного шликера и гипса, вводятся руками: они калибровка,
// а не константа.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { CAST_DEFAULTS, castingPlan } from '../core/casting.js';
import { $, num } from './dom.js';

const F = [
  {k: 'calibMM',  n: 'Замер: набралось', u: 'мм',   min: 0.5, max: 20,  step: 0.5},
  {k: 'calibMin', n: 'за время',         u: 'мин',  min: 1,   max: 240, step: 1},
  {k: 'slipDensity', n: 'Плотность шликера', u: 'кг/л', min: 1.2, max: 2.2, step: 0.01},
  {k: 'solidsPct',   n: 'Твёрдого в шликере', u: '%', min: 40, max: 85, step: 1},
  {k: 'plasterUptakePct', n: 'Гипс принимает воды', u: '% массы', min: 5, max: 60, step: 1},
  {k: 'dryHours', n: 'Сушка формы', u: 'ч', min: 1, max: 120, step: 1},
  {k: 'perDay',   n: 'План на день', u: 'шт', min: 0, max: 500, step: 1},
];

const opts = () => ({...CAST_DEFAULTS, perDay: 10, ...(state.cast || {})});

/**
 * @param a {dryG, cavityL, plasterKg, parts} — приходят из общего расчёта панели
 */
export function renderCasting(a) {
  const box = $('castBody');
  if (!box) return;
  const o = opts();
  const plan = castingPlan({...a, wallMM: state.wall, perDay: o.perDay}, o);

  const fields = F.map(f => `
    <label class="field-row"><span>${f.n}</span>
      <input type="number" data-cast="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}"
             value="${o[f.k]}"><i class="unit">${f.u}</i></label>`).join('');

  const table = plan.table.map(r =>
    `<span class="cast-tick"><b>${r.min}</b> мин → ${num(r.mm, 1)} мм</span>`).join('');

  box.innerHTML = `
    <p class="hint">Набор стенки — корень из времени: каждый следующий миллиметр даётся
      дольше предыдущего. Коэффициент берётся из вашего замера, а не из справочника:
      налейте шликер в свою форму, засеките время до нужной толщины и впишите сюда.</p>
    ${fields}
    <dl class="spec">
      <dt>Выдержка</dt><dd><b>${num(plan.hold, 0)} мин</b> до стенки ${num(state.wall, 1)} мм
        <span class="dim">(${num(plan.rateMMperSqrtMin, 2)} мм за корень из минуты)</span></dd>
      <dt>Налить</dt><dd><b>${num(plan.slip.pourKg, 2)} кг</b> шликера ·
        уйдёт в изделие ${num(plan.slip.usedKg, 2)} кг · вернётся ${num(plan.slip.backKg, 2)} кг</dd>
      <dt>Форма примет</dt><dd><b>${plan.cap.inRow} ${plan.cap.inRow === 1 ? 'отливку' : 'отливок'}</b> подряд
        <span class="dim">(запас ${num(plan.cap.capacityKg, 1)} кг воды, отливка отдаёт ${num(plan.slip.waterKg, 2)} кг)</span></dd>
      <dt>Форм на план</dt><dd>${plan.cap.mouldsNeeded
        ? `<b>${plan.cap.mouldsNeeded} шт</b> на ${o.perDay} изделий в день
           <span class="dim">(одна форма даёт ${num(plan.cap.perMouldPerDay, 1)} в день)</span>`
        : '<span class="dim">задайте дневной план</span>'}</dd>
      <dt>Части формы</dt><dd>${a.parts} <span class="dim">по разъёмам профиля</span> ·
        литник ${plan.sprueMM} мм над кромкой, срезается по кожетвёрдому</dd>
    </dl>
    <div class="cast-ticks">${table}</div>
    <p class="note">«Форма примет N подряд» — это насыщение гипса водой. На практике набор
      замедляется раньше: вторая и третья отливки идут дольше первой. Замерьте на второй —
      расчёт пойдёт от неё. Расход шликера учитывает ${o.wastePct} % потерь на плёнку
      в воронке и ведре; вода в свежем черепке принята за ${o.greenMoisturePct} % сухой массы.</p>`;

  box.querySelectorAll('[data-cast]').forEach(inp => {
    inp.oninput = () => {
      const f = F.find(x => x.k === inp.dataset.cast);
      const v = Math.max(f.min, Math.min(f.max, +inp.value || f.min));
      state.cast = {...(state.cast || {}), [f.k]: v};
      emit();
    };
  });
}
