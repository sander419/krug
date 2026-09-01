// file: js/ui/process.js
// Экран «Производственный процесс»: путь этой вещи от формы до готового.
//
// Полоса «что дальше» ведёт по инструменту, процесс — по изделию. Часть шагов
// проверяется данными, часть отмечает мастер: инструмент не может знать, что
// изделие высохло. Отметки живут в записи работы, а не в рецепте, — у другого
// человека по той же ссылке будет свой путь.
//
// Правила шагов — в js/core/process.js, здесь показ и переходы.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { computeProduction, computeWarnings, computeStrength } from '../core/math.js';
import { processSteps, phaseFromSteps, processBlocked } from '../core/process.js';
import { patchWork, phaseById } from '../core/works.js';
import { currentWork, saveCurrent } from './works.js';
import { kilnNumbers } from './kiln.js';
import { firstHintHTML } from './hints.js';
import { openScreen, refreshScreen, closeScreen } from './screen.js';
import { openPassport } from './passport.js';
import { showTab, openBlock } from './panels.js';
import { activeRoute } from './route.js';
import { routeTabs, TABS } from '../config/routes.js';
import { $, esc } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';

const ICON = {done: 'circle-check', doing: 'circle-dot', todo: 'circle',
              warn: 'circle-alert', blocked: 'circle-alert'};

function steps() {
  const prod = computeProduction(state);
  return processSteps({
    state, work: currentWork(), kiln: kilnNumbers(),
    warnings: computeWarnings(state, prod, computeStrength(state)),
  });
}

function bodyHTML() {
  const list = steps();
  const w = currentWork();
  const blocked = processBlocked(list);
  const doneN = list.filter(s => s.status === 'done').length;

  const rows = list.map((s, i) => `
    <li class="ps-step st-${s.status}">
      <span class="ps-mark">${icon(ICON[s.status] || 'circle', 17)}</span>
      <span class="ps-body">
        <b>${s.name}</b>
        <span class="ps-what">${s.what}</span>
        <span class="ps-why">${esc(s.why)}</span>
      </span>
      <span class="ps-act">
        ${s.kind === 'mark'
          ? `<label class="ps-check"><input type="checkbox" data-mark="${s.id}"
               ${s.status === 'done' ? 'checked' : ''}
               ${w ? '' : 'disabled'}><span>сделано</span></label>`
          : s.go ? `<button class="btn small" data-go="${s.id}">Открыть</button>` : ''}
      </span>
    </li>`).join('');

  return `
    ${firstHintHTML('process', 'Путь вещи, а не путь по инструменту',
      'Шаги с галочкой отмечает мастер: инструмент не знает, высохло ли изделие и вышло ли из печи. Остальные проверяются данными — их не отметить руками. Этап в списке изделий считается по пройденному пути.')}

    <div class="ps-head">
      <div class="ps-progress"><b>${doneN}</b> из ${list.length} шагов
        ${w ? `· этап: ${phaseById(w.phase).name}` : '· изделие не сохранено'}</div>
      ${blocked ? `<div class="pp-verdict bad">${icon('circle-alert', 15)}
        Красное замечание мастера: дальше расчёт становится недостоверным. Сначала форма.</div>` : ''}
    </div>
    <ol class="ps-list">${rows}</ol>
    <p class="screen-note">Шаги с галочкой отмечает мастер: инструмент не знает, что изделие
      высохло или вышло из печи. Остальные проверяются данными — их не отметить руками,
      это было бы враньём самому себе. Отметки лежат в записи изделия и в ссылку-ДНК
      не уезжают.</p>
    <div class="btn-row">
      <button class="btn primary" id="psPassport">${icon('clipboard-list', 15)}Паспорт и факт</button>
      ${w ? '' : `<button class="btn" id="psSave">${icon('save', 15)}Сохранить изделие</button>`}
    </div>`;
}

function mount(box) {
  const rerender = () => { refreshScreen(bodyHTML()); mount(box); };

  box.querySelectorAll('[data-mark]').forEach(inp => {
    inp.onchange = () => {
      const w = currentWork();
      if (!w) { toast('Сначала сохраните изделие — отметке некуда лечь'); return; }
      const done = {...w.done, [inp.dataset.mark]: inp.checked};
      /* Этап работы выводится из отмеченного пути, а не выбирается отдельно:
         два независимых источника правды разойдутся в первый же день. */
      patchWork(w.id, {done});
      const after = currentWork();
      patchWork(w.id, {phase: phaseFromSteps(processSteps({
        state, work: after, kiln: kilnNumbers(),
        warnings: computeWarnings(state, computeProduction(state), computeStrength(state)),
      }))});
      emit();
      rerender();
    };
  });

  box.querySelectorAll('[data-go]').forEach(b => {
    b.onclick = () => {
      const s = steps().find(x => x.id === b.dataset.go);
      if (!s || !s.go) return;
      if (s.go.screen === 'passport') { closeScreen(); openPassport(); return; }
      const tabs = routeTabs(activeRoute());
      closeScreen();
      if (s.go.block && openBlock(s.go.block)) return;
      if (s.go.tab && tabs.includes(s.go.tab)) { showTab(s.go.tab); return; }
      toast(`«${TABS[s.go.tab] ? TABS[s.go.tab].name : 'Вкладка'}» убрана текущей задачей`);
    };
  });

  const pp = $('psPassport');
  if (pp) pp.onclick = () => { closeScreen(); openPassport(); };
  const save = $('psSave');
  if (save) save.onclick = () => { const n = saveCurrent(); emit(); rerender(); toast(`Сохранено: «${n}»`); };
}

export function openProcess() {
  openScreen({
    id: 'process',
    title: 'Производственный процесс',
    lead: 'Путь этой вещи: что уже сделано, что отметить и где остановиться.',
    html: bodyHTML(), redraw: bodyHTML,
    onMount: mount,
  });
}
