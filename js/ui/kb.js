// file: js/ui/kb.js
// Энциклопедия: разделы, поиск, статья. Контент — js/config/kb/, UI ничего не знает
// про конкретные статьи и растёт вместе с базой.
import { ARTICLES, SECTIONS, bySection, articleById, search, CONTEXT_HELP } from '../config/kb/index.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
let current=null, currentSection=SECTIONS[0].id, lastQuery='';

/* блоки статьи -> html. В тексте разрешены только <b> и <i>, поэтому экранируем
   всё, кроме них. */
const rich=s=>esc(s).replace(/&lt;(\/?)(b|i)&gt;/g,'<$1$2>');

function blockHTML(b){
  if(b.p) return `<p>${rich(b.p)}</p>`;
  if(b.h) return `<h4>${rich(b.h)}</h4>`;
  if(b.ul) return `<ul>${b.ul.map(x=>`<li>${rich(x)}</li>`).join('')}</ul>`;
  if(b.ol) return `<ol>${b.ol.map(x=>`<li>${rich(x)}</li>`).join('')}</ol>`;
  if(b.note) return `<div class="kb-note">${rich(b.note)}</div>`;
  if(b.warn) return `<div class="kb-warn">${rich(b.warn)}</div>`;
  if(b.table) return `<div class="kb-table-wrap"><table class="kb-table">
      <thead><tr>${b.table.head.map(h=>`<th>${rich(h)}</th>`).join('')}</tr></thead>
      <tbody>${b.table.rows.map(r=>`<tr>${r.map(c=>`<td>${rich(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  return '';
}

function articleHTML(a){
  const links=(a.links||[]).map(id=>{
    const t=articleById(id);
    return t?`<button class="kb-link" data-go="${id}">${esc(t.title)}</button>`:'';
  }).join('');
  const src=(a.src||[]).map(s=>`<li><a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a></li>`).join('');
  return `<article class="kb-article">
    <div class="kb-crumb">${esc((SECTIONS.find(s=>s.id===a.section)||{}).name||'')}</div>
    <h3>${esc(a.title)}</h3>
    <p class="kb-lead">${rich(a.lead)}</p>
    ${(a.body||[]).map(blockHTML).join('')}
    ${src?`<div class="kb-src"><b>Источники</b><ul>${src}</ul></div>`:''}
    ${links?`<div class="kb-next"><b>Читать дальше</b><div class="kb-links">${links}</div></div>`:''}
  </article>`;
}

function listHTML(items, title){
  if(!items.length) return `<div class="empty">Ничего не нашлось.</div>`;
  return `<div class="kb-list-title">${esc(title)}</div>`+items.map(a=>
    `<button class="kb-item${current&&a.id===current.id?' active':''}" data-go="${a.id}">
      <b>${esc(a.title)}</b><span>${esc(a.lead.slice(0,86))}${a.lead.length>86?'…':''}</span>
    </button>`).join('');
}

function bindGo(root){
  root.querySelectorAll('[data-go]').forEach(b=>{b.onclick=()=>openArticle(b.dataset.go);});
}

function renderNav(){
  $('kbSections').innerHTML=SECTIONS.map(s=>
    `<button class="kb-sec${s.id===currentSection?' active':''}" data-sec="${s.id}" title="${esc(s.note)}">
      <span>${s.ico}</span>${esc(s.name)}<i>${bySection(s.id).length}</i>
    </button>`).join('');
  $('kbSections').querySelectorAll('[data-sec]').forEach(b=>{
    b.onclick=()=>{currentSection=b.dataset.sec;lastQuery='';$('kbSearch').value='';renderList();renderNav();};
  });
}

function renderList(){
  const box=$('kbList');
  if(lastQuery.length>=2){
    const hits=search(lastQuery);
    box.innerHTML=listHTML(hits,`Найдено: ${hits.length}`);
  }else{
    const sec=SECTIONS.find(s=>s.id===currentSection);
    box.innerHTML=listHTML(bySection(currentSection), sec?sec.note:'');
  }
  bindGo(box);
}

export function openArticle(id){
  const a=articleById(id);
  if(!a)return;
  current=a;
  currentSection=a.section;
  openKB();
  renderNav();
  renderList();
  const body=$('kbBody');
  body.innerHTML=articleHTML(a);
  body.scrollTop=0;
  bindGo(body);
}

export function openContextHelp(key){
  const id=CONTEXT_HELP[key];
  if(id) openArticle(id);
}

export function openKB(){
  const o=$('kbOverlay');
  if(o.classList.contains('open'))return;
  o.classList.add('open');
  o.setAttribute('aria-hidden','false');
  if(!current) openArticle(ARTICLES[0].id);
}
export function closeKB(){
  const o=$('kbOverlay');
  o.classList.remove('open');
  o.setAttribute('aria-hidden','true');
}

export function initKB(){
  renderNav();
  renderList();
  $('kbClose').onclick=closeKB;
  $('kbOverlay').addEventListener('click',e=>{if(e.target.id==='kbOverlay')closeKB();});
  $('kbSearch').addEventListener('input',e=>{
    lastQuery=e.target.value.trim();
    renderList();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&$('kbOverlay').classList.contains('open'))closeKB();
  });
  $('kbCount').textContent=`${ARTICLES.length} статей`;
}
