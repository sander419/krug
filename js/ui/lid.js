// file: js/ui/lid.js
// Крышка: включение, тип посадки и размеры.
//
// Крышка не прилеп: её не примазывают, а делают отдельно и обжигают вместе.
// Поэтому в панели на виду не форма, а посадка — зазор после обжига. Обе детали
// садятся на одну долю, и заложенный «на глаз» миллиметр после обжига становится
// девятью десятыми: это то число, из-за которого крышки и не садятся.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { LID_DEFAULTS, LID_LIMITS, sanitizeLid, lidMetrics } from '../core/lid.js';
import { userProfileMM } from '../core/math.js';
import { byId, density } from '../config/materials.js';
import { $, num } from './dom.js';

const F = [
  {k: 'h',      n: 'Высота купола',   u: 'мм'},
  {k: 'wall',   n: 'Толщина',         u: 'мм'},
  {k: 'seatH',  n: 'Высота посадки',  u: 'мм'},
  {k: 'gap',    n: 'Зазор посадки',   u: 'мм', step: 0.1},
  {k: 'knobD',  n: 'Диаметр кнопки',  u: 'мм'},
  {k: 'knobH',  n: 'Высота кнопки',   u: 'мм'},
  {k: 'over',   n: 'Свес за кромку',  u: 'мм', only: 'over'},
];

export function syncLid() {
  const box = $('lidBody');
  if (!box) return;
  const lid = sanitizeLid(state.lid);
  const prof = userProfileMM(state);
  const mat = byId(state.mat);
  const m = lidMetrics(prof, lid, state.wall, density(mat), mat.shrinkPct);

  const fields = lid.on ? F.filter(f => !f.only || f.only === lid.type).map(f => {
    const [lo, hi] = LID_LIMITS[f.k];
    return `<label class="field-row"><span>${f.n}</span>
      <input type="number" data-lid="${f.k}" min="${lo}" max="${hi}" step="${f.step || 1}"
             value="${lid[f.k]}"><i class="unit">${f.u}</i></label>`;
  }).join('') : '';

  box.innerHTML = `
    <div class="seg" id="lidOn" role="group" aria-label="Крышка">
      <button data-lid-on="0"${lid.on ? '' : ' class="active"'}>Без крышки</button>
      <button data-lid-on="1"${lid.on ? ' class="active"' : ''}>С крышкой</button>
    </div>
    ${lid.on ? `
    <div class="seg" id="lidType" role="group" aria-label="Тип посадки">
      <button data-lid-type="inset"${lid.type === 'inset' ? ' class="active"' : ''}>В горловину</button>
      <button data-lid-type="over"${lid.type === 'over' ? ' class="active"' : ''}>Внахлёст</button>
    </div>
    ${fields}
    <dl class="spec">
      <dt>Посадка</dt><dd>⌀${num(m.seatR * 2, 1)} мм в сыром размере ·
        <b>⌀${num(m.firedSeatMM, 1)} мм</b> после обжига</dd>
      <dt>Зазор</dt><dd>${num(m.gapRaw, 1)} мм заложено ·
        <b>${num(m.gapFired, 1)} мм</b> останется после обжига
        <span class="dim">(садится вместе с деталями, усадка ${mat.shrinkPct} %)</span></dd>
      <dt>Глина</dt><dd>${num(m.volMl, 0)} см³ · <b>${num(m.massG, 0)} г</b> сверх корпуса</dd>
    </dl>
    <p class="note">Посадочный поясок не глазуруют: политая посадка спекается с горловиной,
      и разбивать придётся обе детали. Обжигают крышку на изделии — тогда она садится точно,
      а не «примерно».</p>` : `
    <p class="hint">Банке, чайнику и сахарнице крышка нужна, и делают её отдельным изделием.
      Главное в ней не форма, а зазор посадки: он садится вместе с деталями, поэтому
      считать его надо после обжига.</p>`}`;

  box.querySelectorAll('[data-lid-on]').forEach(b => {
    b.onclick = () => { state.lid = {...lid, on: b.dataset.lidOn === '1'}; emit(); syncLid(); };
  });
  box.querySelectorAll('[data-lid-type]').forEach(b => {
    b.onclick = () => { state.lid = {...lid, type: b.dataset.lidType}; emit(); syncLid(); };
  });
  box.querySelectorAll('[data-lid]').forEach(inp => {
    inp.oninput = () => {
      state.lid = sanitizeLid({...lid, [inp.dataset.lid]: +inp.value});
      emit();
    };
  });
}

export function initLid() { syncLid(); }
