// file: js/ui/photo.js
// Обводка картинки: фотография изделия или чертёж → профиль.
//
// Проще всего форму объяснить не ползунками и не мышью, а картинкой: «вот такой
// кувшин». Здесь только показ и настройка; сам силуэт снимает js/core/silhouette.js,
// а в рецепт его переводит тот же js/core/trace.js, что и нарисованную линию.
//
// Картинка никуда не уходит: файл читается в браузере, наружу не отправляется
// ничего — у КРУГа внешних запросов нет принципиально, и обводка это не меняет.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { traceImage } from '../core/silhouette.js';
import { traceToRecipe } from '../core/trace.js';
import { $ } from './dom.js';
import { icon } from './icons.js';
import { pal } from './palette.js';

const MAX_SIDE = 400;          // картинку ужимаем: детальнее силуэт не станет
let img = null;                // {data,width,height} — пиксели уменьшенной копии
let bitmap = null;             // сама картинка для показа
let mode = 'auto';
let threshold = 0.25;
let onApplied = null;

/* ---------- чтение файла ---------- */
async function loadFile(file) {
  let src = null;
  try { src = await createImageBitmap(file); }
  catch (_) {
    src = await new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('не картинка')); };
      im.src = url;
    });
  }
  const w = src.width, h = src.height;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * k)), ch = Math.max(2, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(src, 0, 0, cw, ch);
  bitmap = src;
  img = ctx.getImageData(0, 0, cw, ch);
}

/* ---------- экран ---------- */
function html() {
  return `<div class="photo-card" role="dialog" aria-label="Обводка картинки">
    <div class="guide-head">
      <h2>Обвести картинку</h2>
      <button class="btn icon" id="photoClose" title="Закрыть (Esc)" aria-label="Закрыть">${icon('x')}</button>
    </div>
    <p class="guide-lead">У тела вращения силуэт и есть профиль. КРУГ ищет край изделия на фоне
      и снимает с него радиус по высоте. Картинка остаётся в браузере — наружу не уходит ничего.</p>
    <div class="photo-body">
      <canvas id="photoCanvas"></canvas>
      <div class="photo-side">
        <div class="slider-row">
          <div class="slider-head"><span>Порог</span><output id="photoThOut"></output></div>
          <input type="range" id="photoTh" min="5" max="70" step="1" value="25" aria-label="Порог">
        </div>
        <p class="hint">Насколько цвет должен отличаться от фона. Мало — в силуэт полезет тень,
          много — потеряется тёмный край.</p>
        <div class="seg" id="photoMode" role="group" aria-label="Что на картинке">
          <button data-pmode="auto" class="active">Само</button>
          <button data-pmode="whole">Целое</button>
          <button data-pmode="half">Половина</button>
        </div>
        <p class="hint" id="photoVerdict"></p>
      </div>
    </div>
    <div class="guide-foot">
      <button class="btn primary" id="photoApply">Обвести</button>
      <button class="btn" id="photoAnother">Другая картинка</button>
      <span class="guide-hint">Обводка заменит силуэт целиком; вернуть — Ctrl+Z</span>
    </div>
  </div>`;
}

function trace() {
  return img ? traceImage(img, {threshold, mode}) : null;
}

function render() {
  const c = $('photoCanvas');
  if (!c || !img) return;
  const dpr = Math.min(devicePixelRatio, 2);
  const box = c.getBoundingClientRect();
  const W = Math.max(1, box.width), H = Math.max(1, W * img.height / img.width);
  c.style.height = H + 'px';
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bitmap, 0, 0, W, H);

  const P = pal();
  const got = trace();
  const v = $('photoVerdict');
  if (!got) {
    ctx.fillStyle = P.sunken(.55); ctx.fillRect(0, 0, W, H);
    if (v) v.textContent = 'Силуэт не найден: подвиньте порог или возьмите картинку с ровным фоном.';
    const ap = $('photoApply'); if (ap) ap.disabled = true;
    return;
  }
  const ap = $('photoApply'); if (ap) ap.disabled = false;
  const k = W / img.width;
  const toPx = p => ({x: (got.axis + p.r) * k, y: (got.bottom - p.y) * k});
  ctx.lineWidth = 2; ctx.strokeStyle = P.accent2();
  ctx.beginPath();
  got.points.forEach((p, i) => { const q = toPx(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
  ctx.stroke();
  if (!got.half) {                       // у целого изделия обводим и левый край
    ctx.beginPath();
    got.points.forEach((p, i) => {
      const q = toPx(p); const x = 2 * got.axis * k - q.x;
      i ? ctx.lineTo(x, q.y) : ctx.moveTo(x, q.y);
    });
    ctx.stroke();
  }
  ctx.setLineDash([5, 5]); ctx.strokeStyle = P.accent(.9);
  ctx.beginPath(); ctx.moveTo(got.axis * k, 0); ctx.lineTo(got.axis * k, H); ctx.stroke();
  ctx.setLineDash([]);

  const rec = traceToRecipe(got.points);
  if (v) v.textContent = rec
    ? `${got.half ? 'Половина сечения' : 'Целое изделие'} · выйдет ${(rec.H / 10).toFixed(1)}×${(rec.D / 10).toFixed(1)} см, точек ${rec.points.length}.`
    : 'Силуэт нашёлся, но в профиль не складывается — попробуйте другой порог.';
  if (ap) ap.disabled = !rec;
}

function apply() {
  const got = trace();
  const rec = got && traceToRecipe(got.points);
  if (!rec) return false;
  state.points = rec.points;
  state.H = rec.H; state.D = rec.D;
  state.activePreset = -1;
  emit();
  close();
  if (onApplied) onApplied({H: rec.H, D: rec.D, points: rec.points.length, half: got.half});
  return true;
}

function close() {
  const box = $('photoScreen');
  if (!box) return;
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
}

function open() {
  const box = $('photoScreen');
  if (!box) return;
  box.innerHTML = html();
  box.classList.add('open');
  box.setAttribute('aria-hidden', 'false');
  $('photoClose').onclick = close;
  $('photoApply').onclick = apply;
  $('photoAnother').onclick = () => $('photoFile').click();
  const th = $('photoTh');
  th.value = Math.round(threshold * 100);
  $('photoThOut').textContent = th.value + '%';
  th.oninput = () => { threshold = +th.value / 100; $('photoThOut').textContent = th.value + '%'; render(); };
  box.querySelectorAll('[data-pmode]').forEach(b => {
    b.classList.toggle('active', b.dataset.pmode === mode);
    b.onclick = () => {
      mode = b.dataset.pmode;
      box.querySelectorAll('[data-pmode]').forEach(x => x.classList.toggle('active', x === b));
      render();
    };
  });
  requestAnimationFrame(render);
}

export function initPhoto(applied) {
  onApplied = applied || null;
  const file = $('photoFile'), btn = $('photoBtn');
  if (!file || !btn) return;
  btn.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files && file.files[0];
    file.value = '';                      // тот же файл можно выбрать снова
    if (!f) return;
    try { await loadFile(f); } catch (_) { if (onApplied) onApplied(null); return; }
    open();
  };
  const box = $('photoScreen');
  if (box) box.addEventListener('click', e => { if (e.target === box) close(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && box && box.classList.contains('open')) close();
  });
  addEventListener('resize', () => { if (box && box.classList.contains('open')) render(); });
}
