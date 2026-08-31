// file: js/core/process.js
// Производственный процесс изделия: от формы до готового.
//
// Полоса «что дальше» (js/core/next.js) ведёт по инструменту: где ещё не были,
// что не посчитано. Процесс — про другое: это путь самой вещи. Часть шагов
// проверяется данными (форма есть, масса выбрана, красных замечаний нет),
// часть — физические действия, которые может подтвердить только человек:
// высохло, обожглось, померено.
//
// Отсюда два вида шагов и два источника правды:
//
//   • **выводимые** — статус берётся из состояния изделия; отметить их руками
//     нельзя, потому что это враньё самому себе;
//   • **отмечаемые** — сушка, утиль, глазурование, обжиг: их ставит мастер,
//     и отметка живёт в записи работы, а не в рецепте.
//
// Шаги зависят от изделия: нет крышки — нет шага крышки, нет прилепов — нет
// шага прилепов, не полая вещь — нечего глазуровать изнутри.
//
// Здесь только правила. Ни DOM, ни хранилища.

/**
 * @param ctx {state, warnings, kiln, cost, work}
 * @returns [{id, name, what, kind:'auto'|'mark', status, why, go}]
 *   status: 'todo' | 'doing' | 'done' | 'warn' | 'blocked'
 */
export function processSteps(ctx) {
  const {state, warnings = [], kiln = {}, cost = {}, work = null} = ctx;
  const done = (work && work.done) || {};
  const bad = warnings.filter(w => w.lvl === 'bad');
  const warn = warnings.filter(w => w.lvl === 'warn');
  const parts = (state.parts || []).filter(p => p.kind !== 'lip');
  const lid = !!(state.lid && state.lid.on);
  const glazed = state.firing === 'glaze';

  const steps = [];
  const auto = (id, name, what, status, why, go) =>
    steps.push({id, name, what, kind: 'auto', status, why, go});
  const mark = (id, name, what, why) =>
    steps.push({id, name, what, kind: 'mark', status: done[id] ? 'done' : 'todo', why});

  /* 1. Форма. Профиль есть всегда — вопрос в том, довели ли его до годного. */
  auto('form', 'Форма', 'Силуэт, размеры, стенка и ножка',
       bad.length ? 'blocked' : warn.length ? 'warn' : 'done',
       bad.length ? `Не годится к производству: ${bad[0].txt}`
         : warn.length ? `${warn.length} предупреждение мастера — прочтите перед началом`
         : `${Math.round(state.H)}×${Math.round(state.D)} мм на круге, стенка ${state.wall} мм`,
       {tab: 'form', block: 'size'});

  /* 2. Масса: от неё усадка, цвет и температура — без неё дальше считать нечего. */
  auto('mat', 'Масса', 'Из чего лепим и чем обжигаем',
       state.mat ? 'done' : 'todo',
       state.mat ? 'выбрана' : 'не выбрана', {tab: 'mat', block: 'matlib'});

  /* 3–4. Прилепы и крышка — только если они есть у этого изделия. */
  if (parts.length)
    auto('parts', 'Прилепы', 'Ручки и носики: прилепляют по кожетвёрдому',
         'done', `${parts.length} на изделии`, {tab: 'form', block: 'parts'});
  if (lid)
    auto('lid', 'Крышка', 'Делают отдельно, обжигают вместе',
         'done', 'зазор посадки считается после обжига', {tab: 'form', block: 'lid'});

  /* 5–8. Физика: это делают руками, и отметить может только мастер. */
  mark('making', 'Изготовление', 'Вытянуть на круге, напечатать или отлить',
       'формовка по выбранному способу');
  mark('drying', 'Сушка', 'До кожетвёрдого, потом до сухого',
       'медленно и равномерно: здесь рождается большинство трещин');
  mark('bisque', 'Утильный обжиг', 'Первый обжиг: черепок становится прочным',
       'после него изделие можно глазуровать');
  if (glazed || state.firing === 'bisque')
    mark('glazing', 'Глазурование', 'Полить, вытереть дно и поясок',
         'посадочный поясок крышки не глазуруют — спечётся с горловиной');

  /* 9. Обжиг: садку и цену считает печь, а сам обжиг — дело мастера. */
  const kilnOk = !!kiln.perItem;
  steps.push({
    id: 'firing', name: 'Обжиг', what: 'Политой обжиг до рабочей температуры',
    kind: 'mark', status: done.firing ? 'done' : kilnOk ? 'todo' : 'warn',
    why: kilnOk
      ? `в садку входит ${kiln.load ? kiln.load.total : '—'} шт, ${Math.round(kiln.perItem)} ₽ на изделие`
      : 'изделие не входит в выбранную печь — обжиг не посчитан',
    go: {tab: 'mat', block: 'kiln'},
  });

  /* 10. Контроль: сравнить обещание с фактом. Считается начатым, как только
        появился первый замер, — по данным, а не по отметке. */
  const measured = work && work.fact
    ? Object.keys(work.fact).filter(k => k !== 'note' && k !== 'lossWhy').length : 0;
  steps.push({
    id: 'check', name: 'Контроль', what: 'Померить готовое и записать факт',
    kind: 'auto', status: measured >= 3 ? 'done' : measured ? 'doing' : 'todo',
    why: measured ? `записано замеров: ${measured}` : 'ни одного замера',
    go: {screen: 'passport'},
  });

  /* 11. Готово — не шаг, а итог: всё физическое отмечено и контроль начат. */
  const physDone = steps.filter(s => s.kind === 'mark').every(s => s.status === 'done');
  steps.push({
    id: 'done', name: 'Готово', what: 'Изделие сделано и записано',
    kind: 'auto', status: physDone && measured ? 'done' : 'todo',
    why: physDone && measured ? 'путь пройден целиком'
      : !physDone ? 'остались неотмеченные шаги'
      : 'нет ни одного замера — сравнивать расчёт не с чем',
    go: {screen: 'passport'},
  });

  return steps;
}

/** Этап работы по пройденному пути: им подписывается карточка в списке. */
export function phaseFromSteps(steps) {
  const by = id => steps.find(s => s.id === id);
  const ok = id => by(id) && by(id).status === 'done';
  if (ok('done')) return 'done';
  if (by('check') && by('check').status !== 'todo') return 'check';
  if (ok('firing')) return 'check';
  if (ok('glazing')) return 'firing';
  if (ok('bisque')) return 'glazing';
  if (ok('drying')) return 'bisque';
  if (ok('making')) return 'drying';
  return 'draft';
}

/** Красное замечание — стоп: дальше расчёт становится недостоверным. */
export const processBlocked = steps => steps.some(s => s.status === 'blocked');
