// file: js/ui/parts.js
// Конструктор прилепов: список деталей, редактор выбранной и наборы «кружка,
// амфора, чайник, кувшин». Одна деталь ничем не отличалась бы от прежнего
// выключателя «ручка есть» — смысл в том, что деталей несколько, у каждой свой
// поворот вокруг оси, и видно, как они стоят друг относительно друга.
//
// Рядом — «как это делают»: КРУГ считает производство, поэтому появившаяся
// на модели деталь обязана объяснить, из чего её лепят и что при этом трескается.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { userProfileMM, computeProduction } from '../core/math.js';
import { makePart, sanitizePart, partMetrics, partsHandMinutes } from '../core/parts.js';
import { PART_KINDS, PART_LIMITS, PART_PRESETS, kindOf } from '../config/parts.js';
import { strainerHoles } from '../core/strainer.js';
import { $, esc } from './dom.js';
import { icon } from './icons.js';

let sel = null;          // id выбранной детали

const FRACTION = new Set(['top', 'bot', 'at']);
const val = (p, f) => (FRACTION.has(f) ? Math.round(p[f] * 100) : p[f]);
// «5 мм» с пробелом, «22°» и «62%» без него — как в остальной панели
const withUnit = (v, unit) => v + (unit === 'мм' ? ' ' : '') + unit;

function rowText(p, i, prof) {
  const m = partMetrics(prof, p);
  const k = kindOf(p);
  const detail = p.kind === 'handle'
    ? `лента ${p.thick}×${p.wide} мм · просвет ${m.grip.toFixed(0)} мм`
    : p.kind === 'lip'
      ? `ширина ${p.width}° · отгиб ${p.out} мм · кромка ниже на ${p.drop} мм`
      : `длина ${p.len} мм · подъём ${p.rise}°`;
  return `<b>${icon(k.ico, 14)}${k.name} ${i + 1}</b><span>${p.az}° · ${detail}</span>`;
}

function editorHTML(p) {
  const k = kindOf(p);
  const fields = k.fields.map(f => {
    const L = PART_LIMITS[f];
    const step = FRACTION.has(f) ? L.step : L.step;
    return `<div class="slider-row">
      <div class="slider-head"><span>${L.name}</span><output>${withUnit(val(p, f), L.unit)}</output></div>
      <input type="range" data-f="${f}" min="${L.min}" max="${L.max}" step="${step}" value="${val(p, f)}"
             aria-label="${L.name}">
    </div>`;
  }).join('');
  return `<div class="part-edit">
    <p class="hint">${esc(k.lead)}</p>
    ${fields}
  </div>`;
}

export function syncParts() {
  const box = $('partsBox');
  if (!box) return;
  const parts = state.parts || [];
  if (parts.length && !parts.some(p => p.id === sel)) sel = parts[0].id;
  if (!parts.length) sel = null;
  const prof = userProfileMM(state);

  const list = parts.length ? parts.map((p, i) => `
    <div class="part-row${p.id === sel ? ' active' : ''}">
      <button class="part-pick" data-pick="${p.id}">${rowText(p, i, prof)}</button>
      <button class="part-act" data-copy="${p.id}" title="Дублировать">${icon('plus', 14)}</button>
      <button class="part-act" data-del="${p.id}" title="Убрать">${icon('trash-2', 14)}</button>
    </div>`).join('')
    : '<div class="empty">Пока чистое тело вращения. Добавьте ручку или носик — они войдут в массу, в замечания и в выгрузку.</div>';

  const cur = parts.find(p => p.id === sel);
  box.innerHTML = `
    <div class="btn-row">
      ${Object.entries(PART_KINDS).map(([id, k]) =>
        `<button class="btn small" data-add="${id}">${icon('plus', 13)}${k.name}</button>`).join('')}
    </div>
    <div class="chip-row">
      ${PART_PRESETS.map(pr =>
        `<button class="chip-btn" data-preset="${pr.id}" title="${esc(pr.note)}">${esc(pr.name)}</button>`).join('')}
    </div>
    <div class="part-list">${list}</div>
    ${cur ? editorHTML(cur) : ''}`;

  box.querySelectorAll('[data-add]').forEach(b => {
    b.onclick = () => {
      const p = makePart(b.dataset.add, state.parts);
      state.parts = [...(state.parts || []), p].slice(0, 8);
      sel = p.id;
      syncParts(); emit();
    };
  });
  box.querySelectorAll('[data-preset]').forEach(b => {
    b.onclick = () => {
      const pr = PART_PRESETS.find(x => x.id === b.dataset.preset);
      state.parts = pr.parts.map(x => sanitizePart({...PART_KINDS[x.kind].defaults, ...x}));
      sel = state.parts.length ? state.parts[0].id : null;
      syncParts(); emit();
    };
  });
  box.querySelectorAll('[data-pick]').forEach(b => {
    b.onclick = () => { sel = b.dataset.pick; syncParts(); };
  });
  box.querySelectorAll('[data-copy]').forEach(b => {
    b.onclick = () => {
      const src = state.parts.find(p => p.id === b.dataset.copy);
      const p = sanitizePart({...src, id: 'p' + Math.random().toString(36).slice(2, 8)});
      p.az = makePart(p.kind, state.parts).az;      // копия встаёт в свободное место
      state.parts = [...state.parts, p].slice(0, 8);
      sel = p.id;
      syncParts(); emit();
    };
  });
  box.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = () => {
      state.parts = state.parts.filter(p => p.id !== b.dataset.del);
      syncParts(); emit();
    };
  });
  box.querySelectorAll('input[data-f]').forEach(inp => {
    const out = inp.parentElement.querySelector('output');
    const f = inp.dataset.f, L = PART_LIMITS[f];
    inp.addEventListener('input', () => {
      const v = +inp.value;
      const p = state.parts.find(x => x.id === sel);
      if (!p) return;
      p[f] = FRACTION.has(f) ? v / 100 : v;
      out.textContent = withUnit(v, L.unit);
      emit();
      updateMechanics();
    });
  });
  updateMechanics();
}

