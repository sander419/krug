// file: js/ui/casting.js
// Отливка: мастерская гипсовых форм и сам процесс литья.
//
// Раньше форма под отливку была блоком внутри задачи «тираж в гипсе», а формы
// под ручки и носики — вообще на другой вкладке, среди гипса для матрицы.
// Человек, пришедший «сделать форму на эту вазу», обходил две панели и половину
// не находил. Теперь вкладка одна и начинается с вопроса «что формуем»: корпус,
// крышку или конкретный прилеп. Дальше — части формы, гипс на них и STL.
//
// Считают: js/three/castMould.js (корпус и крышка — две половины с ярусами,
// литником и замками), js/three/partMould.js (прилепы — пара половин с канавкой),
// js/core/casting.js (процесс: выдержка, шликер, ресурс формы).
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { CAST_DEFAULTS, castingPlan } from '../core/casting.js';
import { castSubjects } from '../core/mould.js';
import { userProfileMM } from '../core/math.js';
import { partMetrics, partSelfOverlap } from '../core/parts.js';
import { PLASTERS, byId as plasterById, plasterMix } from '../config/plasters.js';
import { $, esc, num, dec, rub } from './dom.js';
import { castMouldNumbers, castMouldGeometry } from '../three/castMould.js';
import { partMouldBlock, partMouldFeatures, partMouldGeometry } from '../three/partMould.js';
import { sceneAPI } from '../three/scene.js';
import { exportGeoSTL } from '../three/exporters.js';
import { toast } from './overlays.js';
import { openBlock } from './panels.js';
import { analyzeFormability, recommendProcess } from '../core/tooling.js';
import { byId as processById } from '../config/processes.js';

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
const plasterNow = () => ({id: 'gvvs-16', wr: 70, ...(state.plaster || {})});

const MOULD_WALL = 20;      // мм гипса вокруг прилепа

let subjectId = 'ware';     // что формуем сейчас
let preview = false;        // на сцене показана половина формы, а не изделие

/* Список того, что формуем, и выбранное сейчас. Список пересобирается каждый
   раз: крышку выключили, прилеп удалили — выбор обязан за этим следовать. */
function subjects() {
  const list = castSubjects(state);
  if (!list.some(s => s.id === subjectId)) subjectId = 'ware';
  return {list, cur: list.find(s => s.id === subjectId)};
}

function stopPreview() {
  preview = false;
  sceneAPI.setPreviewMesh(null);
  emit();
  sceneAPI.frameView();
}

function showMesh(geo, msg) {
  preview = true;
  sceneAPI.setPreviewMesh(geo);
  toast(msg);
  emit();
  sceneAPI.frameView();
}

/* ---------- что формуем ---------- */
function renderPick(list, cur) {
  const box = $('castPickBody');
  if (!box) return;
  const parts = list.filter(s => s.kind === 'part').length;
  /* Способ решает, какая форма вообще нужна: под литьё — разъёмная гипсовая,
     под штамповку и ролик — жёсткая матрица с пуансоном. Их считает «Оснастка»,
     и мы туда ведём, а не строим второй такой же расчёт здесь. */
  const an = analyzeFormability(state);
  const rec = recommendProcess(state, an);
  const proc = processById(rec.id);
  const casting = rec.id === 'casting';

  box.innerHTML = `
    <div class="seg wrap" role="group" aria-label="Что формуем">
      ${list.map(s => `<button data-subj="${esc(s.id)}"${s.id === cur.id ? ' class="active"' : ''}>
        ${esc(s.name)}</button>`).join('')}
    </div>
    <dl class="spec">
      <dt>Способ</dt><dd><b>${casting ? 'литьё в гипсовую форму' : esc(proc.name.toLowerCase())}</b>
        <span class="dim">— ${esc(rec.why[0] || '')}</span></dd>
    </dl>
    ${casting ? '' : `<p class="hint">Этой форме КРУГ советует не литьё: жёсткую матрицу
      и пуансон считает вкладка «Оснастка». Форму под отливку можно сделать и так —
      литью поднутрения безразличны, — но пласт для неё придётся раскатывать вручную.
      <button class="btn small" id="castToTool">Открыть оснастку</button></p>`}
    <p class="hint">На изделие нужна не одна форма: корпус льют в своей,
      ${state.lid && state.lid.on ? 'крышку — в своей, ' : ''}${parts
        ? `${parts === 1 ? 'прилеп формуется' : 'прилепы формуются'} в паре половин каждый`
        : 'прилепы формуются каждый в своей паре половин'}.
      Их не отливают заодно с корпусом: прилепляют по кожетвёрдому.</p>`;
  const toTool = $('castToTool');
  if (toTool) toTool.onclick = () => {
    if (!openBlock('process')) toast('Оснастка убрана этой задачей — смените задачу на «Тираж в гипсе»');
  };
  box.querySelectorAll('[data-subj]').forEach(b => {
    b.onclick = () => {
      subjectId = b.dataset.subj;
      if (preview) stopPreview(); else emit();
    };
  });
}

