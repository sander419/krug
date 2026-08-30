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
import { castMouldNumbers, castMouldGeometry } from '../three/castMould.js';
import { sceneAPI } from '../three/scene.js';
import { exportGeoSTL } from '../three/exporters.js';
import { toast } from './overlays.js';

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
let preview = false;      // показываем ли половину формы вместо изделия

/**
 * @param a {dryG, cavityL, plasterKg, parts} — приходят из общего расчёта панели
 */
/* ---------- форма для литья: части, ярусы, литник, выгрузка ---------- */
function renderCastForm() {
  const box = $('castFormBody');
  if (!box) return;
  const cm = castMouldNumbers(state);
  const rows = cm.perTier.map((t, i) => `
    <div class="tier-row">
      <span class="tier-n">${cm.tiers > 1 ? `Ярус ${i + 1}` : 'Половина'}</span>
      <span class="tier-mm">${t.mm.join('×')} мм</span>
      <span class="tier-kg"><b>${num(t.kg, 1)} кг</b> гипса</span>
      <span class="tier-keys">замков ${t.keys}${t.joints ? ` · штифтов ${t.joints}` : ''}</span>
      <button class="btn small" data-tier-show="${i}">Показать</button>
      <button class="btn small" data-tier-stl="${i}">STL</button>
    </div>`).join('');

  box.innerHTML = `
    <p class="hint">Разъём вертикальный, через ось: половина снимается вбок, и завал профиля
      ей не мешает. Поднутрения, из-за которых жёсткой оснастке нужны три части, литью
      безразличны — поэтому сложные формы льют, а не штампуют.</p>
    <dl class="spec">
      <dt>Частей</dt><dd><b>${cm.parts}</b>
        ${cm.tiers > 1 ? `= ${cm.tiers} яруса × 2 половины` : '= две половины'}
        <span class="dim">(${cm.why})</span></dd>
      <dt>Литник</dt><dd>воронка ⌀${cm.funnelR * 2} × ${cm.funnelH} мм над кромкой ·
        ${num(cm.funnelL * 2, 2)} л запаса шликера на усадку при наборе ·
        срезается по кожетвёрдому</dd>
      <dt>Гипса всего</dt><dd><b>${num(cm.plasterL * 2 * 1.42, 1)} кг</b> на комплект
        <span class="dim">(${num(cm.plasterL * 2, 1)} л тела, стенка ${cm.wall} мм, дно ${cm.base} мм)</span></dd>
    </dl>
    <div class="tier-list">${rows}</div>
    <div class="btn-row">
      <button class="btn small" id="castStl">STL всех частей</button>
      <button class="btn small" id="castStop">Вернуть изделие</button>
    </div>
    <p class="note">Ручки и носики отливаются в своих полуформах — они в «Оснастке»:
      к корпусу их прилепляют по кожетвёрдому, а не отливают заодно.
      Размеры формы, литника и порог веса части — в «Настройках расчёта».
      Часть тяжелее порога режется поперёк: гипс тяжелеет как объём, и цельная половина
      крупной вазы одному не по силам.</p>`;

  box.querySelectorAll('[data-tier-show]').forEach(b2 => {
    b2.onclick = () => {
      preview = true;
      sceneAPI.setPreviewMesh(castMouldGeometry(state, {half: 'bump', tier: +b2.dataset.tierShow}).geometry);
      toast(`Половина формы, ярус ${+b2.dataset.tierShow + 1}: разъём вверх, замки бугорками`);
      emit();
      sceneAPI.frameView();
    };
  });
  box.querySelectorAll('[data-tier-stl]').forEach(b2 => {
    b2.onclick = () => saveTiers(+b2.dataset.tierStl);
  });
  const stop = $('castStop');
  if (stop) stop.onclick = () => { preview = false; sceneAPI.setPreviewMesh(null); emit(); sceneAPI.frameView(); };
}

/* Сохранить STL: один ярус или все части комплекта. */
function saveTiers(only) {
  const cm = castMouldNumbers(state);
  let n = 0;
  for (let i = 0; i < cm.tiers; i++) {
    if (only !== null && only !== undefined && i !== only) continue;
    for (const [half, suffix] of [['bump', 'бугорки'], ['socket', 'лунки']]) {
      const m = castMouldGeometry(state, {half, tier: i});
      const name = cm.tiers > 1 ? `форма-литьё-ярус${i + 1}-${suffix}` : `форма-литьё-${suffix}`;
      exportGeoSTL(state, m.geometry, name);
      m.geometry.dispose();
      n++;
    }
  }
  toast(`Сохранено частей: ${n}`);
}

export function renderCasting(a) {
  const box = $('castBody');
  if (!box) return;
  const o = opts();
  const plan = castingPlan({...a, wallMM: state.wall, perDay: o.perDay}, o);
  const cm = castMouldNumbers(state);

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
    </dl>
    <div class="cast-ticks">${table}</div>
    <p class="note">«Форма примет N подряд» — это насыщение гипса водой. На практике набор
      замедляется раньше: вторая и третья отливки идут дольше первой. Замерьте на второй —
      расчёт пойдёт от неё. Расход шликера учитывает ${o.wastePct} % потерь на плёнку
      в воронке и ведре; вода в свежем черепке принята за ${o.greenMoisturePct} % сухой массы.</p>`;

  renderCastForm();

  const stl = $('castStl');
  if (stl) stl.onclick = () => saveTiers(null);

  box.querySelectorAll('[data-cast]').forEach(inp => {
    inp.oninput = () => {
      const f = F.find(x => x.k === inp.dataset.cast);
      const v = Math.max(f.min, Math.min(f.max, +inp.value || f.min));
      state.cast = {...(state.cast || {}), [f.k]: v};
      emit();
    };
  });
}
