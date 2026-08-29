// file: js/ui/environment.js
// Выбор окружения вокруг модели. Это настройка вида, а не рецепта, поэтому
// живёт рядом с темой и масштабом в шапке и хранится локально: в ДНК формы
// ей делать нечего — ссылка передаёт изделие, а не свет в комнате.
import { $ } from './dom.js';
import { icon } from './icons.js';
import { ENVIRONMENTS, byEnvId } from '../config/environments.js';
import { sceneAPI } from '../three/scene.js';

const KEY = 'krug.env';
let current = 'workshop';

function render() {
  const pop = $('envPop');
  pop.innerHTML = ENVIRONMENTS.map(e => `
    <button class="env-item${e.id === current ? ' active' : ''}" data-env="${e.id}">
      <span class="env-ico">${icon(e.ico, 17)}</span>
      <span class="env-main"><b>${e.name}</b><span>${e.note}</span></span>
    </button>`).join('');
  pop.querySelectorAll('[data-env]').forEach(b => {
    b.onclick = () => { select(b.dataset.env); close(); };
  });
}

function select(id) {
  current = byEnvId(id).id;
  try { localStorage.setItem(KEY, current); } catch (_) {}
  sceneAPI.setEnvironment(current);
  // виньетка хороша в мастерской и в витрине, но портит снимок в каталог
  const vp = $('viewport');
  if (vp) vp.dataset.env = current;
  const b = $('envBtn');
  if (b) b.title = `Окружение: ${byEnvId(current).name}`;
  render();
}

function open() {
  $('envPop').classList.add('open');
  $('envBtn').setAttribute('aria-expanded', 'true');
}
function close() {
  $('envPop').classList.remove('open');
  $('envBtn').setAttribute('aria-expanded', 'false');
}

export function initEnvironment() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) {}
  current = byEnvId(saved).id;
  sceneAPI.setEnvironment(current);
  const vp = $('viewport');
  if (vp) vp.dataset.env = current;
  render();
  const b = $('envBtn');
  b.title = `Окружение: ${byEnvId(current).name}`;
  b.onclick = e => {
    e.stopPropagation();
    $('envPop').classList.contains('open') ? close() : open();
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('#envPop,#envBtn')) close();
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
