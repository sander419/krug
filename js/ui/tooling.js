// file: js/ui/tooling.js
// Вкладка «Оснастка»: годится ли форма под серийное производство, какой процесс,
// какой пресс нужен, сколько комплектов форм на тираж. Техкарта выгружается файлом.
import { state } from '../core/state.js';
import { onChange, emit as emitRefresh } from '../core/bus.js';
import { computeProduction } from '../core/math.js';
import { partsHandMinutes, partMetrics } from '../core/parts.js';
import { userProfileMM } from '../core/math.js';
import { kindOf } from '../config/parts.js';
import { analyzeFormability, recommendProcess, checks, toolingNumbers, mouldParts,
         batchPlan, techCard, rawForTarget, firedFromRaw } from '../core/tooling.js';
import { PROCESSES, byId as processById } from '../config/processes.js';
import { MOULD_DEFAULTS, modelPath, cavityPath, corePath, rollerProfile,
         cavityStock, wareProfiles } from '../core/mould.js';
import { buildDXF } from '../core/dxf.js';
import { PLASTERS, byId as plasterById, plasterMix } from '../config/plasters.js';
import { $, esc, num, dec, rub } from './dom.js';
import { economics, ECON_DEFAULTS, pricePerKg } from '../core/economics.js';
import { sceneAPI } from '../three/scene.js';
import { exportPathSTL, exportGeoSTL } from '../three/exporters.js';
import { kilnPerItem } from './kiln.js';
import { renderCasting } from './casting.js';
import { markExported } from './next.js';
import { partCurve } from '../core/parts.js';
import { encodeDNA } from '../core/state.js';
import { castingPlan } from '../core/casting.js';
import { buildSheet } from '../core/sheet.js';
import { sanitizeLid, lidMetrics } from '../core/lid.js';
import { byId as materialById, density } from '../config/materials.js';
import { download, fileName } from '../core/files.js';
import { toast } from './overlays.js';
import { openArticle } from './kb.js';


let manualProc = null;      // выбран руками — не перебиваем рекомендацией
let batch = 500;
let part = 'ware';          // что показывать в 3D
const econ = {...ECON_DEFAULTS};
const mould = {...MOULD_DEFAULTS};
/* Марка гипса и замес живут в состоянии (js/core/state.js): один и тот же гипс
   идёт и на матрицу под штамповку, и на форму под отливку, и выбор уезжает
   в ссылку вместе с рецептом. */
const plasterState = () => ({id: 'gvvs-16', wr: 70, ...(state.plaster || {})});

const PART_NOTE = {
  ware:  'В сцене изделие. Переключите, чтобы посмотреть оснастку — этапы «Кинотеатра» при этом не показываются.',
  model: 'Модель (болван) — само изделие сплошным телом, по нему формуют гипс. Сырой размер.',
  lower: 'Матрица: блок с полостью по наружной поверхности. Она же — гипсовая форма для роликового формования.',
  upper: 'Пуансон: выступ по внутренней поверхности изделия. Зазор между полуформами и есть стенка сырца.',
};

function partPath(id) {
  if (id === 'model') return modelPath(state);
  if (id === 'lower') return cavityPath(state, mould);
  if (id === 'upper') return corePath(state, mould);
  return null;
}

function applyPreview() {
  sceneAPI.setPreviewPath(partPath(part));
  emitRefresh();
}


function currentProcId(an) {
  if (manualProc) return manualProc;
  return recommendProcess(state, an).id;
}

function processChipsHTML(recId) {
  return PROCESSES.map(p => {
    const cls = p.id === recId ? ' active' : '';
    const rec = (!manualProc && p.id === recId) ? '<i class="rec">рекомендую</i>' : '';
    return `<button class="chip-btn${cls}" data-proc="${p.id}" title="${esc(p.what)}">${esc(p.short)}${rec}</button>`;
  }).join('');
}