/* ---------- форма корпуса и крышки: половины, ярусы, литник ---------- */
function renderLatheMould(cur) {
  const cm = castMouldNumbers(state, cur.subject);
  const mixOf = l => plasterMix(l, plasterNow().wr);
  const rows = cm.perTier.map((t, i) => `
    <div class="tier-row">
      <span class="tier-n">${cm.tiers > 1 ? `Ярус ${i + 1}` : 'Половина'}</span>
      <span class="tier-mm">${t.mm.join('×')} мм</span>
      <span class="tier-kg"><b>${num(mixOf(t.plasterL).plasterKg, 1)} кг</b> гипса →
        часть ${num(t.kg, 1)} кг</span>
      <span class="tier-keys">замков ${t.keys}${t.joints ? ` · штифтов ${t.joints}` : ''}</span>
      <button class="btn small" data-tier-show="${i}">Показать</button>
      <button class="btn small" data-tier-stl="${i}">STL</button>
    </div>`).join('');

  return `
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
      <dt>Гипса всего</dt><dd><b>${num(mixOf(cm.plasterL * 2).plasterKg, 1)} кг</b> отвесить
        на комплект <span class="dim">(${num(cm.plasterL * 2, 1)} л тела, стенка ${cm.wall} мм,
        дно ${cm.base} мм; готовый комплект весит ${num(cm.plasterL * 2 * 1.42, 1)} кг —
        схватившийся гипс держит воду)</span></dd>
    </dl>
    <div class="tier-list">${rows}</div>
    <div class="btn-row">
      <button class="btn small" id="castStl">STL всех частей</button>
      ${preview ? '<button class="btn small" id="castStop">Вернуть изделие</button>' : ''}
    </div>
    <p class="note">«Отвесить» — сухой порошок под ваш замес; «часть N кг» — сколько весит
      схватившаяся половина, её и таскают с полки на полку.
      Размеры формы, литника и порог веса части — в «Настройках расчёта».
      Часть тяжелее порога режется поперёк: гипс тяжелеет как объём, и цельная половина
      крупной вазы одному не по силам.</p>`;
}

