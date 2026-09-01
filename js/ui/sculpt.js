// file: js/ui/sculpt.js
// Лепка прямо на модели: форма правится там, где на неё смотрят.
//
// Профиль всегда правился на чертеже сбоку. Это точно, но неудобно: человек
// смотрит на вазу в 3D, видит, что горловина широковата, — и уходит искать
// нужную точку в соседнем окне, мысленно переводя одно в другое. Здесь то же
// самое делается пальцем по самой вазе.
//
// Устройство простое и без своей математики: луч из точки экрана даёт высоту
// и радиус на стенке (`sceneAPI.pick`), по высоте находится ближайшая
// контрольная точка профиля, дальше меняется её радиус. Кривая, масса, прочность
// и G-code пересчитываются тем же путём, что и при правке на чертеже, — здесь
// только другой способ взяться за форму.
//
// Два решения, без которых это не работает:
//
//   • **Режим.** Пока левая кнопка вращает камеру, ею же нельзя тянуть глину.
//     Поэтому лепка — отдельный режим: кнопка в панели вида, и в нём орбита
//     переезжает на правую кнопку и на два пальца.
//   • **Указатель.** Кольцо на высоте правки и подпись с диаметром: иначе
//     непонятно, за какое место взялся и что получится.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { sceneAPI } from '../three/scene.js';
import { clamp } from '../core/util.js';
import { $, num } from './dom.js';
import { toast } from './overlays.js';
import { highlightPoint, selectPoint, syncPointBar } from './editor.js';

let on = false, dragIdx = -1, hud = null, canvas = null;
let spinBefore = null;               // вращение круга, каким оно было до лепки

/* Кнопка вращения в панели вида отражает состояние: иначе круг стоит,
   а кнопка говорит, что крутится. */
function syncSpinButton() {
  const b = $('spinBtn');
  if (b) b.classList.toggle('active', !!state.spin);
}

/* Ползунок диаметра в панели должен показать то же число, что и модель:
   молчаливое расхождение подписи и вещи — худшее, что может случиться. */
function syncDiameterSlider() {
  const sl = $('diamSl');
  if (sl) sl.value = (state.D / 10).toFixed(1);
}

