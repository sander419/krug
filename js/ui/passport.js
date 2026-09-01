// file: js/ui/passport.js
// Паспорт изделия — всё об этой вещи на одном экране.
//
// Числа были и раньше, но лежали по восьми вкладкам: размеры на одной, масса
// на второй, глазурь на третьей, печь на четвёртой, деньги на пятой. Чтобы
// ответить «что это за изделие», человек обходил их все и держал в голове.
//
// Паспорт ничего не считает сам: он собирает то, что уже посчитано ядром,
// и добавляет единственное, чего в расчёте нет, — **факт**. Рядом с каждым
// обещанием стоит замер и отклонение, и это самое ценное, что мастер
// накапливает: по нему он поправит усадку, брак и минуты под свою мастерскую.
//
// Правило показа: у каждого числа видно, откуда оно. Паспорт поставщика,
// расчёт инструмента, оценка и ваш замер выглядят по-разному.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { computeProduction, userProfileMM, computeWarnings, computeStrength } from '../core/math.js';
import { byId as materialById, density } from '../config/materials.js';
import { byGlazeId } from '../config/glazes.js';
import { byId as processById } from '../config/processes.js';
import { sanitizeCost, pieceCost, batchPlan } from '../core/cost.js';
import { analyzeFormability, recommendProcess } from '../core/tooling.js';
import { castMouldNumbers } from '../three/castMould.js';
import { FACT_FIELDS, compareFact, factLevel, hasFact } from '../core/fact.js';
import { sanitizePattern, patternOn, patternById } from '../core/pattern.js';
import { patchWork, phaseById } from '../core/works.js';
import { currentWork, saveCurrent } from './works.js';
import { kilnNumbers, kilnCurrent } from './kiln.js';
import { firstHintHTML } from './hints.js';
import { openScreen, refreshScreen } from './screen.js';
import { openRelease } from './release.js';
import { $, esc, num, rub, plural, signed } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';

/** Всё, что паспорт показывает. Ничего не считает — только собирает. */
export function passportData() {
  const prod = computeProduction(state);
  const prof = userProfileMM(state);
  const mat = materialById(state.mat);
  const glz = byGlazeId(state.glazeId);
  const opt = sanitizeCost(state.cost);
  const kiln = kilnNumbers();
  const per = pieceCost(state, prod, prof, {...opt, firePerPiece: kiln.perItem || 0, glaze: glz});
  const plan = batchPlan(per, {n: opt.n, perFiring: kiln.load ? kiln.load.total : null,
                               mouldLifePieces: (processById('casting').mouldLife || [null])[0]});
  const an = analyzeFormability(state);
  const rec = recommendProcess(state, an);
  let mould = null;
  try { mould = castMouldNumbers(state); } catch (_) {}
  const k = 1 - mat.shrinkPct / 100;
  return {
    prod, prof, mat, glz, opt, kiln, per, plan, an, rec, mould,
    firedH: state.H * k, firedD: state.D * k,
    warnings: computeWarnings(state, prod, computeStrength(state)),
    strength: computeStrength(state),
  };
}

/* Расчётные значения в тех же единицах, в которых мастер меряет готовое
   изделие: после обжига, в миллиметрах и граммах. */
export function calcForFact(d) {
  return {
    H: d.firedH, D: d.firedD, massG: d.prod.massF, shrinkPct: d.mat.shrinkPct,
    glazeG: d.per.glazeKg * 1000, workMin: d.opt.minPerPiece,
    fireH: d.kiln.cost ? d.kiln.cost.hours : null,
  };
}

const src = t => `<span class="src-tag" title="Откуда число">${t}</span>`;
const TAG = {
  pass: src('паспорт'), calc: src('расчёт'),
  est: '<span class="est-tag" title="Ориентир, а не паспортное число">оценка</span>',
  fact: '<span class="fact-tag">ваш замер</span>',
};

function row(name, value, note) {
  return `<div class="pp-row"><dt>${name}</dt><dd>${value}${
    note ? ` <span class="dim">${note}</span>` : ''}</dd></div>`;
}

function section(title, rows, extra = '') {
  return `<section class="pp-sect"><h3>${title}</h3><dl class="pp-list">${rows}</dl>${extra}</section>`;
}

