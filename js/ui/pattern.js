// file: js/ui/pattern.js
// Блок «Узор на стенке»: выбор рельефа и его настройка.
//
// Узор — единственное место в инструменте, где форма выходит за пределы того,
// что делают руки на круге: тело вращения по определению гладкое по кругу,
// а сопло принтера может менять радиус на каждом шаге. Поэтому блок живёт
// на вкладке формы, но говорит языком печати: шаг рельефа против бусины,
// свес закрутки, остаток стенки в ложбине.
//
// Правило показа: у каждого узора свои ручки. Кольцам незачем число повторов
// по кругу, каннелюрам — по высоте; лишний ползунок здесь означает «покрутите
// и посмотрите», а инструмент должен говорить, что именно вы крутите.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { PATTERNS, PATTERN_PRESETS, LIMITS, sanitizePattern, patternById, patternOn,
         patternVolumeMl, patternWarnings } from '../core/pattern.js';
import { userProfileMM } from '../core/math.js';
import { byId as materialById } from '../config/materials.js';
import { beadWidth } from '../core/slicer.js';
import { $, num } from './dom.js';
import { icon } from './icons.js';

/* Узоры, которые лепятся поверх стенки, а не режутся в неё: у них ложбины нет,
   и пугать человека «остатком стенки» незачем. */
const OUTWARD = new Set(['bump', 'spiral']);

/* Светится не рельеф, а черепок: на красной глине тонкое дно окна остаётся
   тонким дном, и обещать «на просвет» ей нельзя. */
const TRANSLUCENT = /фарфор|porcelain/i;

const FIELDS = {
  n:     {name: 'Повторов по кругу', unit: 'шт',  step: 1},
  depth: {name: 'Глубина рельефа',   unit: 'мм',  step: 0.2},
  m:     {name: 'Повторов по высоте', unit: 'шт', step: 1},
  twist: {name: 'Закрутка',          unit: '°',   step: 15},
};

export function syncPattern() {
  const box = $('patternBody');
  if (!box) return;
  const pat = sanitizePattern(state.pattern);
  const p = patternById(pat.id);
  const prof = userProfileMM(state);
  const bead = beadWidth(state);

  const fields = p.uses.map(k => {
    const f = FIELDS[k];
    const [lo, hi] = LIMITS[k];
    return `<label class="field-row"><span>${f.name}</span>
      <input type="number" data-pat="${k}" min="${lo}" max="${hi}" step="${f.step}"
             value="${num(pat[k], k === 'depth' ? 1 : 0).replace(',', '.')}"
             inputmode="decimal" aria-label="${f.name}"><i class="unit">${f.unit}</i></label>`;
  }).join('');

  const warns = patternWarnings(pat, {wall: state.wall, hollow: state.hollow, D: state.D, H: state.H, bead});
  const extraMl = patternVolumeMl(pat, prof);
  const step = pat.n ? 2 * Math.PI * (state.D / 2) / pat.n : 0;

  box.innerHTML = `
    <div class="pat-grid">${PATTERNS.map(x => `
      <button class="pat-card${x.id === pat.id ? ' current' : ''}" data-pat-pick="${x.id}"
              aria-pressed="${x.id === pat.id}" title="${x.what}">
        <i class="pat-ico" data-pat-ico="${x.id}" aria-hidden="true"></i>
        <b>${x.name}</b></button>`).join('')}
    </div>
    <div class="pat-presets">${PATTERN_PRESETS.map(x => `
      <button class="chip-btn" data-pat-preset="${x.id}" title="${x.what}">${x.name}</button>`).join('')}
    </div>
    ${patternOn(pat) ? `
      <p class="dim pat-lead">${p.what}. Рельеф уходит и в модель, и в STL, и в G-code:
        на экране то же, что напечатает машина.</p>
      <div class="field-grid">${fields}</div>
      ${state.rings > 0.15 ? `<p class="screen-note">Поверх рельефа лежат следы гончара
        (${num(state.rings, 1)} мм, ползунок «Следы гончара» выше): они складываются с узором.
        Для чистого рисунка их убирают в ноль.</p>` : ''}
      <dl class="pp-list pat-nums">
        <div class="pp-row"><dt>Шаг рельефа</dt>
          <dd>${p.uses.includes('n') ? `${num(step, 1)} мм по окружности` : '—'}
            <span class="dim">бусина принтера ${num(bead, 1)} мм</span></dd></div>
        ${!state.hollow ? `
        <div class="pp-row"><dt>Стенка</dt>
          <dd>—<span class="dim">форма сплошная: рельеф режет само тело,
            а не стенку</span></dd></div>`
        : `
        <div class="pp-row"><dt>Стенка в ложбине</dt>
          <dd>${OUTWARD.has(pat.id) ? `${num(state.wall, 1)} мм`
            : `${num(Math.max(0, state.wall - pat.depth), 1)} мм`}
            <span class="dim">${OUTWARD.has(pat.id)
              ? 'рельеф растёт наружу — стенка не утоньшается'
              : `из ${state.wall} мм${TRANSLUCENT.test(materialById(state.mat).name)
                  ? ' — на просвет светится тонкое'
                  : ' — просвет даст только фарфор, здесь это просто рельеф'}`}</span></dd></div>`}
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
         что умеет машина: сопло меняет радиус на каждом шаге спирали.</p>`}`;

  box.querySelectorAll('[data-pat-pick]').forEach(b => {
    b.onclick = () => {
      state.pattern = sanitizePattern({...pat, id: b.dataset.patPick});
      emit();
    };
  });
  box.querySelectorAll('[data-pat-preset]').forEach(b => {
    b.onclick = () => {
      const p = PATTERN_PRESETS.find(x => x.id === b.dataset.patPreset);
      if (!p) return;
      state.pattern = sanitizePattern(p.pat);
      emit();
    };
  });
  box.querySelectorAll('[data-pat]').forEach(inp => {
    inp.onchange = () => {
      state.pattern = sanitizePattern({...pat, [inp.dataset.pat]: inp.value});
      emit();
    };
  });
}

export function initPattern() { syncPattern(); }
