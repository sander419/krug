// file: js/ui/tooling.js
// Вкладка «Оснастка»: годится ли форма под серийное производство, какой процесс,
// какой пресс нужен, сколько комплектов форм на тираж. Техкарта выгружается файлом.
import { state } from '../core/state.js';
import { onChange, emit as emitRefresh } from '../core/bus.js';
import { computeProduction } from '../core/math.js';
import { analyzeFormability, recommendProcess, checks, toolingNumbers,
         batchPlan, techCard, rawForTarget, firedFromRaw } from '../core/tooling.js';
import { PROCESSES, byId as processById } from '../config/processes.js';
import { MOULD_DEFAULTS, modelPath, cavityPath, corePath, rollerProfile,
         cavityStock, wareProfiles } from '../core/mould.js';
import { buildDXF } from '../core/dxf.js';
import { economics, ECON_DEFAULTS, pricePerKg } from '../core/economics.js';
import { sceneAPI } from '../three/scene.js';
import { exportPathSTL } from '../three/exporters.js';
import { byId as materialById } from '../config/materials.js';
import { download, fileName } from '../core/files.js';
import { toast } from './overlays.js';
import { openArticle } from './kb.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ru');

let manualProc = null;      // выбран руками — не перебиваем рекомендацией
let batch = 500;
let part = 'ware';          // что показывать в 3D
const econ = {...ECON_DEFAULTS};
const mould = {...MOULD_DEFAULTS};

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
    `Габарит матрицы: ⌀${num(stock.radiusMM * 2, 0)} × ${num(stock.heightMM, 0)} мм, ` +
    `объём блока <b>${num(stock.grossLitres, 1)} л</b> за вычетом полости под изделие ` +
    `<span class="dim">(расход гипса считайте по своей марке и соотношению с водой)</span>`;
  document.querySelectorAll('#toolPartSeg button').forEach(b =>
    b.classList.toggle('active', b.dataset.part === part));

  renderEconomics(prod, procId, mat);

  $('toolSrc').innerHTML = proc.src.map(s =>
    `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join('<br>');
}

const rub = v => Math.round(v).toLocaleString('ru') + ' ₽';

function renderEconomics(prod, procId, mat) {
  const ec = economics(state, prod, procId, {...econ, batch});
  const priceRow = ec.perKg == null
    ? `<dt>Материал</dt><dd class="dim">цена этой массы в реестре не указана</dd>`
    : `<dt>Материал</dt><dd>${num(ec.perKg, 0)} ₽/кг · ${rub(ec.matMachine)} на изделие <span class="dim">(заготовка ${num(ec.blankKg, 2)} кг)</span></dd>`;

  let verdict, cls = '';
  if (ec.cheaper === 'machine') {
    cls = 'win';
    verdict = `На тираже ${num(batch, 0)} шт оснастка дешевле ручного круга на <b>${rub(ec.manualTotal - ec.machineTotal)}</b>.`;
  } else if (ec.breakEven) {
    verdict = `На ${num(batch, 0)} шт дешевле руками. Оснастка начинает окупаться с <b>${num(ec.breakEven, 0)} шт</b>.`;
  } else {
    verdict = `На этих цифрах оснастка не окупается ни при каком тираже: машинный цикл не даёт выигрыша перед руками.`;
  }

  $('econOut').innerHTML = `
    <dl class="spec">
      ${priceRow}
      <dt>Машиной</dt><dd><b>${rub(ec.machinePerPiece)}</b> за штуку · ${rub(ec.machineTotal)} за партию</dd>
      <dt>Руками</dt><dd><b>${rub(ec.manualPerPiece)}</b> за штуку · ${rub(ec.manualTotal)} за партию</dd>
      <dt>Время</dt><dd>${num(ec.machineHours, 1)} ч машиной · ${num(ec.manualHours, 0)} ч руками <span class="dim">(${num(ec.shifts, 1)} смены)</span></dd>
      <dt>Глина</dt><dd>${num(ec.clayKgMachine, 0)} кг на партию</dd>
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
    b.onclick = () => { part = b.dataset.part; applyPreview(); render(); };
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
    const text = techCard(state, prod, an, currentProcId(an), batch, econ);
    download(new Blob([text], {type: 'text/markdown'}), fileName(state, 'техкарта.md'));
    toast('Техкарта сохранена');
  };
  onChange(render);      // рецепт изменился — пересчитать оснастку
  render();
}

export const syncTooling = render;
