// file: js/ui/tuning.js
// Экран «Настройки расчёта»: свои пороги вместо умолчаний инструмента.
//
// Каждый порог показан со своим значением, пределами и — главное — строкой
// «что он меняет». Крутить ручку, не понимая, на что она влияет, хуже, чем
// не иметь её вовсе: числа поедут, а человек не поймёт почему.
//
// Изменённые пороги помечены и считаются в шапке экрана: по ним видно, что
// расчёт идёт не по умолчаниям, — иначе через неделю никто не вспомнит, почему
// у него садка не такая, как у соседа.
import { $, esc, num } from './dom.js';
import { icon } from './icons.js';
import { TUNING, TUNING_GROUPS } from '../config/tuning.js';
import { tune, setTune, resetTune, isTuned, tunedCount } from '../core/tuning.js';
import { emit } from '../core/bus.js';

function html() {
  const n = tunedCount();
  const groups = TUNING_GROUPS.map(g => {
    const rows = TUNING.filter(t => t.group === g).map(t => `
      <div class="tune-row${isTuned(t.id) ? ' own' : ''}">
        <div class="tune-main">
          <b>${esc(t.name)}</b>
          <span>${esc(t.what)}</span>
        </div>
        <div class="tune-set">
          <input type="number" data-tune="${t.id}" value="${tune(t.id)}"
                 min="${t.min}" max="${t.max}" step="${t.step}"
                 aria-label="${esc(t.name)}">
          <i class="unit">${esc(t.unit)}</i>
          <button class="btn small" data-tune-reset="${t.id}"
                  ${isTuned(t.id) ? '' : 'disabled'} title="Вернуть ${num(t.def, 2)}">↺</button>
        </div>
      </div>`).join('');
    return `<section class="tune-group"><h3>${esc(g)}</h3>${rows}</section>`;
  }).join('');

  return `<div class="tune-card" role="dialog" aria-label="Настройки расчёта">
    <div class="guide-head">
      <h2>Настройки расчёта</h2>
      <button class="btn icon" id="tuneClose" title="Закрыть (Esc)" aria-label="Закрыть">${icon('x')}</button>
    </div>
    <p class="guide-lead">Все пороги инструмента — умолчания, а не отраслевой норматив.
      Здесь их можно поставить свои: у каждой мастерской свой гипс, своя печь и своя
      практика. Значения уезжают в ссылку вместе с рецептом, поэтому у получателя
      сойдутся не только формы, но и числа.</p>
    <div class="tune-head">
      <span>${n ? `Своих значений: <b>${n}</b> из ${TUNING.length}` : `Всё по умолчанию, ${TUNING.length} порогов`}</span>
      <button class="btn small" id="tuneResetAll" ${n ? '' : 'disabled'}>Вернуть все умолчания</button>
    </div>
    ${groups}
  </div>`;
}

export function openTuning() {
  const box = $('tuneScreen');
  if (!box) return;
  box.innerHTML = html();
  box.classList.add('open');
  box.setAttribute('aria-hidden', 'false');
  $('tuneClose').onclick = closeTuning;
  $('tuneResetAll').onclick = () => { resetTune(); emit(); openTuning(); };
  box.querySelectorAll('[data-tune]').forEach(inp => {
    inp.onchange = () => {
      setTune(inp.dataset.tune, inp.value === '' ? null : +inp.value);
      emit();
      openTuning();                     // пересобираем: пометки и счётчик поехали
    };
  });
  box.querySelectorAll('[data-tune-reset]').forEach(b => {
    b.onclick = () => { resetTune(b.dataset.tuneReset); emit(); openTuning(); };
  });
}

export function closeTuning() {
  const box = $('tuneScreen');
  if (!box) return;
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '';
}

export function initTuning() {
  const btn = $('tuneBtn');
  if (btn) btn.onclick = openTuning;
  const box = $('tuneScreen');
  if (box) box.addEventListener('click', e => { if (e.target === box) closeTuning(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && box && box.classList.contains('open')) closeTuning();
  });
}
