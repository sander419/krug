// file: js/ui/kb.js
// Обучение: отдельный экран, а не всплывающее окно поверх работы. Три колонки —
// разделы слева, статья по центру, навигация по статье справа. Пока это было
// модальным окном, человек не понимал, где он находится и что читать дальше:
// список и текст делили один экран, а порядок статей нигде не был виден.
//
// Контент — js/config/kb/, UI ничего не знает про конкретные статьи.
import { ARTICLES, SECTIONS, LEARN_PATH, bySection, articleById, search, CONTEXT_HELP, helpArticleId }
  from '../config/kb/index.js';
import { $, esc } from './dom.js';
import { icon } from './icons.js';

let current = null, currentSection = SECTIONS[0].id, lastQuery = '';

/* блоки статьи -> html. В тексте разрешены только <b> и <i>, поэтому экранируем
   всё, кроме них. */
const rich = s => esc(s).replace(/&lt;(\/?)(b|i)&gt;/g, '<$1$2>');
const sectionOf = id => SECTIONS.find(s => s.id === id) || SECTIONS[0];

function blockHTML(b, i) {
  if (b.p) return `<p>${rich(b.p)}</p>`;
  if (b.h) return `<h4 id="h${i}">${rich(b.h)}</h4>`;
  if (b.ul) return `<ul>${b.ul.map(x => `<li>${rich(x)}</li>`).join('')}</ul>`;
  if (b.ol) return `<ol>${b.ol.map(x => `<li>${rich(x)}</li>`).join('')}</ol>`;
  if (b.note) return `<div class="kb-note">${rich(b.note)}</div>`;
  if (b.warn) return `<div class="kb-warn">${rich(b.warn)}</div>`;
  if (b.table) return `<div class="kb-table-wrap"><table class="kb-table">
      <thead><tr>${b.table.head.map(h => `<th>${rich(h)}</th>`).join('')}</tr></thead>
      <tbody>${b.table.rows.map(r => `<tr>${r.map(c => `<td>${rich(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  return '';
}

/* соседи по разделу: без «дальше» статья читается как тупик */
function neighbours(a) {
  const list = bySection(a.section);
  const i = list.findIndex(x => x.id === a.id);
  return {prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null};
}

function articleHTML(a) {
  const sec = sectionOf(a.section);
  const {prev, next} = neighbours(a);
  const src = (a.src || []).map(s =>
    `<li><a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a></li>`).join('');
  const step = LEARN_PATH.findIndex(p => p.id === a.id);
  return `<article class="kb-article">
    <div class="kb-crumb">${icon(sec.ico,14)} ${esc(sec.name)}${step >= 0 ? ` · шаг ${step + 1} курса` : ''}</div>
    <h3>${esc(a.title)}</h3>
    <p class="kb-lead">${rich(a.lead)}</p>
    ${(a.body || []).map(blockHTML).join('')}
    ${src ? `<div class="kb-src"><b>Источники</b><ul>${src}</ul></div>` : ''}
    <nav class="kb-steps" aria-label="Соседние статьи раздела">
      ${prev ? `<button class="kb-step" data-go="${prev.id}"><i>${icon('arrow-left',13)} Раньше</i><b>${esc(prev.title)}</b></button>`
             : '<span class="kb-step empty"></span>'}
      ${next ? `<button class="kb-step next" data-go="${next.id}"><i>Дальше ${icon('chevron-right',13)}</i><b>${esc(next.title)}</b></button>`
             : '<span class="kb-step empty"></span>'}
    </nav>
  </article>`;
}

/* ---------- обзор курса: экран, с которого видно, что здесь вообще есть ---------- */
function overviewHTML() {
  const path = LEARN_PATH.map((p, i) => {
    const a = articleById(p.id);
    if (!a) return '';
    return `<button class="path-step" data-go="${a.id}">
      <span class="path-num">${i + 1}</span>
      <span class="path-main"><b>${esc(a.title)}</b><span>${esc(p.why)}</span></span>
    </button>`;
  }).join('');
  const cards = SECTIONS.map(s => {
    const n = bySection(s.id).length;
    return `<button class="sec-card" data-sec="${s.id}">
      <span class="sec-ico">${icon(s.ico,22)}</span>
      <b>${esc(s.name)}</b>
      <span class="sec-note">${esc(s.note)}</span>
      <span class="sec-count">${n} ${n === 1 ? 'статья' : n < 5 ? 'статьи' : 'статей'}</span>
    </button>`;
  }).join('');
  return `<div class="kb-overview">
    <h3 class="ov-title">Обучение гончарному делу</h3>
    <p class="ov-lead">${ARTICLES.length} статей о том, что стоит за каждым числом в мастерской:
      из чего масса, почему трескается, что решает конус и как форма превращается в оснастку.
      Читать можно по порядку курса, а можно заходить сюда из панели по кнопке «?».</p>
    <h4 class="ov-h">С чего начать</h4>
    <div class="path">${path}</div>
    <h4 class="ov-h">Все разделы</h4>
    <div class="sec-grid">${cards}</div>
  </div>`;
}

/* ---------- правая колонка: где я в статье и куда идти дальше ---------- */
function asideHTML(a) {
  if (!a) return '';
  const heads = (a.body || []).map((b, i) => b.h ? {i, h: b.h} : null).filter(Boolean);
  const links = (a.links || []).map(id => {
    const t = articleById(id);
    return t ? `<button class="kb-link" data-go="${id}">${esc(t.title)}</button>` : '';
  }).join('');
  const tags = (a.tags || []).map(t => `<span class="kb-tag">${esc(t)}</span>`).join('');
  return (heads.length ? `<div class="aside-block">
      <div class="aside-title">В этой статье</div>
      <div class="aside-toc">${heads.map(x =>
        `<button class="toc-item" data-anchor="h${x.i}">${esc(x.h)}</button>`).join('')}</div>
    </div>` : '') +
    (links ? `<div class="aside-block">
      <div class="aside-title">Читать дальше</div>
      <div class="kb-links">${links}</div>
    </div>` : '') +
    (tags ? `<div class="aside-block">
      <div class="aside-title">Ключевые слова</div>
      <div class="kb-tags">${tags}</div>
    </div>` : '');
}

function bindGo(root) {
  root.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => openArticle(b.dataset.go); });
  root.querySelectorAll('[data-sec]').forEach(b => { b.onclick = () => showSection(b.dataset.sec); });
  root.querySelectorAll('[data-anchor]').forEach(b => {
    b.onclick = () => {
      const el = $('kbBody').querySelector('#' + b.dataset.anchor);
      if (el) $('kbBody').scrollTo({top: el.offsetTop - 12, behavior: 'smooth'});
    };
  });
}

function renderNav() {
  $('kbSections').innerHTML = SECTIONS.map(s =>
    `<button class="kb-sec${s.id === currentSection ? ' active' : ''}" data-sec="${s.id}" title="${esc(s.note)}">
      ${icon(s.ico,14)}${esc(s.name)}<i>${bySection(s.id).length}</i>
    </button>`).join('');
  $('kbSections').querySelectorAll('[data-sec]').forEach(b => { b.onclick = () => showSection(b.dataset.sec); });
}

function listHTML(items, title) {
  if (!items.length) return `<div class="empty">Ничего не нашлось.</div>`;
  return `<div class="kb-list-title">${esc(title)}</div>` + items.map((a, i) =>
    `<button class="kb-item${current && a.id === current.id ? ' active' : ''}" data-go="${a.id}">
      <b><span class="kb-item-n">${i + 1}</span>${esc(a.title)}</b>
      <span>${esc(a.lead.slice(0, 82))}${a.lead.length > 82 ? '…' : ''}</span>
    </button>`).join('');
}

function renderList() {
  const box = $('kbList');
  if (lastQuery.length >= 2) {
    const hits = search(lastQuery);
    box.innerHTML = listHTML(hits, `Найдено: ${hits.length}`);
  } else {
    const sec = sectionOf(currentSection);
    box.innerHTML = listHTML(bySection(currentSection), sec.note);
  }
  bindGo(box);
}

function renderCrumbs() {
  const c = $('learnCrumbs');
  if (!current) { c.innerHTML = '<b>Обзор курса</b>'; return; }
  const sec = sectionOf(current.section);
  c.innerHTML = `<button class="crumb" id="crumbHome">Обучение</button>${icon('chevron-right',13)}` +
    `<button class="crumb" data-sec="${sec.id}">${icon(sec.ico,14)}${esc(sec.name)}</button>${icon('chevron-right',13)}` +
    `<b>${esc(current.title)}</b>`;
  c.querySelectorAll('[data-sec]').forEach(b => { b.onclick = () => showSection(b.dataset.sec); });
  $('crumbHome').onclick = showOverview;
}

function showSection(id) {
  currentSection = id;
  lastQuery = ''; $('kbSearch').value = '';
  renderNav(); renderList();
  // на телефоне колонка одна: раздел показывает список, а не сразу первую статью
  if (matchMedia('(max-width:940px)').matches) {
    current = null;
    $('learn').classList.remove('reading');
    renderCrumbs();
    return;
  }
  const first = bySection(id)[0];
  if (first) openArticle(first.id);
}

export function showOverview() {
  current = null;
  openKB();
  renderNav(); renderList(); renderCrumbs();
  const body = $('kbBody');
  body.innerHTML = overviewHTML();
  body.scrollTop = 0;
  $('learnAside').innerHTML = '';
  $('learn').classList.remove('reading');
  bindGo(body);
  updateBar();
}

export function openArticle(id) {
  const a = articleById(id);
  if (!a) return;
  current = a;
  currentSection = a.section;
  openKB();
  renderNav(); renderList(); renderCrumbs();
  const body = $('kbBody');
  body.innerHTML = articleHTML(a);
  body.scrollTop = 0;
  $('learnAside').innerHTML = asideHTML(a);
  $('learn').classList.add('reading');
  bindGo(body); bindGo($('learnAside'));
  updateBar();
}

export function openContextHelp(key) {
  /* Разрешение ключа живёт в config/kb: им же пользуется проверка.
     Разрешай они порознь — проверка была бы зелёной при мёртвой кнопке. */
  const id = helpArticleId(key);
  if (id) openArticle(id);
}

/* полоса прочтения: видно, сколько ещё осталось */
function updateBar() {
  const b = $('kbBody'), bar = $('learnBar');
  if (!b || !bar) return;
  const max = b.scrollHeight - b.clientHeight;
  bar.style.width = (max > 20 ? Math.min(100, b.scrollTop / max * 100) : 0) + '%';
}

export function openKB() {
  const l = $('learn');
  if (l.classList.contains('open')) return;
  l.classList.add('open');
  l.setAttribute('aria-hidden', 'false');
  document.body.classList.add('learning');
  if (!current) showOverview();
}
function closeKB() {
  const l = $('learn');
  l.classList.remove('open');
  l.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('learning');
}

export function initKB() {
  renderNav();
  renderList();
  $('learnBack').onclick = closeKB;
  $('learnHome').onclick = showOverview;
  $('kbSearch').addEventListener('input', e => {
    lastQuery = e.target.value.trim();
    renderList();
  });
  $('kbBody').addEventListener('scroll', updateBar, {passive: true});
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('learning')) closeKB();
  });
  $('kbCount').textContent = `${ARTICLES.length} статей`;
}