/* ---------- форма прилепа: пара половин с канавкой ---------- */
function renderPartMould(cur) {
  const prof = userProfileMM(state);
  const p = cur.part;
  if (partSelfOverlap(prof, p))
    return `<p class="warn-inline">Форма не строится: деталь пересекает сама себя, и канавкой
      она не отпечатается. Уменьшите сечение или разведите прилепы на чертеже.</p>`;

  const m = partMouldBlock(prof, p, MOULD_WALL);
  const f = partMouldFeatures(prof, p, MOULD_WALL);
  // бугорки замков на одной половине и лунки на другой взаимно гасятся,
  // а облойная канавка убавляет гипс на каждой
  const halfL = Math.max(m.boxL - partMetrics(prof, p).volMl / 2000 - f.flashL, 0);
  const mix = plasterMix(halfL, plasterNow().wr);
  return `
    <p class="hint">Прилеп формуется отдельно от корпуса: две половины, разъём по плоскости
      детали, вокруг канавки — облойная. Отлитую ручку прилепляют по кожетвёрдому.</p>
    <dl class="spec">
      <dt>Частей</dt><dd><b>2</b> = две половины, замков ${f.keys}</dd>
      <dt>Блок</dt><dd>${m.blockMM.map(v => Math.round(v)).join('×')} мм на половину</dd>
      <dt>Гипса</dt><dd><b>${num(mix.plasterKg, 1)} кг</b> отвесить на половину ·
        ${num(mix.plasterKg * 2, 1)} кг на пару
        <span class="dim">(${num(halfL, 2)} л тела, облой ${num(f.flashL * 1000, 0)} см³)</span></dd>
    </dl>
    <div class="btn-row">
      <button class="btn small" data-pm-show>Показать половину</button>
      <button class="btn small" data-pm-stl>STL обеих</button>
      ${preview ? '<button class="btn small" id="castStop">Вернуть изделие</button>' : ''}
    </div>
    <p class="note">Замки и облойная канавка построены; штифтов и воздушных каналов нет —
      их сверлят по месту. Ресурс таких форм не подтверждён: их меняют по состоянию,
      а не по числу циклов.</p>`;
}

/* ---------- гипс: марка и замес, общие на все формы ---------- */
function renderPlaster(cur) {
  const box = $('castPlasterBody');
  if (!box) return;
  const ps = plasterNow();
  const p = plasterById(ps.id) || PLASTERS[0];
  const litres = cur.kind === 'lathe'
    ? castMouldNumbers(state, cur.subject).plasterL * 2
    : (() => {
        const prof = userProfileMM(state);
        if (partSelfOverlap(prof, cur.part)) return 0;
        const m = partMouldBlock(prof, cur.part, MOULD_WALL);
        const f = partMouldFeatures(prof, cur.part, MOULD_WALL);
        return 2 * Math.max(m.boxL - partMetrics(prof, cur.part).volMl / 2000 - f.flashL, 0);
      })();
  const mix = plasterMix(Math.max(litres, 0.001), ps.wr);
  const cost = p.priceRub && p.packKg ? mix.plasterKg * (p.priceRub / p.packKg) : null;

  box.innerHTML = `
    <label class="field-row"><span>Марка</span>
      <select id="castPlasterSel" aria-label="Марка гипса">
        ${PLASTERS.map(x => `<option value="${x.id}"${x.id === ps.id ? ' selected' : ''}>
          ${esc(x.name)} · ${esc(x.vendor)}</option>`).join('')}
      </select></label>
    <p class="hint">${esc(p.grade)} · прочность <b>${p.strengthMPa} МПа</b> ·
      схватывание ${p.setMin.map(dec).join('–')} мин<br>
      <span class="dim">${esc(p.note)}</span></p>
    <label class="field-row"><span>Воды на 100 частей гипса</span>
      <input type="number" id="castPlasterWR" min="40" max="120" step="1" value="${ps.wr}"
             inputmode="numeric"><i class="unit">%</i></label>
    ${p.waterRatio == null
      ? '<p class="dim">В/Г поставщик не публикует — подберите под свою мастерскую и впишите.</p>'
      : ''}
    <dl class="spec">
      <dt>На «${esc(cur.name.toLowerCase())}»</dt>
      <dd><b>${num(mix.plasterKg, 1)} кг</b> гипса и <b>${num(mix.waterL, 1)} л</b> воды
        <span class="dim">(${num(litres, 2)} л тела формы)</span></dd>
      ${cost ? `<dt>Материал</dt><dd>≈ ${rub(cost)} по цене
        ${Math.round(p.priceRub / p.packKg)} ₽/кг</dd>` : ''}
    </dl>
    <p class="note">Замешать и разлить надо за ${dec(p.setMin[0])}–${dec(p.setMin[1])} минут:
      после конца схватывания раствор уже не течёт. Марка и замес общие на всю оснастку —
      те же числа стоят в «Оснастке».</p>`;

  $('castPlasterSel').onchange = e => {
    const np = plasterById(e.target.value);
    state.plaster = {...ps, id: e.target.value, ...(np && np.waterRatio != null ? {wr: np.waterRatio} : {})};
    emit();
  };
  $('castPlasterWR').oninput = e => {
    const v = parseFloat(e.target.value);
    if (!isFinite(v) || v < 20 || v > 200) return;
    state.plaster = {...plasterNow(), wr: v};
    emit();
  };
}

