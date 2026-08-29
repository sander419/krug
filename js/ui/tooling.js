// file: js/ui/tooling.js
// Вкладка «Оснастка»: годится ли форма под серийное производство, какой процесс,
// какой пресс нужен, сколько комплектов форм на тираж. Техкарта выгружается файлом.
import { state } from '../core/state.js';
import { onChange, emit as emitRefresh } from '../core/bus.js';
import { computeProduction } from '../core/math.js';
import { partsHandMinutes, partMetrics } from '../core/parts.js';
import { userProfileMM } from '../core/math.js';
import { kindOf } from '../config/parts.js';
import { analyzeFormability, recommendProcess, checks, toolingNumbers,
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
import { partMouldGeometry, partMouldBlock, partMouldFeatures } from '../three/partMould.js';
import { partSelfOverlap } from '../core/parts.js';
import { byId as materialById } from '../config/materials.js';
import { download, fileName } from '../core/files.js';
import { toast } from './overlays.js';
import { openArticle } from './kb.js';


let manualProc = null;      // выбран руками — не перебиваем рекомендацией
let batch = 500;
let part = 'ware';          // что показывать в 3D
const econ = {...ECON_DEFAULTS};
const mould = {...MOULD_DEFAULTS};
let plasterId = PLASTERS[0].id;
let waterRatio = 70;      // частей воды на 100 частей гипса

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

  $('toolNumbers').innerHTML = `
    <dl class="spec">
      <dt>Модель оснастки</dt><dd>${num(n.model.H)} × ⌀${num(n.model.D)} мм — это сырой размер, то что нарисовано</dd>
      <dt>После обжига</dt><dd>${num(n.fired.H)} × ⌀${num(n.fired.D)} мм</dd>
      <dt>Коэффициент усадки</dt><dd>×${n.shrink.k.toFixed(4)} <span class="dim">(${esc(mat.name)}, усадка ${mat.shrinkPct} %${n.shrink.split ? ', сушка и обжиг раздельно' : ''})</span></dd>
      <dt>Проекционная площадь</dt><dd>${num(n.projAreaMM2 / 100)} см²</dd>
      ${forceRow}
      <dt>Масса изделия</dt><dd>${num(n.pieceG, 0)} г</dd>
      <dt>Заготовка с облоем</dt><dd>${num(n.blankG, 0)} г <span class="dim">(+${n.flashPct} %)</span></dd>
      <dt>Разъём формы</dt><dd>высота ${num(n.partingY, 0)} мм · частей ${n.parts}</dd>
      <dt>Оснастка</dt><dd>${esc(proc.tooling)}</dd>
    </dl>`;

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

  renderEconomics(prod, procId, mat);

  $('toolSrc').innerHTML = proc.src.map(s =>
    `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join('<br>');
}


function renderPlaster(stock) {
  const p = plasterById(plasterId);
  const known = p.waterRatio != null;
  $('plasterNote').innerHTML =
    `${esc(p.grade)} · прочность <b>${p.strengthMPa} МПа</b> · схватывание ${p.setMin.map(dec).join('–')} мин` +
    `<br><span class="dim">${esc(p.note)}</span>` +
    (known ? '' : '<br><span class="dim">Водогипсовое отношение поставщик не публикует — подберите под свою задачу и впишите.</span>');

  const mix = plasterMix(stock.netLitres, waterRatio);
  const cost = p.priceRub && p.packKg ? mix.plasterKg * (p.priceRub / p.packKg) : null;
  $('plasterMix').innerHTML =
    `На матрицу нужно <b>${num(mix.plasterKg, 1)} кг</b> гипса и <b>${num(mix.waterL, 1)} л</b> воды ` +
    `<span class="dim">(тело формы ${num(stock.netLitres, 1)} л без полости)</span>` +
    (cost ? `<br>Материал формы ≈ ${rub(cost)} по цене ${Math.round(p.priceRub / p.packKg)} ₽/кг` : '') +
    `<br><span class="dim">Замешать и разлить надо за ${dec(p.setMin[0])}–${dec(p.setMin[1])} минут: после конца схватывания раствор уже не течёт.</span>` +
    partsMouldHTML(waterRatio, p);
  bindPartMoulds();
}

const MOULD_WALL = 20;      // мм гипса вокруг детали

const partVolumeL = (prof, p) => partMetrics(prof, p).volMl / 1000;
let partPreview = null;      // прилеп, чью форму сейчас показываем

/* Прилепы формуются отдельно от корпуса: у каждого своя форма из двух половин.
   Половину можно посмотреть в 3D и выгрузить в STL — это уже тело с канавкой,
   а не прикидка габарита. */
function partsMouldHTML(waterRatio, plaster) {
  const list = (state.parts || []).filter(p => !kindOf(p).deform);
  if (!list.length) return '';
  const prof = userProfileMM(state);
  let total = 0;
  const rows = list.map((p, i) => {
    // деталь, вошедшая сама в себя, канавкой не отпечатывается: форму под неё
    // не строим и кнопок не даём, чтобы наружу не ушёл рваный STL
    if (partSelfOverlap(prof, p))
      return `<li>${kindOf(p).name} ${i + 1}: форма не строится — деталь пересекает сама себя.
        Уменьшите сечение или разведите прилепы.</li>`;
    const m = partMouldBlock(prof, p, MOULD_WALL);
    const f = partMouldFeatures(prof, p, MOULD_WALL);
    // бугорки замков на одной половине и лунки на другой взаимно гасятся,
    // а облойная канавка убавляет гипс на каждой
    const halfL = Math.max(m.boxL - partVolumeL(prof, p) / 2 - f.flashL, 0);
    const mix = plasterMix(halfL, waterRatio);
    total += mix.plasterKg * 2;
    return `<li>${kindOf(p).name} ${i + 1}: блок ${m.blockMM.map(v => Math.round(v)).join('×')} мм на половину,
      гипса <b>${num(mix.plasterKg, 1)} кг</b> на каждую, замков ${f.keys}
      <button class="btn small" data-mould-show="${i}">Показать</button>
      <button class="btn small" data-mould-stl="${i}">STL</button></li>`;
  }).join('');
  return `<br><span class="dim">Формы под прилепы: две половины, разъём по плоскости детали.</span>
    <ul class="parts-moulds">${rows}</ul>
    <span class="dim">Итого на комплект ${num(total, 1)} кг гипса. Замки и облойная канавка
    построены; штифты и воздушные каналы — нет, их сверлят по месту под конкретный пресс.
    Ресурс таких форм не подтверждён: их меняют по состоянию, а не по числу циклов.</span>`;
}

/* Кнопки «показать» и «STL» у форм под прилепы. Вешаются после каждой
   перерисовки: разметка блока пересобирается целиком. */
function bindPartMoulds() {
  const list = (state.parts || []).filter(p => !kindOf(p).deform);
  const prof = userProfileMM(state);
  $('plasterMix').querySelectorAll('[data-mould-show]').forEach(b => {
    b.onclick = () => {
      const p = list[+b.dataset.mouldShow];
      if (!p) return;
      partPreview = partPreview === p ? null : p;
      if (partPreview) {
        part = 'ware';
        sceneAPI.setPreviewMesh(partMouldGeometry(prof, p, MOULD_WALL, {half: 'bump'}).geometry);
        toast(`Половина формы под «${kindOf(p).name.toLowerCase()}»: разъём вверх, замки бугорками, вокруг детали облойная канавка`);
      } else {
        sceneAPI.setPreviewMesh(null);
      }
      emitRefresh();
      render();
    };
  });
  $('plasterMix').querySelectorAll('[data-mould-stl]').forEach(b => {
    b.onclick = () => {
      const p = list[+b.dataset.mouldStl];
      if (!p) return;
      const name = kindOf(p).name.toLowerCase();
      for (const [half, suffix] of [['bump', '1-бугорки'], ['socket', '2-лунки']]) {
        const m = partMouldGeometry(prof, p, MOULD_WALL, {half});
        exportGeoSTL(state, m.geometry, `форма-${name}-${suffix}`);
        m.geometry.dispose();
      }
      toast('Обе половины формы сохранены: замки бугорками и лунками');
    };
  });
}

function renderEconomics(prod, procId, mat) {
  const ec = economics(state, prod, procId, {...econ, batch});
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
    b.onclick = () => { part = b.dataset.part; partPreview = null; sceneAPI.setPreviewMesh(null); applyPreview(); render(); };
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
  sel.value = plasterId;
  const applyPlaster = () => {
    const p = plasterById(plasterId);
    if (p.waterRatio != null) waterRatio = p.waterRatio;
    $('plasterWR').value = waterRatio;
    render();
  };
  sel.addEventListener('change', () => { plasterId = sel.value; applyPlaster(); });
  $('plasterWR').addEventListener('input', () => {
    const v = parseFloat($('plasterWR').value);
    if (!isFinite(v) || v < 20 || v > 200) return;
    waterRatio = v;
    render();
  });
  applyPlaster();

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
    const wp = wareProfiles(state);
    const roller = rollerProfile(state);
    const layers = [
      {name: 'IZDELIE', color: 1, points: wp.outer, closed: false},
      {name: 'STENKA', color: 3, points: wp.inner, closed: false},
      {name: 'MATRICA', color: 5, points: cavityPath(state, mould), closed: true},
    ];
    if (roller) layers.push({name: 'ROLIK', color: 2, points: roller, closed: false});
    const mat = materialById(state.mat);
    const notes = [
      `KRUG: ${state.name || 'izdelie'} — profili osnastki, mm, syroy razmer`,
      `Massa: ${mat.name} (${mat.vendor}), usadka ${mat.shrinkPct}%`,
      `IZDELIE - naruzhnaya poverhnost, STENKA - vnutrennyaya (profil rolika),`,
      `MATRICA - sechenie nizhney poluformy. X = radius, Y = vysota.`,
    ];
    download(new Blob([buildDXF(layers, notes)], {type: 'application/dxf'}), fileName(state, 'профили.dxf'));
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
    const an = analyzeFormability(state);
    const prod = computeProduction(state);
    const text = techCard(state, prod, an, currentProcId(an), batch, econ, {mould, plasterId, waterRatio});
    download(new Blob([text], {type: 'text/markdown'}), fileName(state, 'техкарта.md'));
    toast('Техкарта сохранена');
  };
  onChange(render);      // рецепт изменился — пересчитать оснастку
  render();
}

