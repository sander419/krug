// file: js/ui/works.js
// Сохранённые работы. Автосохранение возвращает последнюю форму, ссылка передаёт
// её другому человеку — но обе не дают держать несколько работ рядом и вернуться
// к позавчерашней. Здесь именованный список: та же ДНК плюс имя и дата.
//
// Всё лежит в localStorage этого браузера: сервера у КРУГа нет и не будет,
// и человеку об этом сказано прямо — иначе «сохранено» читается как «в облаке».
import { $, esc } from './dom.js';
import { anchorPop } from './pop.js';
import { icon } from './icons.js';
import { state, encodeDNA, applyDNA } from '../core/state.js';
import { emit } from '../core/bus.js';

const KEY = 'krug.works';
const LIMIT = 40;
let onOpen = null;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (_) { return []; }
}

/** Список работ для «Производства»: [{id, name, dna, ts}]. */
export const savedWorks = () => load();
function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT))); } catch (_) {}
}

const when = ts => {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Сохранить текущую работу под её именем. Возвращает имя — для сообщения. */
export function saveCurrent() {
  const list = load();
  const name = (state.name || 'Без названия').trim();
  const same = list.findIndex(w => w.name === name);
  if (same >= 0) list.splice(same, 1);        // одно имя — одна запись, а не десять «Ваза»
  list.unshift({id: String(Date.now()), name, dna: encodeDNA(), ts: Date.now()});
  save(list);
  return name;
}

function render() {
  const list = load();
  const rows = list.length ? list.map(w => `
    <div class="work-row">
      <button class="work-open" data-open="${w.id}" title="Открыть эту работу">
        <b>${esc(w.name)}</b><span>${when(w.ts)}</span>
      </button>
      <button class="work-del" data-del="${w.id}" title="Удалить из списка" aria-label="Удалить">${icon('trash-2', 14)}</button>
    </div>`).join('')
    : '<div class="empty">Пока пусто. Сохраните текущую работу — она останется в этом браузере.</div>';
  $('worksPop').innerHTML = `
    <button class="btn primary wide" id="workSave">${icon('save')}Сохранить текущую</button>
    <div class="work-list">${rows}</div>
    <p class="note">Список живёт в этом браузере: у КРУГа нет сервера. Чтобы работа
      пережила смену устройства, скопируйте ДНК — она лежит в ссылке.</p>`;

  // список работ читает «Производство» — после правки списка его надо пересобрать
  $('workSave').onclick = () => { saveCurrent(); render(); emit(); };
  $('worksPop').querySelectorAll('[data-open]').forEach(b => {
    b.onclick = () => {
      const w = load().find(x => x.id === b.dataset.open);
      if (w && applyDNA(w.dna)) { close(); onOpen && onOpen(w.name); }
    };
  });
  $('worksPop').querySelectorAll('[data-del]').forEach(b => {
    b.onclick = () => { save(load().filter(x => x.id !== b.dataset.del)); render(); emit(); };
  });
}

let detach = null;

function close() {
  $('worksPop').classList.remove('open');
  $('worksBtn').setAttribute('aria-expanded', 'false');
  if (detach) { detach(); detach = null; }   // иначе слежение висит после закрытия
}

export function initWorks(openedFn) {
  onOpen = openedFn;
  render();
  $('worksBtn').onclick = e => {
    e.stopPropagation();
    const pop = $('worksPop');
    if (pop.classList.contains('open')) { close(); return; }
    render();
    pop.classList.add('open');
    $('worksBtn').setAttribute('aria-expanded', 'true');
    detach = anchorPop($('worksBtn'), pop);
  };
  document.addEventListener('click', e => { if (!e.target.closest('#worksPop,#worksBtn')) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
