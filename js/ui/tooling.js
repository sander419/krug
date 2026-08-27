// file: js/ui/tooling.js
// Вкладка «Оснастка»: годится ли форма под серийное производство, какой процесс,
// какой пресс нужен, сколько комплектов форм на тираж. Техкарта выгружается файлом.
import { state } from '../core/state.js';
import { onChange } from '../core/bus.js';
import { computeProduction } from '../core/math.js';
import { analyzeFormability, recommendProcess, checks, toolingNumbers,
         batchPlan, techCard, rawForTarget, firedFromRaw } from '../core/tooling.js';
import { PROCESSES, byId as processById } from '../config/processes.js';
import { byId as materialById } from '../config/materials.js';
import { download, fileName } from '../core/files.js';
import { toast } from './overlays.js';
import { openArticle } from './kb.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ru');

let manualProc = null;      // выбран руками — не перебиваем рекомендацией
let batch = 500;

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

  $('toolSrc').innerHTML = proc.src.map(s =>
    `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join('<br>');
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
  $('toolCard').onclick = () => {
    const an = analyzeFormability(state);
    const prod = computeProduction(state);
    const text = techCard(state, prod, an, currentProcId(an), batch);
    download(new Blob([text], {type: 'text/markdown'}), fileName(state, 'техкарта.md'));
    toast('Техкарта сохранена');
  };
  onChange(render);      // рецепт изменился — пересчитать оснастку
  render();
}

export const syncTooling = render;
