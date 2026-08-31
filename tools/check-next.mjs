// Проверка пути «что дальше» и профилей:
//   node --import ./tools/node-three.mjs tools/check-next.mjs
//
// Полоса «дальше» ведёт человека по инструменту. Её кнопки обязаны вести
// в существующие места: шаг, указывающий на блок, которого нет в разметке, —
// это мёртвая кнопка, а мёртвая кнопка хуже отсутствующей. Заодно проверяется,
// что «сделано» ставится по факту, а не по тому, открывал ли человек вкладку.
import { readFileSync } from 'node:fs';
import { state } from '../js/core/state.js';
import { computeProduction, computeWarnings, computeStrength, userProfileMM } from '../js/core/math.js';
import { nextSteps, currentStep } from '../js/core/next.js';
import { pieceCost } from '../js/core/cost.js';
import { PROFILES, DEFAULT_PROFILE, profileById, profileRoutes } from '../js/config/profiles.js';
import { ROUTES, TABS, routeById, routeTabs } from '../js/config/routes.js';

const problems = [];
const P = t => problems.push(t);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
const blocks = new Set([...html.matchAll(/data-block="([^"]+)"/g)].map(m => m[1]));

const ctx = (over = {}) => {
  const prod = computeProduction(state);
  const warnings = computeWarnings(state, prod, computeStrength(state));
  const cost = pieceCost(state, prod, userProfileMM(state), {firePerPiece: 30});
  return {state, prod, warnings, kiln: {perItem: 30, load: {total: 4}}, cost, exported: false, ...over};
};

/* ---------- шаги ведут в существующие места ---------- */
{
  const steps = nextSteps(ctx());
  if (steps.length < 6) P('путь короче шести шагов — это уже не путь');
  const ids = new Set();
  for (const s of steps) {
    if (ids.has(s.id)) P(`шаг «${s.id}» повторяется`);
    ids.add(s.id);
    if (!s.name || !s.hint) P(`у шага «${s.id}» нет имени или подсказки`);
    if (!s.go) { P(`шагу «${s.id}» некуда вести`); continue; }
    if (s.go.tab && !TABS[s.go.tab]) P(`шаг «${s.id}» ведёт на несуществующую вкладку «${s.go.tab}»`);
    if (s.go.block && !blocks.has(s.go.block))
      P(`шаг «${s.id}» ведёт в блок «${s.go.block}», которого нет в разметке — мёртвая кнопка`);
    if (s.go.menu && !html.includes(`id="${s.go.menu === 'export' ? 'exportMoreBtn' : s.go.menu}"`))
      P(`шаг «${s.id}» ведёт в меню «${s.go.menu}», которого нет в шапке`);
  }
  /* Блок, на который ведёт шаг, обязан лежать на той вкладке, которую шаг
     называет: иначе человек уходит на вкладку и не находит блок. */
  for (const s of steps) {
    if (!s.go || !s.go.tab || !s.go.block) continue;
    const pane = html.split(`data-pane="${s.go.tab}"`)[1] || '';
    const body = pane.split('<section')[0];
    if (!body.includes(`data-block="${s.go.block}"`))
      P(`шаг «${s.id}»: блок «${s.go.block}» лежит не на вкладке «${s.go.tab}»`);
  }
}

/* ---------- «сделано» ставится по факту ---------- */
{
  const steps = nextSteps(ctx());
  const byId = id => steps.find(s => s.id === id);
  if (!byId('mat').done) P('масса выбрана, а шаг не отмечен сделанным');
  if (byId('out').done) P('ничего не выгружали, а шаг «заберите результат» отмечен');
  if (!nextSteps(ctx({exported: true})).find(s => s.id === 'out').done)
    P('после выгрузки последний шаг обязан стать сделанным');

  /* Красное замечание — это стоп: шаг проверки не может быть сделан. */
  const bad = nextSteps(ctx({warnings: [{lvl: 'bad', txt: 'Неустойчива'}]}));
  const check = bad.find(s => s.id === 'check');
  if (check.done) P('есть замечание «нельзя», а шаг проверки отмечен сделанным');
  if (!check.alarm) P('замечание «нельзя» не подняло тревогу на шаге проверки');
  if (currentStep(bad).id !== 'check') P('при красном замечании «дальше» обязано звать чинить его');

  /* Печь не считает — обжиг не попал в смету, и это видно в шаге. */
  const noKiln = nextSteps(ctx({kiln: {}, cost: {complete: false, total: 0, minPrice: 0}}));
  if (noKiln.find(s => s.id === 'kiln').done) P('печь не посчитана, а шаг отмечен сделанным');
  if (noKiln.find(s => s.id === 'cost').done) P('смета неполная, а шаг отмечен сделанным');

  /* Прилепы и крышка появляются в пути только когда они есть. */
  const wasParts = state.parts, wasLid = state.lid;
  state.parts = []; state.lid = {on: false};
  if (nextSteps(ctx()).some(s => s.id === 'parts')) P('прилепов нет, а шаг про них есть');
  state.lid = {on: true};
  if (!nextSteps(ctx()).some(s => s.id === 'parts')) P('крышка включена, а шага про неё нет');
  state.parts = wasParts; state.lid = wasLid;
}

/* ---------- профили ---------- */
{
  if (!profileById(DEFAULT_PROFILE)) P('профиля по умолчанию нет в реестре');
  const seen = new Set();
  for (const p of PROFILES) {
    if (!p.name || !p.lead) P(`у профиля «${p.id}» нет имени или строки о нём`);
    if (!p.routes.length) P(`у профиля «${p.id}» нет ни одной задачи`);
    if (!p.routes.includes(p.home)) P(`домашняя задача профиля «${p.id}» не входит в его набор`);
    for (const r of p.routes) {
      if (!routeById(r)) P(`профиль «${p.id}» ссылается на несуществующую задачу «${r}»`);
      seen.add(r);
    }
    if (profileRoutes(p, ROUTES).length !== p.routes.length)
      P(`задачи профиля «${p.id}» теряются при сборке списка`);
  }
  for (const r of ROUTES)
    if (!seen.has(r.id)) P(`задача «${r.name}» не входит ни в один профиль — до неё не добраться`);

  /* Профиль «показать всё» обязан показывать всё: иначе ссылка «не уверен»
     врёт, а человеку некуда деться из простого вида. */
  const all = profileById('all');
  for (const r of ROUTES)
    if (!all.routes.includes(r.id)) P(`«показать всё» не показывает задачу «${r.name}»`);

  /* Задача, ради которой профиль существует, обязана вести к своей вкладке. */
  for (const r of ROUTES) {
    if (!r.focus) continue;
    if (r.focus.tab && !routeTabs(r).includes(r.focus.tab))
      P(`задача «${r.name}» ведёт на вкладку «${r.focus.tab}», которой в ней нет`);
    if (r.focus.block && !blocks.has(r.focus.block))
      P(`задача «${r.name}» ведёт в блок «${r.focus.block}», которого нет в разметке`);
  }
}

/* ---------- каждый шаг достижим хотя бы в одной задаче профиля ---------- */
/* Шаг, вкладки которого нет ни в одной задаче профиля, — обещание, которое
   человек в этом профиле выполнить не может: кнопка ведёт в никуда всегда. */
{
  const steps = nextSteps(ctx());
  for (const p of PROFILES) {
    const tabs = new Set();
    for (const id of p.routes) for (const t of routeTabs(routeById(id))) tabs.add(t);
    for (const s of steps) {
      if (!s.go || !s.go.tab) continue;
      if (!tabs.has(s.go.tab))
        P(`шаг «${s.id}» ведёт на вкладку «${s.go.tab}», которой нет ни в одной задаче профиля «${p.id}»`);
    }
  }
}

/* ---------- простой вид ничего не удаляет ---------- */
{
  const master = profileById('master');
  if (!master.simple) P('профиль мастера обязан открываться в простом виде');
  const advBlocks = [...html.matchAll(/data-block="([^"]+)"[^>]*data-adv/g)].map(m => m[1]);
  if (!advBlocks.length) P('в разметке нет ни одного блока с пометкой data-adv — прятать нечего');
  /* Спрятанное обязано быть доступно: расширенный режим переключается кнопкой,
     и кнопка обязана быть в шапке. */
  if (!html.includes('id="advBtn"')) P('кнопки расширенного режима нет в шапке — спрятанное не вернуть');
}

console.log('Проверка пути и профилей\n');
{
  const steps = nextSteps(ctx());
  console.log(`  шагов ${steps.length}, сейчас: «${currentStep(steps).name}»`);
  for (const p of PROFILES)
    console.log(`  ${p.name.padEnd(20)} ${p.routes.length} задач${p.simple ? ' · простой вид' : ''}`);
}

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nПуть ведёт в существующие места, профили не теряют задач.');