function factHTML(w, d) {
  const calc = calcForFact(d);
  const rows = compareFact(calc, w ? w.fact : {});
  /* Поля разбираются по именам, а не через `f.что-то`: у реестра факта они
     называются `name` и `unit`, а у соседних реестров — `n` и `u`. Опечатка
     здесь однажды уже подписала все восемь полей словом «undefined», и молча:
     при разборе имени промах виден сразу — падает, а не рисует. */
  const fields = FACT_FIELDS.map(({k, name, unit, step, dec}) => {
    const v = w && w.fact && w.fact[k] !== undefined ? w.fact[k] : '';
    const c = calc[k];
    return `<label class="field-row"><span>${name}</span>
      <input type="number" data-fact="${k}" step="${step}" value="${v}"
             inputmode="decimal" placeholder="${c == null ? '' : num(c, dec)}"
             aria-label="${name}, факт"><i class="unit">${unit}</i></label>`;
  }).join('');

  const table = rows.length ? `<table class="pp-fact">
    <thead><tr><th>Величина</th><th>Расчёт</th><th>Факт</th><th>Отклонение</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="lvl-${factLevel(r)}">
      <td>${r.name}</td>
      <td>${r.calc == null ? '—' : num(r.calc, r.dec) + ' ' + r.unit}</td>
      <td><b>${num(r.fact, r.dec)} ${r.unit}</b></td>
      <td>${r.pct == null ? '—' : signed(r.pct, 1) + ' %'}</td>
    </tr>`).join('')}</tbody></table>`
    : `<p class="dim">Замеров пока нет. Впишите то, что получилось на самом деле, —
       и рядом с каждым обещанием встанет отклонение.</p>`;

  return `${table}
    <div class="pp-fact-form">${fields}</div>
    <label class="field-row wide"><span>Причина брака</span>
      <input type="text" data-fact="lossWhy" value="${esc((w && w.fact && w.fact.lossWhy) || '')}"
             placeholder="трещина по дну, цек, недожог…" aria-label="Причина брака"></label>
    <label class="field-row wide"><span>Заметка</span>
      <input type="text" data-fact="note" value="${esc((w && w.fact && w.fact.note) || '')}"
             placeholder="что учесть в следующий раз" aria-label="Заметка"></label>
    <p class="screen-note">Факт не меняет рецепт: модель остаётся прежней, иначе следующий
      расчёт пойдёт от подогнанного числа и сравнивать станет не с чем. Замеры лежат
      в записи изделия и в ссылку-ДНК не уезжают — у другого мастера своя печь и свои руки.</p>`;
}

function bodyHTML() {
  const d = passportData();
  const w = currentWork();
  const bad = d.warnings.filter(x => x.lvl === 'bad');
  const warn = d.warnings.filter(x => x.lvl === 'warn');
  const fmtG = g => g >= 1000 ? num(g / 1000, 2) + ' кг' : Math.round(g) + ' г';

  const head = `<div class="pp-head">
    ${w && w.thumb ? `<img class="pp-thumb" src="${w.thumb}" alt="" width="220" height="165">` : ''}
    <div class="pp-head-main">
      <div class="pp-title">${esc(state.name || 'Без названия')}</div>
      <div class="pp-sub">${Math.round(state.H)}×${Math.round(state.D)} мм на круге ·
        ${esc(d.mat.name)} · ${esc(d.glz.name.toLowerCase())}${w
          ? ` · этап: ${phaseById(w.phase).name}` : ' · не сохранено'}</div>
      <div class="pp-verdict ${bad.length ? 'bad' : warn.length ? 'warn' : 'ok'}">
        ${icon(bad.length ? 'circle-alert' : 'circle-check', 15)}
        ${bad.length ? `${bad.length} ${plural(bad.length, 'замечание', 'замечания', 'замечаний')} «нельзя»: ${esc(bad[0].txt)}`
          : warn.length ? `Красных нет, есть ${warn.length} ${plural(warn.length, 'предупреждение', 'предупреждения', 'предупреждений')}`
          : 'Мастер одобряет: форма технологична и устойчива'}</div>
    </div>
  </div>`;

  const sizes = section('Размеры', [
    row('На круге', `<b>${num(state.H / 10, 1)}×${num(state.D / 10, 1)} см</b>`, 'до обжига ' + TAG.calc),
    row('После обжига', `<b>${num(d.firedH / 10, 1)}×${num(d.firedD / 10, 1)} см</b>`,
        `усадка ${num(d.mat.shrinkPct, 1)} % ${TAG.pass}`),
    row('Стенка', `${num(state.wall, 1)} мм`, state.hollow ? '' : 'сплошное тело'),
    row('Вместимость', state.hollow
      ? `<b>${Math.round(d.prod.cutBySpout ? d.prod.fillMl : d.prod.capMl)} мл</b>`
      : '<span class="dim">сплошная</span>',
      d.prod.cutBySpout ? `до ${d.prod.fillBy === 'lip' ? 'слива' : 'носика'}; до кромки ${Math.round(d.prod.capMl)} мл` : ''),
    row('Объём глины', `${Math.round(d.prod.volMl)} см³`, d.prod.lidMl ? `из них крышка ${Math.round(d.prod.lidMl)}` : ''),
    (() => {
      /* Узор — часть формы, а не отделка: без него по паспорту не повторить вещь. */
      const pat = sanitizePattern(state.pattern);
      if (!patternOn(pat)) return '';
      const p = patternById(pat.id);
      const bits = [`${pat.depth} мм`];
      if (p.uses.includes('n')) bits.push(`${pat.n} по кругу`);
      if (p.uses.includes('m')) bits.push(`${pat.m} по высоте`);
      if (pat.twist) bits.push(`закрутка ${pat.twist}°`);
      return row('Узор', `<b>${p.name}</b>`, bits.join(' · ') + ' ' + TAG.calc);
    })(),
    state.rings > 0.15
      ? row('Следы гончара', `${num(state.rings, 1)} мм`, 'глубина колец от вытяжки ' + TAG.calc)
      : '',
  ].join(''));

  const mass = section('Масса', [
    row('Глины на изделие', `<b>${fmtG(d.prod.massN)}</b>`, `с припуском ${state.allow} % на подрезку`),
    row('Готовое изделие', `<b>${fmtG(d.prod.massF)}</b>`, 'после обжига ' + TAG.calc),
    row('Возврат в шамот', fmtG(d.prod.waste), 'обрезки и подрезка'),
    row('Устойчивость', `${d.prod.angle.toFixed(0)}°`, 'угол опрокидывания'),
    row('Прочность стенки', `<b class="${d.strength.minSF < 1.5 ? 'bad' : d.strength.minSF < 2.5 ? 'warn' : 'ok'}">${d.strength.minSF.toFixed(1)}×</b>`,
        'запас при печати глиной'),
  ].join(''));

  const material = section('Материал', [
    row('Масса', `<b>${esc(d.mat.name)}</b>`, esc(d.mat.vendor || '')),
    row('Усадка', `${num(d.mat.shrinkPct, 1)} %`, TAG.pass),
    row('Обжиг', d.mat.firing && d.mat.firing.glazeC ? `${d.mat.firing.glazeC.join('–')} °C` : '—', TAG.pass),
    row('Шамот', d.mat.grogPct != null ? `${d.mat.grogPct} %` : '<span class="dim">нет данных</span>'),
    row('Цена', d.per.clayPerKg ? `${num(d.per.clayPerKg, 0)} ₽/кг` : '<span class="dim">не опубликована</span>',
        d.mat.pack ? esc(d.mat.pack) : ''),
  ].join(''));

  const glaze = section('Глазурь', [
    row('Глазурь', `<b>${esc(d.glz.name)}</b>`, `конус ${d.glz.cone.join('–')} · ${d.glz.tempC.join('–')} °C`),
    row('Площадь', `${num(d.per.areaCm2, 0)} см²`, 'наружу и внутрь, дно не в счёт'),
    row('Расход', `${num(d.per.glazeKg * 1000, 0)} г`, 'сухой смеси ' + TAG.est),
    row('Стоимость', d.per.glazeRub == null ? '<span class="dim">цена не взята</span>' : `<b>${rub(d.per.glazeRub)}</b>`,
        esc(d.per.glazePrice.note)),
  ].join(''));

  const kiln = section('Печь', [
    row('Печь', `<b>${esc(kilnCurrent().name)}</b>`,
        `камера ${kilnCurrent().innerMM.join('×')} мм · ${kilnCurrent().powerKW} кВт`),
    row('Садка', d.kiln.load && d.kiln.load.total
      ? `<b>${d.kiln.load.total} шт</b> за обжиг`
      : '<span class="dim">изделие не входит в камеру</span>',
      d.kiln.load && d.kiln.load.total ? `${d.kiln.load.perShelf} на полке × ${d.kiln.load.tiers} яруса` : ''),
    row('Энергия', d.kiln.cost ? `${num(d.kiln.cost.kWh, 1)} кВт·ч` : '—',
        d.kiln.cost ? `${num(d.kiln.cost.hours, 1)} ч под нагрузкой` : ''),
    row('Обжиг изделия', d.kiln.perItem ? `<b>${rub(d.kiln.perItem)}</b>` : '<span class="dim">не посчитан</span>',
        'при полной садке'),
  ].join(''));

  const prod = section('Производство', [
    row('Способ', `<b>${esc(processById(d.rec.id).name)}</b>`, esc(d.rec.why[0] || '')),
    row('Частей формы', d.mould ? `${d.mould.parts}` : '—',
        d.mould ? `${d.mould.tiers > 1 ? d.mould.tiers + ' яруса × 2 половины' : 'две половины'}` : ''),
    row('Гипса на форму', d.mould ? `${num(d.mould.plasterL * 2 * 1.42, 1)} кг` : '—', 'схватившегося'),
    row('Прилепов', `${(state.parts || []).length}`, (state.lid && state.lid.on) ? 'плюс крышка' : ''),
    row('Тираж', `<b>${d.opt.n} шт</b>`, d.plan.firings ? `${d.plan.firings} ${plural(d.plan.firings, 'обжиг', 'обжига', 'обжигов')}` : ''),
  ].join(''));

  const money = section('Экономика', [
    row('Глина', d.per.clayRub == null ? '<span class="dim">цена не опубликована</span>' : rub(d.per.clayRub)),
    row('Глазурь', d.per.glazeRub == null ? '<span class="dim">—</span>' : rub(d.per.glazeRub) + ' ' + TAG.est),
    row('Обжиг', d.per.fireRub == null ? '<span class="dim">—</span>' : rub(d.per.fireRub)),
    row('Работа', rub(d.per.labourRub) + ' ' + TAG.est, `${d.opt.minPerPiece} мин по ${num(d.opt.hourRate, 0)} ₽/ч`),
    d.per.toolingRub > 0 ? row('Оснастка', rub(d.per.toolingRub), `на ${d.opt.toolingPieces} изделий`) : '',
    row('Прочие', rub(d.per.otherRub) + ' ' + TAG.est, `${d.opt.otherPct} %`),
    row('Брак', rub(d.per.lossRub) + ' ' + TAG.est, `${d.opt.lossPct} %`),
    row('Себестоимость', `<b class="pp-total">${rub(d.per.total)}</b>`, 'за штуку'),
    row('Минимальная цена', `<b>${rub(d.per.minPrice)}</b>`, `наценка ${d.opt.marginPct} %, маржа ${rub(d.per.marginRub)}`),
  ].join(''));

  return `
    ${firstHintHTML('passport', 'Паспорт — всё об изделии на одном экране',
      'Сверху расчёт: размеры до и после обжига, масса, материал, глазурь, печь и деньги. Внизу место для факта — что получилось на самом деле. Разница между обещанием и фактом и есть то, ради чего паспорт заводят.')}