/* Сохранить STL: один ярус или все части комплекта. */
function saveTiers(cur, only) {
  const cm = castMouldNumbers(state, cur.subject);
  const tag = cur.id === 'ware' ? 'форма' : `форма-${cur.name.toLowerCase()}`;
  let n = 0;
  for (let i = 0; i < cm.tiers; i++) {
    if (only !== null && only !== undefined && i !== only) continue;
    for (const [half, suffix] of [['bump', 'бугорки'], ['socket', 'лунки']]) {
      const m = castMouldGeometry(state, {half, tier: i, subject: cur.subject});
      const name = cm.tiers > 1 ? `${tag}-ярус${i + 1}-${suffix}` : `${tag}-${suffix}`;
      exportGeoSTL(state, m.geometry, name);
      m.geometry.dispose();
      n++;
    }
  }
  toast(`Сохранено частей: ${n}`);
}

function bindMould(cur) {
  const box = $('castFormBody');
  const stop = $('castStop');
  if (stop) stop.onclick = stopPreview;

  if (cur.kind === 'lathe') {
    box.querySelectorAll('[data-tier-show]').forEach(b => {
      b.onclick = () => showMesh(
        castMouldGeometry(state, {half: 'bump', tier: +b.dataset.tierShow, subject: cur.subject}).geometry,
        `${cur.name}, половина формы${castMouldNumbers(state, cur.subject).tiers > 1
          ? `, ярус ${+b.dataset.tierShow + 1}` : ''}: разъём вверх, замки бугорками`);
    });
    box.querySelectorAll('[data-tier-stl]').forEach(b => {
      b.onclick = () => saveTiers(cur, +b.dataset.tierStl);
    });
    const all = $('castStl');
    if (all) all.onclick = () => saveTiers(cur, null);
    return;
  }

  const prof = userProfileMM(state);
  const show = box.querySelector('[data-pm-show]');
  if (show) show.onclick = () => showMesh(
    partMouldGeometry(prof, cur.part, MOULD_WALL, {half: 'bump'}).geometry,
    `Половина формы под «${cur.name.toLowerCase()}»: разъём вверх, замки бугорками, вокруг детали облойная канавка`);
  const stl = box.querySelector('[data-pm-stl]');
  if (stl) stl.onclick = () => {
    for (const [half, suffix] of [['bump', '1-бугорки'], ['socket', '2-лунки']]) {
      const m = partMouldGeometry(prof, cur.part, MOULD_WALL, {half});
      exportGeoSTL(state, m.geometry, `форма-${cur.name.toLowerCase()}-${suffix}`);
      m.geometry.dispose();
    }
    toast('Обе половины формы сохранены: замки бугорками и лунками');
  };
}

/**
 * @param a {dryG, cavityL, plasterKg, parts} — приходят из общего расчёта панели
 */
export function renderCasting(a) {
  const {list, cur} = subjects();
  renderPick(list, cur);

  const form = $('castFormBody');
  if (form) {
    form.innerHTML = cur.kind === 'lathe' ? renderLatheMould(cur) : renderPartMould(cur);
    bindMould(cur);
  }
  renderPlaster(cur);

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
