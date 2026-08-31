// file: js/ui/next.js
// Полоса «что дальше» над вкладками.
//
// Одна строка: что сделать следующим и кнопка, которая туда ведёт. Развернув,
// человек видит весь путь — от формы до листа для мастерской — и где он на нём
// стоит. Это не мастер-визард: любой шаг можно пропустить, порядок ничего
// не запрещает. Полоса отвечает на вопрос «я всё сделал?», а не командует.
//
// Правила шагов — в js/core/next.js, здесь только показ и переходы.
import { state } from '../core/state.js';
import { computeProduction, computeWarnings, computeStrength, userProfileMM } from '../core/math.js';
import { nextSteps, currentStep } from '../core/next.js';
import { moneyNumbers } from './money.js';
import { $ } from './dom.js';
import { icon, paintIcons } from './icons.js';
import { showTab, openBlock } from './panels.js';
import { activeRoute, onRoute } from './route.js';
import { routeTabs } from '../config/routes.js';

let open = false;
let exported = false;              // хоть что-то выгружено за сеанс

/** Экспорт отмечает последний шаг сделанным: работа дошла до результата. */
export function markExported() { exported = true; syncNext(); }

function go(step) {
  if (!step || !step.go) return;
  const g = step.go;
  if (g.panel === 'warn') {
    const foot = $('panelFoot');
    if (foot) { foot.open = true; foot.scrollIntoView({block: 'nearest'}); }
    return;
  }
  // вкладки, которых нет в задаче, прятать нельзя молча: ведём на блок,
  // а если вкладка вне набора — открываем то, что доступно
  if (g.menu === 'export') {
    const b = $('exportMoreBtn');
    if (b) { b.click(); b.scrollIntoView({block: 'nearest'}); }
    return;
  }
  const tabs = routeTabs(activeRoute());
  if (g.block && openBlock(g.block)) return;
  if (g.tab && tabs.includes(g.tab)) showTab(g.tab);
}

/**
 * @param ctx {prod, warnings} — уже посчитанные в общей пересборке; без них
 *   считаем сами (полоса живёт и при первом запуске, до первой пересборки).
 */
export function syncNext(ctx = {}) {
  const box = $('nextBar');
  if (!box) return;
  const prod = ctx.prod || computeProduction(state);
  const warnings = ctx.warnings || computeWarnings(state, prod, computeStrength(state));
  const {per, kiln} = moneyNumbers();
  const steps = nextSteps({state, prod, warnings, kiln, cost: per, exported,
                           prof: userProfileMM(state)});
  const cur = currentStep(steps);
  const done = steps.filter(s => s.done).length;

  const list = steps.map(s => `
    <li class="next-step${s.done ? ' done' : ''}${s.alarm ? ' alarm' : ''}${cur && s.id === cur.id ? ' now' : ''}">
      <span class="next-mark">${icon(s.done ? 'circle-check' : s.alarm ? 'circle-alert' : 'circle-dot', 15)}</span>
      <span class="next-body"><b>${s.name}</b><span>${s.hint}</span></span>
      <button class="btn small" data-next-go="${s.id}">Открыть</button>
    </li>`).join('');

  box.innerHTML = `
    <div class="next-head">
      <span class="next-cap">${cur ? 'Дальше' : 'Готово'}</span>
      <span class="next-now">${cur
        ? `<b>${cur.name}</b><span class="dim"> · ${cur.hint}</span>`
        : '<b>Изделие доведено до производства</b><span class="dim"> · осталось повторить в металле</span>'}</span>
      ${cur ? `<button class="btn small primary" id="nextGo">Открыть</button>` : ''}
      <button class="btn icon small" id="nextToggle" aria-expanded="${open}"
              title="Весь путь: ${done} из ${steps.length}">${icon(open ? 'chevron-up' : 'chevron-down', 15)}</button>
    </div>
    <ol class="next-list"${open ? '' : ' hidden'}>${list}</ol>`;

  const t = $('nextToggle');
  if (t) t.onclick = () => { open = !open; syncNext(); };
  const g = $('nextGo');
  if (g) g.onclick = () => go(cur);
  box.querySelectorAll('[data-next-go]').forEach(b => {
    b.onclick = () => go(steps.find(s => s.id === b.dataset.nextGo));
  });
  paintIcons(box);
}

export function initNext() {
  /* Задача «подготовить производство» разворачивает весь путь: её и выбирают,
     чтобы увидеть, что осталось. Подписка, а не разовая проверка при запуске:
     задачу меняют на ходу. */
  onRoute(r => {
    if (r.focus && r.focus.checklist) { open = true; syncNext(); }
  });
  syncNext();
}