${head}
    <div class="pp-grid">${sizes}${mass}${material}${glaze}${kiln}${prod}${money}</div>
    <section class="pp-sect pp-wide"><h3>Контроль: расчёт против факта</h3>${factHTML(w, d)}</section>
    <div class="btn-row pp-acts">
      <button class="btn primary" id="ppRelease">${icon('download', 15)}Выпуск и выгрузки</button>
      <button class="btn" id="ppProcess">${icon('clipboard-check', 15)}Производственный процесс</button>
      <button class="btn" id="ppSave">${icon('save', 15)}Сохранить изделие</button>
      ${w ? '' : '<span class="dim">изделие ещё не в списке — сохраните, чтобы записывать факт</span>'}
    </div>`;
}

function mount(box) {
  const w = currentWork();
  box.querySelectorAll('[data-fact]').forEach(inp => {
    inp.onchange = () => {
      const cur = currentWork();
      if (!cur) { toast('Сначала сохраните изделие — факту некуда лечь'); return; }
      const k = inp.dataset.fact;
      const v = inp.type === 'number' ? (inp.value === '' ? undefined : +inp.value) : inp.value;
      patchWork(cur.id, {fact: {...cur.fact, [k]: v}});
      refreshScreen(bodyHTML());
      mount(box);
    };
  });
  const rel = $('ppRelease');
  if (rel) rel.onclick = () => openRelease();
  const pr = $('ppProcess');
  if (pr) pr.onclick = async () => {
    const {openProcess} = await import('./process.js');
    openProcess();
  };
  const save = $('ppSave');
  if (save) save.onclick = () => {
    const name = saveCurrent();
    refreshScreen(bodyHTML());
    mount(box);
    emit();
    toast(`Сохранено: «${name}»`);
  };
}

export function openPassport() {
  openScreen({
    id: 'passport', wide: true,
    title: 'Паспорт изделия',
    lead: 'Всё об этой вещи на одном экране: размеры, масса, материал, печь, деньги и факт.',
    html: bodyHTML(), redraw: bodyHTML,
    onMount: mount,
  });
}
