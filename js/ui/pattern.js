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
         patternMap, patternVolumeMl, patternWarnings } from '../core/pattern.js';
import { userProfileMM } from '../core/math.js';
import { byId as materialById } from '../config/materials.js';
import { beadWidth } from '../core/slicer.js';
import { $, num } from './dom.js';
import { pal } from './palette.js';
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

  return `<div class="pat-layer${l.mute ? ' muted' : ''}" data-layer="${li}">
    <div class="pat-layer-head">
      <i class="pat-ico" data-pat-ico="${l.id}" aria-hidden="true"></i>
      <label class="pat-pick">
        <select data-lay="${li}" data-pat="id" aria-label="Форма рельефа слоя ${li + 1}">
          ${PATTERNS.map(x => `<option value="${x.id}"${x.id === l.id ? ' selected' : ''}>${x.name}</option>`).join('')}
        </select></label>
      <button class="part-act" data-lay-mute="${li}" aria-pressed="${!!l.mute}"
              title="${l.mute ? 'Вернуть слой в рельеф' : 'Временно выключить слой'}"
              aria-label="${l.mute ? 'Включить' : 'Выключить'} слой ${li + 1}"
              >${icon(l.mute ? 'eye-off' : 'circle-dot', 15)}</button>
      <button class="part-act" data-lay-copy="${li}" title="Дублировать слой"
              aria-label="Дублировать слой ${li + 1}">${icon('copy', 15)}</button>
      <button class="part-act" data-lay-del="${li}" title="Убрать слой"
              aria-label="Убрать слой ${li + 1}">${icon('x', 15)}</button>
    </div>
    ${l.mute ? '<p class="dim pat-what">Слой выключен: числа сохранены, в рельеф не входит.</p>' : ''}
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

/* ---------- развёртка ---------- */
/* Модель показывает половину вазы и ту в перспективе: пояс на задней стороне,
   сдвиг слоя по кругу и место, где слои накладываются друг на друга, на ней
   не видны вовсе. Поэтому под стопкой лежит развёртка — стенка, разрезанная
   по образующей и разложенная в лист πD × H, в настоящих пропорциях.
   Рисуется она не «раскраской по глубине», а светом: рельеф читается глазом
   как рельеф, а не как тепловая карта. */
let offscreen = null;

function rgbOf(str) {
  const m = String(str).match(/-?[\d.]+/g);
  return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
}

export function drawPatternMap() {
  const cv = $('patMap');
  if (!cv) return;
  const wrap = cv.parentElement;
  const w = wrap.clientWidth;
  if (w < 60) return;                       // панель ещё не разложена
  const pat = sanitizePattern(state.pattern);
  if (!patternOn(pat)) return;

  /* Высота листа — из настоящих пропорций стенки: развёртка, растянутая
     по вкусу, врёт про наклон гребня и про то, круглый ли бугорок. */
  const wallW = Math.PI * state.D, wallH = state.H;
  const h = Math.round(Math.min(280, Math.max(90, w * wallH / wallW)));
  const dp = Math.min(devicePixelRatio, 2);
  cv.width = w * dp; cv.height = h * dp;
  cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dp, 0, 0, dp, 0, 0);

  /* Сетка выборки берётся от самого частого слоя: шестьдесят четыре гребня
     на двухстах отсчётах дают муар, а не узор. */
  const maxN = Math.max(3, ...pat.layers.map(l => l.n));
  const maxM = Math.max(1, ...pat.layers.map(l => l.m));
  const cols = Math.min(420, Math.max(160, 6 * maxN));
  const rows = Math.min(200, Math.max(80, 6 * maxM));
  const map = patternMap(pat, {H: state.H, D: state.D, cols, rows});
  const span = Math.max(map.hi - map.lo, 0.2);

  const P = pal();
  /* Лист серый, а не глиняный: цветом в интерфейсе говорят разделы и замечания,
     и оранжевый прямоугольник в полпанели перекрикивал бы их. Рельеф читается
     светотенью, а цвет остаётся у модели.

     Свет и тень задаются не токенами, а физикой: тень темнее поверхности,
     блик светлее — в обеих темах одинаково. Пара «фон → текст» на светлой теме
     переворачивалась, и гребень выходил темнее ложбины. */
  const surf = rgbOf(P.at('--sunken'));
  const toward = (t, k) => surf.map((c, i) => c + (t[i] - c) * k);
  const base = toward([0, 0, 0], 0.5), lit = toward([255, 255, 255], 0.45);
  if (!offscreen) offscreen = document.createElement('canvas');
  offscreen.width = cols; offscreen.height = rows;
  const octx = offscreen.getContext('2d');
  const img = octx.createImageData(cols, rows);
  for (let i = 0; i < rows; i++) {
    const src = (rows - 1 - i) * cols;         // строка 0 карты — дно, а рисуем сверху вниз
    for (let j = 0; j < cols; j++) {
      const d = map.mm[src + j];
      /* Свет слева: яркость даёт наклон стенки по кругу, а не сама глубина.
         По одной глубине борозда и валик выглядят одинаково. */
      const dl = map.mm[src + (j - 1 + cols) % cols], dr = map.mm[src + (j + 1) % cols];
      const slope = (dr - dl) / span;
      const k = clamp01(0.46 + slope * 2.2 + (d / span) * 0.22);
      const o = (i * cols + j) * 4;
      img.data[o] = base[0] + (lit[0] - base[0]) * k;
      img.data[o + 1] = base[1] + (lit[1] - base[1]) * k;
      img.data[o + 2] = base[2] + (lit[2] - base[2]) * k;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreen, 0, 0, w, h);

  const yOf = v => h - v * h;                 // доля высоты → пиксель сверху вниз

  /* Зона гашения у дна и кромки: там рельефа не будет, что бы ни стояло
     в поясах, и это честнее показать, чем объяснять текстом. */
  const fadeV = Math.max(3, state.H * 0.06) / state.H;
  ctx.fillStyle = P.at('--panel', 0.55);
  ctx.fillRect(0, 0, w, yOf(1 - fadeV));
  ctx.fillRect(0, yOf(fadeV), w, h - yOf(fadeV));

  /* Границы поясов — там, где человек их и ищет: на самом рисунке. */
  ctx.lineWidth = 1;
  ctx.font = '10px Manrope, system-ui, sans-serif';
  pat.layers.forEach((l, i) => {
    if (l.from <= 0 && l.to >= 1) return;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = P.accent(0.75);
    for (const v of [l.from, l.to]) {
      ctx.beginPath(); ctx.moveTo(0, yOf(v)); ctx.lineTo(w, yOf(v)); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = P.accent(0.95);
    ctx.fillText(String(i + 1), 4, yOf(l.to) + 11);
  });

  /* Где на этом листе стоят ручка и носик. Сдвиг по кругу затем и нужен, чтобы
     увести гребень от прилепа: борозда под ручкой — это шов, по которому она
     и отрывается. Угол сегмента и азимут детали связаны как phi = π/2 − az,
     тот же порядок, в каком прилепы поворачиваются в сцене. */
  const parts = (state.parts || []).filter(p => p.kind !== 'lip' || p.deform !== false);
  if (parts.length) {
    ctx.font = '10px Manrope, system-ui, sans-serif';
    for (const part of parts) {
      const phi = (Math.PI / 2 - (+part.az || 0) * Math.PI / 180 + Math.PI * 4) % (Math.PI * 2);
      const x = phi / (Math.PI * 2) * w;
      ctx.strokeStyle = P.accent2 ? P.accent2(0.9) : P.accent(0.9);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.setLineDash([]);
      const name = PART_NAME[part.kind] || 'деталь';
      const tw = ctx.measureText(name).width + 6;
      const tx = Math.min(Math.max(x + 3, 0), w - tw);
      plate(ctx, P, tx, h - 34, tw, 13);
      ctx.fillStyle = P.accent2 ? P.accent2(1) : P.accent(1);
      ctx.fillText(name, tx + 3, h - 24);
    }
  }

  /* Бусина в масштабе листа: если рельеф мельче этого прямоугольника,
     сопло его не нарисует — и это видно, а не сказано числом. */
  const bead = beadWidth(state), layerH = (state.pr && +state.pr.lh) || 0;
  if (bead && layerH) {
    const bw = bead / wallW * w, bh = layerH / wallH * h;
    ctx.fillStyle = P.at('--panel', 0.85);
    ctx.fillRect(w - bw - 10, h - bh - 10, bw, bh);
    ctx.strokeStyle = P.text(0.75);
    ctx.strokeRect(w - bw - 10.5, h - bh - 10.5, bw + 1, bh + 1);
    plate(ctx, P, w - bw - 14 - 42, h - 20, 42, 13);
    ctx.fillStyle = P.text(0.8);
    ctx.textAlign = 'right';
    ctx.fillText('бусина', w - bw - 14, h - 10);
    ctx.textAlign = 'left';
  }
  const cap = `развёртка стенки ${Math.round(wallW / 10)}×${Math.round(wallH / 10)} см`;
  plate(ctx, P, 4, 4, ctx.measureText(cap).width + 6, 13);
  ctx.fillStyle = P.text(0.8);
  ctx.fillText(cap, 7, 14);
}

/* Подпись поверх рельефа теряется в полосах: под неё кладётся плашка фона.
   Тот же приём, что у подписей на чертеже. */
function plate(ctx, P, x, y, w, h) {
  ctx.fillStyle = P.at('--panel', 0.78);
  ctx.fillRect(x, y, w, h);
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/* Короткие имена для отметок на развёртке: полное «оттянутый слив» в лист
   не влезает, а «слив» понятно и так. */
const PART_NAME = {handle: 'ручка', spout: 'носик', lip: 'слив'};

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
      <div class="pat-map"><canvas id="patMap" aria-label="Развёртка узора на стенке"></canvas></div>
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
        Крышка получает тот же рельеф на купол (выключается в блоке «Крышка»), прилепы —
        нет: их лепят руками, и на круге они гладкие.</p>`
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

  drawPatternMap();

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
  box.querySelectorAll('[data-lay-mute]').forEach(b => {
    b.onclick = () => {
      const next = layers(), i = +b.dataset.layMute;
      if (!next[i]) return;
      next[i].mute = !next[i].mute;
      setLayers(next);
    };
  });
  box.querySelectorAll('[data-lay-copy]').forEach(b => {
    b.onclick = () => {
      /* Копия садится сразу за оригиналом: её тут же двигают сдвигом по кругу
         или поясом — так собирают вторую половину рисунка. */
      const next = layers(), i = +b.dataset.layCopy;
      if (!next[i] || next.length >= MAX_LAYERS) return;
      next.splice(i + 1, 0, {...next[i]});
      setLayers(next);
    };
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

export function initPattern() {
  syncPattern();
  /* Ширину панели тянут разделителями, а лист развёртки обязан оставаться
     в настоящих пропорциях. Наблюдаем за блоком, а не за самой канвой:
     канва пересоздаётся при каждой перерисовке стопки. */
  const block = document.querySelector('[data-block="pattern"]');
  if (!block) return;
  let pending = false;
  new ResizeObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; drawPatternMap(); }, 0);
  }).observe(block);
}