/* ---------- как это делают ---------- */
export function updateMechanics() {
  const box = $('partsMake');
  if (!box) return;
  const parts = state.parts || [];
  if (!parts.length) {
    box.innerHTML = '<p class="note">Прилепов нет: изделие целиком снимается с круга одной операцией.</p>';
    return;
  }
  const prod = computeProduction(state);
  const share = prod.massF > 0 ? (prod.partsMl * 1.92 / prod.massF * 100) : 0;
  const kinds = [...new Set(parts.map(p => p.kind))];
  const spouts = parts.filter(p => p.kind === 'spout').map((p, i) => {
    const h = strainerHoles(p);
    return `<dt>Ситечко ${i + 1}</dt><dd>${h.count} ${h.count === 1 ? 'отверстие' : 'отверстий'}
      ⌀<b>${h.holeD.toFixed(1)} мм</b> · живое сечение <b>${(h.ratio * 100).toFixed(0)} %</b> от носика
      <span class="dim">(меньше 100 % — чайник льёт тонко)</span></dd>`;
  }).join('');
  const fill = prod.cutBySpout
    ? `<dt>Наливается</dt><dd><b>${Math.round(prod.fillMl)} мл</b> до ${prod.fillBy === 'lip' ? 'слива' : 'носика'} вместо ${Math.round(prod.capMl)} мл до кромки</dd>`
    : '';
  box.innerHTML = `
    <dl class="spec">
      <dt>Деталей</dt><dd>${parts.length} · глины на них <b>${Math.round(prod.partsMl * 1.92)} г</b> (${share.toFixed(0)} % массы)</dd>
      <dt>Ручной работы</dt><dd><b>${partsHandMinutes(parts)} мин</b> на изделие сверх формовки корпуса <span class="dim">(умолчание инструмента)</span></dd>
      ${fill}
      ${spouts}
    </dl>
    <p class="mat-note">Порядок: корпус на круге → подвялить до кожетвёрдости → прилепы →
      медленная сушка под плёнкой → утиль → глазурь. Прилеп делают из той же массы
      и той же влажности: разная влажность рвёт шов при сушке.</p>
    ${kinds.map(k => `
      <div class="make-block">
        <div class="make-title">${icon(PART_KINDS[k].ico, 14)}${PART_KINDS[k].name}</div>
        <ol class="make-steps">${PART_KINDS[k].make.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      </div>`).join('')}
    <p class="note">Ситечко режут по кожетвёрдому — тогда глина режется, а не крошится.
      Оснастка и G-code считаются по корпусу: прилепы делают отдельно.</p>`;
}

export function initParts() {
  syncParts();
}
