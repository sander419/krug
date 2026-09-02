// file: js/ui/pattern.js
// Блок «Узор на стенке»: конструктор рельефа из слоёв.
//
// Узор — единственное место в инструменте, где форма выходит за пределы того,
// что делают руки на круге: тело вращения по определению гладкое по кругу,
// а сопло принтера может менять радиус на каждом шаге. Поэтому блок живёт
// на вкладке формы, но говорит языком печати: шаг рельефа против бусины,
// период по высоте против высоты слоя, свес закрутки, остаток стенки в ложбине.
//
// Устройство: стопка слоёв. Один слой — это одна форма рельефа со своими
// повторами, глубиной, закруткой, сдвигом по кругу и **поясом по высоте**.
// Слои складываются, и вещь из двух-трёх слоёв руками не повторить вовсе:
// каннелюры на всю высоту, пояс чешуи посередине, кольцо под кромкой.
//
// Правила показа:
//   • у каждой формы рельефа свои ручки — кольцам незачем число повторов
//     по кругу, каннелюрам — по высоте. Лишний ползунок означает «покрутите
//     и посмотрите», а инструмент должен говорить, что именно вы крутите;
//   • мягкость края пояса появляется только у слоя с поясом: на всю высоту
//     она ни на что не влияет;
//   • числа внизу считаются по всей стопке, а не по верхнему слою: стенку
//     режут все слои сразу там, где их пояса перекрываются.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { PATTERNS, PATTERN_PRESETS, LIMITS, MAX_LAYERS, LAYER_DEFAULTS,
         sanitizePattern, sanitizeLayer, patternById, patternOn, patternRelief,
         patternVolumeMl, patternWarnings } from '../core/pattern.js';
import { userProfileMM } from '../core/math.js';
import { byId as materialById } from '../config/materials.js';
import { beadWidth } from '../core/slicer.js';
import { $, num } from './dom.js';
import { icon } from './icons.js';

/* Светится не рельеф, а черепок: на красной глине тонкое дно окна остаётся
   тонким дном, и обещать «на просвет» ей нельзя. */
const TRANSLUCENT = /фарфор|porcelain/i;

const FIELDS = {
  n:     {name: 'Повторов по кругу',  unit: 'шт', step: 1},
  depth: {name: 'Глубина рельефа',    unit: 'мм', step: 0.2},
  m:     {name: 'Повторов по высоте', unit: 'шт', step: 1},
  twist: {name: 'Закрутка',           unit: '°',  step: 15},
  phase: {name: 'Сдвиг по кругу',     unit: '°',  step: 15},
};

const dec = k => (k === 'depth' ? 1 : 0);

/** Заменить стопку целиком: запись узора неизменяемая, её не правят по месту. */
function setLayers(layers) {
  state.pattern = sanitizePattern({layers});
  emit();
}

function fieldHTML(li, key, value) {
  const f = FIELDS[key];
  const [lo, hi] = LIMITS[key];
  return `<label class="field-row"><span>${f.name}</span>
    <input type="number" data-lay="${li}" data-pat="${key}" min="${lo}" max="${hi}"
           step="${f.step}" value="${num(value, dec(key)).replace(',', '.')}"
           inputmode="decimal" aria-label="${f.name}"><i class="unit">${f.unit}</i></label>`;
}

function layerHTML(l, li, ctx) {
  const p = patternById(l.id);
  const belt = l.from > 0 || l.to < 1;
  /* Ручки слоя: сначала то, что видно на вещи (форма и глубина), потом то,
     чем слой согласуют с соседями (сдвиг), потом где он лежит. */
  const keys = ['n', 'depth', 'm', 'twist'].filter(k => k === 'depth' || p.uses.includes(k));
  if (p.uses.includes('n')) keys.push('phase');

  return `<div class="pat-layer" data-layer="${li}">
    <div class="pat-layer-head">
      <i class="pat-ico" data-pat-ico="${l.id}" aria-hidden="true"></i>
      <label class="pat-pick">
        <select data-lay="${li}" data-pat="id" aria-label="Форма рельефа слоя ${li + 1}">
          ${PATTERNS.map(x => `<option value="${x.id}"${x.id === l.id ? ' selected' : ''}>${x.name}</option>`).join('')}
        </select></label>
      <button class="part-act" data-lay-del="${li}" title="Убрать слой"
              aria-label="Убрать слой ${li + 1}">${icon('x', 15)}</button>
    </div>
    <p class="dim pat-what">${p.what}${p.outward ? '. Растёт наружу — стенку не режет' : ''}</p>
    <div class="pat-fields">${keys.map(k => fieldHTML(li, k, l[k])).join('')}</div>
    <div class="pat-belt">
      <label class="field-row"><span>Пояс от</span>
        <input type="number" data-lay="${li}" data-pat="from" min="0" max="95" step="5"
               value="${Math.round(l.from * 100)}" inputmode="numeric"
               aria-label="Пояс слоя ${li + 1}: от, % высоты"><i class="unit">%</i></label>
      <label class="field-row"><span>до</span>
        <input type="number" data-lay="${li}" data-pat="to" min="5" max="100" step="5"
               value="${Math.round(l.to * 100)}" inputmode="numeric"
               aria-label="Пояс слоя ${li + 1}: до, % высоты"><i class="unit">%</i></label>
      ${belt ? `<label class="field-row"><span>Край</span>
        <input type="number" data-lay="${li}" data-pat="edge" min="1" max="40" step="1"
               value="${Math.round(l.edge * 100)}" inputmode="numeric"
               aria-label="Мягкость края пояса, % высоты"><i class="unit">%</i></label>` : ''}
    </div>
    ${belt ? `<p class="dim pat-what">Слой лежит на высоте
      ${num(l.from * ctx.H / 10, 1)}–${num(l.to * ctx.H / 10, 1)} см; за поясом стенка гладкая.</p>` : ''}
  </div>`;
}