/** Ближайшая к этой высоте контрольная точка профиля. */
function nearestPoint(yMM) {
  const t = clamp(yMM / Math.max(state.H, 1), 0, 1);
  let best = 0, bd = Infinity;
  state.points.forEach((p, i) => {
    const d = Math.abs(p.t - t);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function showHUD(clientX, clientY, text) {
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'sculpt-hud';
    document.body.appendChild(hud);
  }
  hud.textContent = text;
  hud.style.left = clientX + 'px';
  hud.style.top = clientY + 'px';
  hud.hidden = false;
}
const hideHUD = () => { if (hud) hud.hidden = true; };

/** Подпись у курсора: что сейчас под пальцем и что получится. */
function label(hit, idx) {
  const y = hit.y;
  const d = hit.r * 2;
  const which = idx === 0 ? 'дно' : idx === state.points.length - 1 ? 'кромка' : `точка ${idx + 1}`;
  return `${which} · Ø ${num(d / 10, 1)} см · высота ${num(y / 10, 1)} см`;
}

function onMove(e) {
  if (!on) return;
  const hit = sceneAPI.pick(e.clientX, e.clientY);
  if (dragIdx >= 0) {
    /* Тянем радиус выбранной точки. Высоту не трогаем: на модели её всё равно
       не видно точно, а чертёж рядом для этого и есть. */
    const p = state.points[dragIdx];
    /* Радиус берём в плоскости силуэта, а не по попаданию в стенку: иначе,
       уведя курсор за край вазы, человек теряет хват на полпути. */
    const surf = sceneAPI.pickSilhouette(e.clientX, e.clientY);
    if (!surf) return;
    if (e.altKey && dragIdx === state.points.length - 1) {
      /* Кромку тянут вверх — растёт вся вещь. Без этого высоту нельзя было
         менять на модели вовсе: диаметр рос, а высота — только ползунком. */
      const grow = clamp(surf.y / Math.max(state.H, 1), 0.5, 1.05);
      state.H = clamp(state.H * Math.min(grow, 1.03), 50, 400);
      const sl = $('heightSl');
      if (sl) sl.value = (state.H / 10).toFixed(1);
      state.activePreset = -1;
      sceneAPI.ring(state.H, p.r * state.D / 2, true);
      showHUD(e.clientX, e.clientY, `высота ${num(state.H / 10, 1)} см`);
      emit();
      return;
    }
    if (e.altKey && dragIdx > 0 && dragIdx < state.points.length - 1) {
      /* Alt тянет точку по высоте: на модели это второй естественный жест,
         а спорить с радиусом он не будет — их разводит клавиша. */
      const t = clamp(surf.y / Math.max(state.H, 1),
        state.points[dragIdx - 1].t + 0.02, state.points[dragIdx + 1].t - 0.02);
      p.t = t;
      state.activePreset = -1;
      sceneAPI.ring(p.t * state.H, p.r * state.D / 2, true);
      showHUD(e.clientX, e.clientY, `высота ${num(p.t * state.H / 10, 1)} см`);
      emit();
      return;
    }
    const rMax = state.D / 2;
    /* Мелкий шаг по Shift: то же соглашение, что и у ползунков. */
    let want = e.shiftKey ? p.r + (surf.r / rMax - p.r) * 0.25 : surf.r / rMax;
    /* Тянут шире самого широкого места — растёт вся вещь, а не упирается
       в невидимую стену. Остальные точки при этом не должны шелохнуться,
       поэтому их доли пересчитываются под новый диаметр. */
    if (want > 1.02 && state.D < 400) {
      /* Растём мелкими шагами: за одно движение мыши — не больше трёх процентов.
         Иначе на узком экране один жест в семь сантиметров раздувал вазу втрое,
         и «потянул чуть шире» превращалось в «потерял форму». */
      const grow = Math.min(want, 1.03);
      const newD = clamp(state.D * grow, 50, 400);
      const k = state.D / newD;
      for (const q of state.points) if (q !== p) q.r = clamp(q.r * k, 0.02, 1);
      state.D = newD;
      want = 1;
      syncDiameterSlider();
    }
    p.r = clamp(want, 0.04, 1);
    state.activePreset = -1;
    sceneAPI.ring(surf.y, p.r * state.D / 2, true);
    showHUD(e.clientX, e.clientY,
      `Ø ${num(p.r * state.D / 10, 1)} см${e.shiftKey ? ' · точно' : ''}`);
    emit();
    syncPointBar();
    return;
  }
  if (!hit) { hideHUD(); sceneAPI.ring(0, 0, false); highlightPoint(-1); return; }
  const idx = nearestPoint(hit.y);
  sceneAPI.ring(state.points[idx].t * state.H, state.points[idx].r * state.D / 2, true);
  /* Та же точка подсвечивается на чертеже: два вида показывают одно место,
     и человек перестаёт переводить одно в другое в голове. */
  highlightPoint(idx);
  showHUD(e.clientX, e.clientY, label(hit, idx));
}

function onDown(e) {
  if (!on || e.button === 2) return;
  const hit = sceneAPI.pick(e.clientX, e.clientY);
  if (!hit) return;
  e.preventDefault();
  dragIdx = nearestPoint(hit.y);
  /* Тянут на модели — та же точка выбирается на чертеже: рядом сразу видно
     её числа, и после грубой тяги можно поставить ровное значение. */
  selectPoint(dragIdx);
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
}

function onUp() {
  if (dragIdx < 0) return;
  dragIdx = -1;
  emit();
  /* Вытянули вещь шире кадра — камера отходит. Не «всегда подгонять»:
     самовольно двигать вид, когда всё и так видно, раздражает сильнее. */
  const f = sceneAPI.fitInfo && sceneAPI.fitInfo();
  if (f && f.need > f.have * 1.02) sceneAPI.refit();
}

/** Двойной клик по стенке добавляет точку на этой высоте. */
function onDouble(e) {
  if (!on) return;
  const hit = sceneAPI.pick(e.clientX, e.clientY);
  if (!hit) return;
  const t = clamp(hit.y / Math.max(state.H, 1), 0.02, 0.98);
  const i = state.points.findIndex(p => p.t > t);
  if (i <= 0) return;
  const a = state.points[i - 1], b = state.points[i];
  if (Math.abs(a.t - t) < 0.02 || Math.abs(b.t - t) < 0.02) return;
  const k = (t - a.t) / (b.t - a.t);
  state.points.splice(i, 0, {t, r: a.r + (b.r - a.r) * k});
  state.activePreset = -1;
  emit();                              // историю ведёт подписка на изменения
  toast('Точка добавлена — тяните её прямо на модели');
}

/** Включить или выключить лепку. */
export function setSculpt(next) {
  on = !!next;
  sceneAPI.setSculpt(on);
  /* Круг на время лепки останавливается: по вращающейся вазе рельеф и точка
     уезжают из-под курсора, и «тяну сюда» превращается в «тяну куда-то». */
  if (on) {
    spinBefore = state.spin;
    if (state.spin) { state.spin = false; syncSpinButton(); }
  } else if (spinBefore !== null) {
    state.spin = spinBefore;
    spinBefore = null;
    syncSpinButton();
  }
  sceneAPI.ring(0, 0, false);
  hideHUD();
  highlightPoint(-1);
  const b = $('sculptBtn');
  if (b) {
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const vp = $('viewport');
  if (vp) vp.dataset.sculpt = on ? '1' : '0';
  if (on) toast('Лепка: тяните стенку. Alt — поднять точку, двойной клик — добавить. ' +
    'Круг остановлен, камера — правой кнопкой или двумя пальцами');
}

export function initSculpt() {
  canvas = sceneAPI.renderer() && sceneAPI.renderer().domElement;
  if (!canvas) return;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', () => { hideHUD(); if (dragIdx < 0) sceneAPI.ring(0, 0, false); });
  canvas.addEventListener('dblclick', onDouble);
  /* Правая кнопка в режиме лепки крутит камеру — значит своё меню браузера
     здесь только мешает. */
  canvas.addEventListener('contextmenu', e => { if (on) e.preventDefault(); });

  const b = $('sculptBtn');
  if (b) b.onclick = () => setSculpt(!on);
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && on) setSculpt(false);
  });
}
