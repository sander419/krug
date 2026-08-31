// file: js/ui/works.js
// Мост между открытым рецептом и списком изделий.
//
// Сохранённая работа — это ДНК плюс производственный контекст (этап, факт,
// заметка); хранилище и схема живут в js/core/works.js, экран со списком —
// в js/ui/worksScreen.js. Здесь только связь с текущим состоянием: что сейчас
// открыто, как это сохранить и как открыть другое.
//
// Раньше список жил во всплывающей панели в шапке. Для версии 1.0 он стал
// главным экраном: мастер приходит не «строить профиль», а доделать своё
// изделие, и список — то, с чего он начинает.
//
// Всё лежит в localStorage этого браузера: сервера у КРУГа нет, и человеку
// об этом сказано прямо — иначе «сохранено» читается как «в облаке».
import { state, encodeDNA, applyDNA } from '../core/state.js';
import { loadWorks, getWork, upsertWork, patchWork, blankWork } from '../core/works.js';
import { sceneAPI } from '../three/scene.js';

const KEY_CUR = 'krug.work.current';
let onOpen = null;
let currentId = null;

try { currentId = localStorage.getItem(KEY_CUR) || null; } catch (_) {}

/** Список изделий: тот же, что показывает экран «Мои изделия». */
export const savedWorks = () => loadWorks();

/** Какая работа сейчас открыта. null — рецепт ещё не сохраняли. */
export function currentWork() {
  if (!currentId) return null;
  const w = getWork(currentId);
  if (!w) { currentId = null; remember(); }
  return w;
}
export const currentWorkId = () => currentId;

function remember() {
  try {
    if (currentId) localStorage.setItem(KEY_CUR, currentId);
    else localStorage.removeItem(KEY_CUR);
  } catch (_) {}
}

/* Миниатюра — кадр сцены, уменьшенный до 320 px по ширине. Список изделий
   без картинок читается как ведомость: человек узнаёт свою вазу по силуэту
   быстрее, чем по имени «Ваза 3». */
function thumbnail() {
  try {
    const r = sceneAPI.renderer();
    if (!r) return '';
    r.render(sceneAPI.scene(), sceneAPI.camera());
    const src = r.domElement;
    const w = 320, h = Math.round(src.height / src.width * w) || 240;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.72);
  } catch (_) { return ''; }
}

/**
 * Сохранить открытый рецепт под новым именем. Возвращает запись.
 * `opt.thumb === false` — без миниатюры: когда состояние подменено программно,
 * на сцене всё ещё стоит прежняя модель, и картинка соврёт.
 */
export function saveCurrentAs(name, opt = {}) {
  const rec = blankWork({
    name: String(name || state.name || 'Без названия').trim(),
    dna: encodeDNA(), thumb: opt.thumb === false ? '' : thumbnail(),
  });
  upsertWork(rec);
  currentId = rec.id;
  remember();
  state.name = rec.name;
  return rec;
}

/**
 * Сохранить текущую работу: обновить открытую запись или завести новую.
 * Возвращает имя — для сообщения.
 */
export function saveCurrent() {
  const cur = currentWork();
  if (cur) {
    patchWork(cur.id, {name: state.name || cur.name, dna: encodeDNA(), thumb: thumbnail()});
    return state.name || cur.name;
  }
  return saveCurrentAs(state.name || 'Без названия').name;
}

/** Открыть сохранённую работу целиком: рецепт и вся панель. */
export function openWorkRecord(id) {
  const w = getWork(id);
  if (!w || !applyDNA(w.dna)) return null;
  currentId = w.id;
  remember();
  if (onOpen) onOpen(w.name);
  return w.name;
}

/** Совместимость с прежним вызовом из «Производства». */
export const openWork = openWorkRecord;

/** Переписать ДНК сохранённой работы (правка тиража прямо в списке). */
export function updateWorkDNA(id, dna) {
  return !!patchWork(id, {dna});
}

/** Оставить работу в списке, но забыть, что она открыта. */
export function forgetCurrent() { currentId = null; remember(); }

export function initWorks(openedFn) {
  onOpen = openedFn;
  /* Ctrl+S — сохранить: единственная горячая клавиша, которую тут ждут. */
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveCurrent();
    }
  });
}