export function syncPattern() {
  const box = $('patternBody');
  if (!box) return;
  const pat = sanitizePattern(state.pattern);
  const prof = userProfileMM(state);
  const bead = beadWidth(state);
  const layerH = (state.pr && +state.pr.lh) || 0;
  const on = patternOn(pat);
  const ctx = {wall: state.wall, hollow: state.hollow, D: state.D, H: state.H, bead, layerH};

  const warns = patternWarnings(pat, ctx);
  const extraMl = patternVolumeMl(pat, prof);
  const {carve, raise} = patternRelief(pat, state.H);
  /* Шаг рельефа — по самому мелкому слою: рвётся печать там, где тесно,
     а не в среднем по стопке. */
  const R = state.D / 2;
  const steps = pat.layers.filter(l => patternById(l.id).uses.includes('n'))
    .map(l => 2 * Math.PI * R / Math.max(1, l.n));
  const step = steps.length ? Math.min(...steps) : 0;
  const periods = pat.layers.filter(l => patternById(l.id).uses.includes('m'))
    .map(l => (l.to - l.from) * state.H / Math.max(1, l.m));
  const period = periods.length ? Math.min(...periods) : 0;
  const thin = pat.layers.some(l => patternById(l.id).thin);

  box.innerHTML = `
    <div class="pat-presets">${PATTERN_PRESETS.map(x => `
      <button class="chip-btn" data-pat-preset="${x.id}" title="${x.what}">${x.name}</button>`).join('')}
      ${on ? '<button class="chip-btn" data-pat-clear="1" title="Гладкая стенка, как на круге">Без узора</button>' : ''}
    </div>
    ${on ? `
      <p class="dim pat-lead">Слои складываются: смещение радиуса у каждого своё, машина печатает сумму.
        Рельеф уходит и в модель, и в STL, и в G-code — на экране то же, что напечатает сопло.</p>
      <div class="pat-stack">${pat.layers.map((l, i) => layerHTML(l, i, ctx)).join('')}</div>
      ${pat.layers.length < MAX_LAYERS
        ? `<button class="chip-btn pat-add" data-pat-add="1">${icon('plus', 14)}Добавить слой</button>`
        : `<p class="dim pat-what">Больше ${MAX_LAYERS} слоёв не складывают: рельеф превращается в шум,
             а стенку они режут вместе.</p>`}
      ${state.rings > 0.15 ? `<p class="screen-note">Поверх рельефа лежат следы гончара
        (${num(state.rings, 1)} мм, ползунок «Следы гончара» выше): они складываются с узором.
        Для чистого рисунка их убирают в ноль.</p>` : ''}
      <dl class="pp-list pat-nums">
        <div class="pp-row"><dt>Шаг рельефа</dt>
          <dd>${step ? `${num(step, 1)} мм по окружности` : '—'}
            <span class="dim">бусина принтера ${num(bead, 1)} мм${steps.length > 1 ? ', по самому мелкому слою' : ''}</span></dd></div>
        <div class="pp-row"><dt>Период по высоте</dt>
          <dd>${period ? `${num(period, 1)} мм` : '—'}
            <span class="dim">${period && layerH
              ? `это ${num(period / layerH, 1)} слоя печати по ${num(layerH, 1)} мм`
              : 'слои этого узора идут только по кругу'}</span></dd></div>
        ${!state.hollow ? `
        <div class="pp-row"><dt>Стенка</dt>
          <dd>—<span class="dim">форма сплошная: рельеф режет само тело,
            а не стенку</span></dd></div>`
        : `
        <div class="pp-row"><dt>Стенка в ложбине</dt>
          <dd>${num(Math.max(0, state.wall - carve), 1)} мм
            <span class="dim">${carve < 0.01
              ? 'рельеф растёт наружу — стенка не утоньшается'
              : `из ${state.wall} мм, срезано ${num(carve, 1)}${pat.layers.length > 1 ? ' всеми слоями вместе' : ''}` +
                (TRANSLUCENT.test(materialById(state.mat).name)
                  ? ' — на просвет светится тонкое'
                  : thin ? ' — просвет даст только фарфор, здесь это просто рельеф' : '')}</span></dd></div>`}
        <div class="pp-row"><dt>Размах рельефа</dt>
          <dd>${num(carve + raise, 1)} мм
            <span class="dim">${num(raise, 1)} мм наружу, ${num(carve, 1)} мм внутрь</span></dd></div>
        <div class="pp-row"><dt>Глины на рельеф</dt>
          <dd>${extraMl >= 0 ? '+' : '−'}${num(Math.abs(extraMl), 1)} см³
            <span class="dim">учтено в массе изделия</span></dd></div>
      </dl>
      ${warns.length ? `<ul class="pat-warns">${warns.map(w =>
        `<li class="lvl-${w.lvl}">${icon(w.lvl === 'bad' ? 'circle-alert' : 'info', 14)}${w.txt}</li>`).join('')}</ul>` : ''}
      <p class="screen-note">Узор гасится у дна и у кромки: на посадочном пояске рельеф мешает
        стоять, а на кромке — пить и держать крышку. Полость остаётся гладкой — вещь моют изнутри.
        Крышка и прилепы рельефа не получают: их делают отдельно, и на круге они гладкие.</p>`
      : `<p class="dim pat-lead">Гладкая стенка, как выходит на круге. Рельеф — это то,
         что умеет машина: сопло меняет радиус на каждом шаге спирали. Возьмите готовое
         сочетание выше или соберите своё из слоёв.</p>
         <div class="pat-grid">${PATTERNS.map(x => `
           <button class="pat-card" data-pat-first="${x.id}" title="${x.what}">
             <i class="pat-ico" data-pat-ico="${x.id}" aria-hidden="true"></i>
             <b>${x.name}</b></button>`).join('')}
         </div>`}`;

  /* Стопка читается из состояния в момент нажатия, а не из той, что была
     на отрисовке: между отрисовкой и кликом рецепт мог поменяться отменой,
     ссылкой или пресетом, и правка одного поля затёрла бы чужой слой. */
  const layers = () => sanitizePattern(state.pattern).layers.map(l => ({...l}));

  box.querySelectorAll('[data-pat-preset]').forEach(b => {
    b.onclick = () => {
      const p = PATTERN_PRESETS.find(x => x.id === b.dataset.patPreset);
      if (p) setLayers(sanitizePattern(p.pat).layers);
    };
  });
  box.querySelectorAll('[data-pat-clear]').forEach(b => { b.onclick = () => setLayers([]); });
  box.querySelectorAll('[data-pat-first]').forEach(b => {
    b.onclick = () => setLayers([sanitizeLayer({...LAYER_DEFAULTS, id: b.dataset.patFirst})]);
  });
  box.querySelectorAll('[data-pat-add]').forEach(b => {
    b.onclick = () => {
      /* Новый слой берёт форму, которой в стопке ещё нет: два одинаковых слоя
         подряд дают удвоенную глубину, а не новый рисунок. */
      const used = new Set(pat.layers.map(l => l.id));
      const next = PATTERNS.find(x => !used.has(x.id)) || PATTERNS[0];
      setLayers([...layers(), sanitizeLayer({...LAYER_DEFAULTS, id: next.id})]);
    };
  });
  box.querySelectorAll('[data-lay-del]').forEach(b => {
    b.onclick = () => setLayers(layers().filter((_, i) => i !== +b.dataset.layDel));
  });
  box.querySelectorAll('[data-lay][data-pat]').forEach(inp => {
    const apply = () => {
      const i = +inp.dataset.lay, key = inp.dataset.pat;
      const next = layers();
      if (!next[i]) return;
      /* Пояс и мягкость края человек вводит в процентах высоты, а хранятся
         они долями: доля не зависит от того, что вещь потом станет выше. */
      next[i][key] = ['from', 'to', 'edge'].includes(key) ? (+inp.value || 0) / 100 : inp.value;
      setLayers(next);
    };
    inp.onchange = apply;
  });
}

export function initPattern() { syncPattern(); }