function render() {
  const an = analyzeFormability(state);
  const rec = recommendProcess(state, an);
  const procId = currentProcId(an);
  const proc = processById(procId);
  const prod = computeProduction(state);
  const n = toolingNumbers(state, prod, an, procId);
  const ch = checks(state, an, procId);
  const bp = batchPlan(procId, batch);
  const mat = materialById(state.mat);

  $('toolProcs').innerHTML = processChipsHTML(procId);
  $('toolProcs').querySelectorAll('[data-proc]').forEach(b => {
    b.onclick = () => { manualProc = b.dataset.proc; render(); };
  });

  const worst = ch.some(c => c.lvl === 'bad') ? 'bad' : ch.some(c => c.lvl === 'warn') ? 'warn' : 'ok';
  const verdict = worst === 'bad' ? 'Процесс не подходит для этой формы'
                : worst === 'warn' ? 'Годится с оговорками'
                : 'Форма технологична для этого процесса';

  $('toolVerdict').className = 'tool-verdict ' + worst;
  $('toolVerdict').innerHTML = `<b>${esc(proc.name)}</b><span>${esc(verdict)}</span>`;

  $('toolWhy').innerHTML = (manualProc ? [`Процесс выбран вручную. Рекомендация инструмента — «${esc(processById(rec.id).short)}».`] : rec.why.map(esc))
    .map(t => `<div class="tool-why">${t}</div>`).join('');

  $('toolChecks').innerHTML = ch.map(c =>
    `<div class="warn-item ${c.lvl}"><i></i><span>${esc(c.txt)}</span>` +
    (c.help ? `<button class="why" data-help="${c.help}">почему</button>` : '') + '</div>').join('');
  $('toolChecks').querySelectorAll('[data-help]').forEach(b => {
    b.onclick = () => openArticle(b.dataset.help);
  });

  const forceRow = n.forceKN
    ? `<dt>Усилие пресса</dt><dd><b>${num(n.forceTons[0])}–${num(n.forceTons[1])} тс</b> (${num(n.forceKN[0])}–${num(n.forceKN[1])} кН) при ${proc.pressureMPa[0]}–${proc.pressureMPa[1]} МПа</dd>`
    : `<dt>Давление</dt><dd class="dim">${esc(proc.pressureNote)}</dd>`;

  const mp = mouldParts(procId, an);
  $('toolNumbers').innerHTML = `
    <dl class="spec">
      <dt>Коэффициент усадки</dt><dd>×${n.shrink.k.toFixed(4)} <span class="dim">(${esc(mat.name)}, усадка ${mat.shrinkPct} %${n.shrink.split ? ', сушка и обжиг раздельно' : ''})</span></dd>
      <dt>Проекционная площадь</dt><dd>${num(n.projAreaMM2 / 100)} см²</dd>
      ${forceRow}
      <dt>Заготовка с облоем</dt><dd>${num(n.blankG, 0)} г <span class="dim">(+${n.flashPct} %)</span> — изделие ${num(n.pieceG, 0)} г</dd>
      <dt>Разъём формы</dt><dd>${mp.vertical
        ? `вертикальный, через ось · частей ${mp.parts}`
        : `высота ${num(n.partingY, 0)} мм · частей ${mp.parts}`}</dd>
      <dt>Оснастка</dt><dd>${esc(proc.tooling)}</dd>
    </dl>
    <p class="hint">Габариты сырые и после обжига, масса изделия и вместимость стоят
      в строке метрик под рабочей областью — здесь только то, чего там нет.</p>`;

  $('toolBatchOut').innerHTML = bp.known
    ? `Ресурс формы ${bp.lo}–${bp.hi} циклов → нужно <b>${bp.setsLo}–${bp.setsHi}</b> комплектов оснастки на ${batch} шт`
    : `<span class="dim">Ресурс оснастки для «${esc(proc.short)}» источником не подтверждён — уточняйте у изготовителя форм.</span>`;

  const t = $('toolTarget');
  if (t && document.activeElement !== t) t.value = Math.round(firedFromRaw(state.D, mat));
  $('toolTargetOut').innerHTML = t && +t.value > 0
    ? `Чтобы после обжига получить ⌀${num(+t.value, 0)} мм, на круге нужен ⌀<b>${num(rawForTarget(+t.value, mat), 1)}</b> мм`
    : '';

  const stock = cavityStock(state, mould);
  const wp = wareProfiles(state);
  $('toolPartNote').textContent = PART_NOTE[part];
  $('toolStock').innerHTML =
    `Габарит матрицы: <b>⌀${num(stock.radiusMM * 2, 0)} × ${num(stock.heightMM, 0)} мм</b>. ` +
    `Блок ${num(stock.grossLitres, 1)} л, тело формы <b>${num(stock.netLitres, 1)} л</b> ` +
    `<span class="dim">(за вычетом полости под изделие)</span>`;
  document.querySelectorAll('#toolPartSeg button').forEach(b =>
    b.classList.toggle('active', b.dataset.part === part));
  renderPlaster(stock);
  /* Литьё считается по тем же числам, что уже посчитаны для формы: сухая масса
     черепка, внешний объём тела (в него льют) и масса гипса самой формы. */
  renderCasting({
    dryG: prod.massF,
    cavityL: (prod.volMl + prod.capMl) / 1000,
    plasterKg: plasterMix(stock.netLitres, plasterState().wr).plasterKg,
    parts: an.parts,
  });

  renderEconomics(prod, procId, mat);

  $('toolSrc').innerHTML = proc.src.map(s =>
    `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join('<br>');
}


/* Техкарта текстом. Считает ту же себестоимость, что и панель: обжиг в неё
   входит. Наружу — для пакета производства. */
export function techCardText() {
  const an = analyzeFormability(state);
  const prod = computeProduction(state);
  return techCard(state, prod, an, currentProcId(an), batch,
    {...econ, firePerPiece: kilnPerItem() || 0},
    {mould, plasterId: plasterState().id, waterRatio: plasterState().wr});
}

/* Профили оснастки в DXF. Наружу по той же причине, что и лист: пакет
   производства собирает те же файлы, что и отдельные кнопки. */
export function dxfText() {
  const wp = wareProfiles(state);
  const roller = rollerProfile(state);
  const layers = [
    {name: 'IZDELIE', color: 1, points: wp.outer, closed: false},
    {name: 'STENKA', color: 3, points: wp.inner, closed: false},
    {name: 'MATRICA', color: 5, points: cavityPath(state, mould), closed: true},
  ];
  if (roller) layers.push({name: 'ROLIK', color: 2, points: roller, closed: false});
  const mat = materialById(state.mat);
  return buildDXF(layers, [
    `KRUG: ${state.name || 'izdelie'} — profili osnastki, mm, syroy razmer`,
    `Massa: ${mat.name} (${mat.vendor}), usadka ${mat.shrinkPct}%`,
    `IZDELIE - naruzhnaya poverhnost, STENKA - vnutrennyaya (profil rolika),`,
    `MATRICA - sechenie nizhney poluformy. X = radius, Y = vysota.`,
  ]);
}

/* Лист для производства: собираем модель из тех же чисел, что показывает панель.
   Вида три, а источник один — иначе чертёж и экран разойдутся.
   Наружу — потому что тот же лист кладётся в пакет производства («Выпуск»). */
export function sheetSVG() {
  const prof = userProfileMM(state);
  const prod = computeProduction(state);
  const an = analyzeFormability(state);
  const mat = materialById(state.mat);
  const stock = cavityStock(state, mould);
  const mix = plasterMix(stock.netLitres, plasterState().wr);
  const k = 1 - mat.shrinkPct / 100;
  const fire = kilnPerItem();

  const parts = (state.parts || []).filter(p => !kindOf(p).deform).map((p, i) => {
    const m = partMetrics(prof, p);
    const curve = partCurve(prof, p);
    return {
      name: `${kindOf(p).name} ${i + 1}`, az: p.az, reach: m.reach,
      pts: curve.getPoints(24).map(v => ({x: v.x, y: v.y})),
    };
  });

  const dna = encodeDNA();
  const rows = [
    ['Высота на круге', `${Math.round(state.H)} мм`],
    ['Диаметр', `⌀${Math.round(state.D)} мм`],
    ['Стенка', `${num(state.wall, 1)} мм`],
    ['Масса', mat.name],
    ['После обжига', `${Math.round(state.H * k)}×${Math.round(state.D * k)} мм`],
    ['Усадка', `${num(mat.shrinkPct, 1)} %`],
    ['Обжиг', mat.firing && mat.firing.glazeC ? `${mat.firing.glazeC.join('–')} °C` : '—'],
    ['Масса сырца', `${num(prod.massN / 1000, 2)} кг`],
    ['После обжига, масса', `${num(prod.massF / 1000, 2)} кг`],
    ['Вместимость', `${Math.round(prod.capMl)} мл`],
    ['Способ', processById(currentProcId(an)).short],
    ['Частей формы', String(an.parts)],
    ['Гипса на форму', `${num(mix.plasterKg, 1)} кг`],
    ['Литьё: выдержка', `${num(castingPlan({dryG: prod.massF, cavityL: (prod.volMl + prod.capMl) / 1000,
        plasterKg: mix.plasterKg, wallMM: state.wall, parts: an.parts}, state.cast || {}).hold, 0)} мин`],
    ['Обжиг на изделие', fire ? `${num(fire, 1)} ₽` : '—'],
    ['Прилепов', String(parts.length)],
  ];
  const LD = sanitizeLid(state.lid);
  if (LD.on) {
    const lm = lidMetrics(prof, LD, state.wall, density(mat), mat.shrinkPct);
    rows.push(['Крышка', LD.type === 'inset' ? 'в горловину' : 'внахлёст'],
      ['Поясок крышки', `⌀${num(lm.seatR * 2, 1)} мм`],
      ['Зазор после обжига', `${num(lm.gapFired, 1)} мм`],
      ['Глина на крышку', `${Math.round(lm.massG)} г`]);
  }

  return buildSheet({
    name: state.name || 'Без названия',
    date: new Date().toLocaleDateString('ru'),
    dna: `ДНК ${dna.slice(0, 14)}…${dna.slice(-6)} · полная ссылка — в техкарте`,
    prof: prof.map(q => ({r: q.r, y: q.y})),
    wall: state.wall, footH: state.footH, footR: state.D / 2 * state.footK / 100,
    H: state.H, D: state.D, shrinkPct: mat.shrinkPct,
    parts, rows,
    lid: LD.on ? (() => {
      const lm = lidMetrics(prof, LD, state.wall, density(mat), mat.shrinkPct);
      return {pts: lm.pts, outline: lm.outer, seatD: lm.seatR * 2, seatDFired: lm.firedSeatMM,
              gapFired: lm.gapFired, topY: lm.topY, outD: lm.outR * 2};
    })() : null,
    notes: [
      'Прилепы на видах спереди и в разрезе развёрнуты в плоскость листа; по азимутам они стоят на виде сверху.',
      'Размеры сырые, до обжига: по ним делают форму. Готовое изделие меньше на усадку массы.',
      'Числа посчитаны в КРУГе по паспорту массы; пороги технологичности — умолчания инструмента, а не норматив.',
    ],
  });
}

function renderPlaster(stock) {
  const p = plasterById(plasterState().id);
  const known = p.waterRatio != null;
  /* Гипс общий на всю оснастку, и выбрать его можно на другой вкладке.
     Поэтому поля синхронизируем при каждой перерисовке, а не только при
     запуске: иначе панель показывает одну марку, а числа считаются по другой. */
  const sel = $('plasterSel'), wr = $('plasterWR');
  if (sel && sel.value !== plasterState().id) sel.value = plasterState().id;
  if (wr && +wr.value !== plasterState().wr) wr.value = plasterState().wr;
  $('plasterNote').innerHTML =
    `${esc(p.grade)} · прочность <b>${p.strengthMPa} МПа</b> · схватывание ${p.setMin.map(dec).join('–')} мин` +
    `<br><span class="dim">${esc(p.note)}</span>` +
    (known ? '' : '<br><span class="dim">Водогипсовое отношение поставщик не публикует — подберите под свою задачу и впишите.</span>');

  const mix = plasterMix(stock.netLitres, plasterState().wr);
  const cost = p.priceRub && p.packKg ? mix.plasterKg * (p.priceRub / p.packKg) : null;
  $('plasterMix').innerHTML =
    `На матрицу нужно <b>${num(mix.plasterKg, 1)} кг</b> гипса и <b>${num(mix.waterL, 1)} л</b> воды ` +
    `<span class="dim">(тело формы ${num(stock.netLitres, 1)} л без полости)</span>` +
    (cost ? `<br>Материал формы ≈ ${rub(cost)} по цене ${Math.round(p.priceRub / p.packKg)} ₽/кг` : '') +
    `<br><span class="dim">Замешать и разлить надо за ${dec(p.setMin[0])}–${dec(p.setMin[1])} минут: после конца схватывания раствор уже не течёт.</span>` +
    /* Формы под прилепы уехали на вкладку «Отливка»: они формуются так же,
       как форма корпуса, и человеку нужны в одном месте, а не среди гипса
       для матрицы, где их никто не находил. */
    `<br><span class="dim">Формы под ручки и носики — на вкладке «Отливка»: там же форма корпуса,
      крышки и гипс на каждую.</span>`;
}

function renderEconomics(prod, procId, mat) {
  // обжиг — такая же статья себестоимости, как глина и труд
  const fire = kilnPerItem();
  const ec = economics(state, prod, procId, {...econ, batch, firePerPiece: fire || 0});
  const proc = processById(procId);
  const priceRow = ec.perKg == null
    ? `<dt>Материал</dt><dd class="dim">цена этой массы в реестре не указана</dd>`
    : `<dt>Материал</dt><dd>${num(ec.perKg, 0)} ₽/кг · ${rub(ec.matMachine)} на изделие <span class="dim">(заготовка ${num(ec.blankKg, 2)} кг)</span></dd>`;

  let verdict, cls = '';
  if (ec.cheaper === 'machine') {
    cls = 'win';
    verdict = `На тираже ${num(batch, 0)} шт оснастка дешевле ручного круга на <b>${rub(ec.manualTotal - ec.machineTotal)}</b>.`;
  } else if (ec.breakEven) {
    verdict = `На ${num(batch, 0)} шт дешевле руками. Оснастка начинает окупаться с <b>${num(ec.breakEven, 0)} шт</b>.`;
  } else if (ec.sets.known && ec.sets.hi > 1) {
    verdict = `Оснастка не окупается: форма живёт ${proc.mouldLife[0]}–${proc.mouldLife[1]} циклов, и на партию нужно <b>${ec.sets.lo}–${ec.sets.hi}</b> комплектов. Её стоимость растёт вместе с тиражом, а не размазывается по нему. Проверьте цену комплекта: у гипсовой формы она совсем не та, что у пресс-формы.`;
  } else {
    verdict = `На этих цифрах оснастка не окупается ни при каком тираже: машинный цикл не даёт выигрыша перед руками.`;
  }

  /* прилепы не формуются вместе с корпусом: это ручная работа поверх любой машины */
  const nParts = (state.parts || []).length;
  const handMin = partsHandMinutes(state.parts);
  const partsRow = nParts ? `<dt>Прилепы</dt><dd>${nParts} шт · <b>${handMin} мин</b> ручной сборки
      на изделие, ${num(handMin * batch / 60, 0)} ч на партию — сверх любого способа формовки.
      Потолок ручной сборки ${Math.floor(60 / handMin)} шт/ч.</dd>` : '';

  $('econOut').innerHTML = `
    <dl class="spec">
      ${priceRow}
      <dt>Оснастка</dt><dd>${ec.sets.known ? `${ec.sets.lo}–${ec.sets.hi} комплектов` : '1 комплект'} · ${rub(ec.toolingTotal)} <span class="dim">(ресурс ${ec.sets.known ? proc.mouldLife.join('–') + ' циклов' : 'не подтверждён'})</span></dd>
      <dt>Машиной</dt><dd><b>${rub(ec.machinePerPiece)}</b> за штуку · ${rub(ec.machineTotal)} за партию</dd>
      <dt>Руками</dt><dd><b>${rub(ec.manualPerPiece)}</b> за штуку · ${rub(ec.manualTotal)} за партию</dd>
      <dt>Время</dt><dd>${num(ec.machineHours, 1)} ч машиной · ${num(ec.manualHours, 0)} ч руками <span class="dim">(${num(ec.shifts, 1)} смены)</span></dd>
      <dt>Глина</dt><dd>${num(ec.clayKgMachine, 0)} кг на партию</dd>
      <dt>Обжиг</dt><dd>${fire
        ? `${rub(ec.firePerPiece)} за штуку · ${rub(ec.fireTotal)} за партию <span class="dim">(из садки: см. «Печь и садка»)</span>`
        : '<span class="dim">не посчитан: изделие не входит в выбранную печь</span>'}</dd>
      ${partsRow}
    </dl>
    <div class="econ-verdict ${cls}">${verdict}</div>`;
}

export function initTooling() {
  $('toolBatch').value = batch;
  $('toolBatch').addEventListener('input', e => {
    batch = Math.max(1, Math.min(1e7, parseInt(e.target.value, 10) || 1));
    render();
  });
  $('toolAuto').onclick = () => { manualProc = null; render(); };
  $('toolTarget').addEventListener('input', render);
  $('toolApply').onclick = () => {
    const target = parseFloat($('toolTarget').value);
    if (!isFinite(target) || target <= 0) { toast('Введите нужный диаметр после обжига'); return; }
    const mat = materialById(state.mat);
    const raw = rawForTarget(target, mat);
    if (raw < 50 || raw > 400) { toast('Такой размер вне диапазона ползунка: 5–40 см на круге'); return; }
    state.D = raw;
    const sl = $('diamSl');
    sl.value = raw / 10;
    sl.dispatchEvent(new Event('input'));
    toast(`Диаметр на круге ${num(raw, 1)} мм — после обжига будет ⌀${num(target, 0)} мм`);
  };
  $('toolPartSeg').querySelectorAll('button').forEach(b => {
    b.onclick = () => { part = b.dataset.part; sceneAPI.setPreviewMesh(null); applyPreview(); render(); };
  });
  for (const [id, key] of [['mouldWall', 'wallMM'], ['mouldBase', 'baseMM'], ['mouldRim', 'rimMM']]) {
    const el = $(id);
    el.value = mould[key];
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!isFinite(v)) return;
      mould[key] = Math.max(0, v);
      if (part !== 'ware') applyPreview();
      render();
    });
  }
  const sel = $('plasterSel');
  sel.innerHTML = PLASTERS.map(p => `<option value="${p.id}">${esc(p.name)} · ${esc(p.vendor)}</option>`).join('');
  sel.value = plasterState().id;
  const applyPlaster = () => {
    const p = plasterById(plasterState().id);
    // у марки есть паспортное В/Г — берём его, чужое число здесь не выдумываем
    if (p.waterRatio != null) state.plaster = {...plasterState(), wr: p.waterRatio};
    $('plasterWR').value = plasterState().wr;
    emitRefresh();
  };
  sel.addEventListener('change', () => {
    state.plaster = {...plasterState(), id: sel.value};
    applyPlaster();
  });
  $('plasterWR').addEventListener('input', () => {
    const v = parseFloat($('plasterWR').value);
    if (!isFinite(v) || v < 20 || v > 200) return;
    state.plaster = {...plasterState(), wr: v};
    emitRefresh();
  });
  $('plasterSel').value = plasterState().id;
  $('plasterWR').value = plasterState().wr;

  const stl = (kind, suffix) => () => {
    const path = partPath(kind);
    if (!path) { toast('Для этой формы деталь не строится: нужна полая форма'); return; }
    exportPathSTL(state, path, suffix);
    toast(`${suffix} · сырой размер в мм`);
  };
  $('toolStlModel').onclick = stl('model', 'модель');
  $('toolStlLower').onclick = stl('lower', 'матрица');
  $('toolStlUpper').onclick = stl('upper', 'пуансон');
  $('toolDxf').onclick = () => {
    download(new Blob([dxfText()], {type: 'application/dxf'}), fileName(state, 'профили.dxf'));
    toast('DXF сохранён: профили изделия, стенки, ролика и сечение матрицы');
  };
  for (const [id, key] of [['econCycle', 'cycleSec'], ['econTool', 'toolingCostRub'],
                           ['econRate', 'labourRubPerHour'], ['econManual', 'manualPerHour']]) {
    const el = $(id);
    el.value = econ[key];
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!isFinite(v) || v < 0) return;
      econ[key] = v;
      render();
    });
  }
  $('toolCard').onclick = () => {
    download(new Blob([techCardText()], {type: 'text/markdown'}), fileName(state, 'техкарта.md'));
    markExported();
    toast('Техкарта сохранена');
  };
  /* Кнопка листа живёт в меню «Экспорт» в шапке: лист нужен из любой задачи,
     а вкладка «Оснастка» есть не у всех. Обработчик остался здесь — рядом
     с расчётом, который лист и собирает. */
  const sheetBtn = $('sheetBtn');
  if (sheetBtn) sheetBtn.onclick = () => {
    download(new Blob([sheetSVG()], {type: 'image/svg+xml'}), fileName(state, 'схема.svg'));
    markExported();
    toast('Схема сохранена: три вида, размеры и таблица данных');
  };
  onChange(render);      // рецепт изменился — пересчитать оснастку
  render();
}

