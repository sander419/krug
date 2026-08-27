// file: js/ui/library.js
// Вкладка «Материал»: библиотека масс с рынка. Список строится из реестра —
// новая запись в js/config/materials.js появляется здесь сама, править UI не нужно.
import { state } from '../core/state.js';
import { emit } from '../core/bus.js';
import { MATERIALS, MATERIAL_TYPES, byId, density, densityIsEstimated,
         tablewareReady, typeName } from '../config/materials.js';
import { sceneAPI } from '../three/scene.js';
import { openArticle } from './kb.js';

const $=id=>document.getElementById(id);
const hex=n=>'#'+n.toString(16).padStart(6,'0');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let filterType='all', onlyTableware=false;

function matches(m){
  if(filterType!=='all' && m.type!==filterType) return false;
  if(onlyTableware && !tablewareReady(m)) return false;
  return true;
}

function rowHTML(m){
  const top=[...m.absorption].sort((a,b)=>a.tempC-b.tempC).pop();
  const grog=m.grog.percent>0?`шамот ${m.grog.percent} % · ${m.grog.grainMM} мм`:'без шамота';
  return `<button class="mat-row${m.id===state.mat?' active':''}" data-id="${m.id}" title="${esc(m.vendor)}">
    <span class="mat-dot" style="background:${hex(m.colors.raw)}"></span>
    <span class="mat-main">
      <span class="mat-name">${esc(m.name)}${tablewareReady(m)?'<i class="mat-food" title="черепок спекается — годится для посуды">посудная</i>':''}</span>
      <span class="mat-sub">${esc(typeName(m.type))} · ${m.firing.glazeC[0]}–${m.firing.glazeC[1]} °С · усадка ${m.shrinkPct} %</span>
      <span class="mat-sub dim">${grog} · водопоглощение ${top.pct} % при ${top.tempC} °С</span>
    </span>
  </button>`;
}

function detailHTML(m){
  const est=f=>m.est.includes(f)?'<i class="est" title="оценка, а не паспортное значение">оценка</i>':'';
  const abs=m.absorption.map(a=>`${a.pct} % при ${a.tempC} °С${a.note?` (${esc(a.note)})`:''}`).join('<br>');
  const src=m.src.map(s=>`<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join('<br>');
  return `
  <div class="mat-card">
    <div class="mat-card-head">
      <b>${esc(m.name)}</b>
      <span class="dim">${esc(m.vendor)}</span>
    </div>
    <p class="mat-note">${esc(m.note)}</p>
    <dl class="spec">
      <dt>Тип</dt><dd>${esc(typeName(m.type))} — ${esc(MATERIAL_TYPES[m.type].note)}</dd>
      <dt>Обжиг</dt><dd>утиль ${m.firing.bisqueC[0]}–${m.firing.bisqueC[1]} °С · политой ${m.firing.glazeC[0]}–${m.firing.glazeC[1]} °С</dd>
      <dt>Усадка</dt><dd>${m.shrinkPct} %${m.shrinkNote?` <span class="dim">(${esc(m.shrinkNote)})</span>`:''}</dd>
      <dt>Водопоглощение</dt><dd>${abs}</dd>
      <dt>Шамот</dt><dd>${m.grog.percent>0?`${m.grog.percent} %, зерно до ${m.grog.grainMM} мм`:'нет'}</dd>
      <dt>Плотность сырой</dt><dd>${density(m).toFixed(2)} г/см³ ${densityIsEstimated(m)?est('density'):`<span class="dim">(из влажности ${m.moisturePct} %)</span>`}</dd>
      <dt>CTE черепка</dt><dd>${m.cte} ·10⁻⁶/°C ${est('cte')}</dd>
      <dt>Назначение</dt><dd>${m.uses.map(esc).join(' · ')}</dd>
      <dt>Фасовка</dt><dd>${esc(m.pack||'—')}${m.priceRub?` · ориентир ${m.priceRub} ₽`:''}</dd>
      <dt>Источник</dt><dd class="src">${src}</dd>
    </dl>
    <div class="mat-actions">
      <button class="btn small" data-kb="choose-mass">Как выбрать массу</button>
      <button class="btn small" data-kb="shrinkage">Про усадку</button>
      ${m.grog.percent>0?'<button class="btn small" data-kb="grog">Про шамот</button>':''}
    </div>
    <div class="footnote">Числа — из паспорта поставщика по ссылке. Помеченное «оценка» посчитано по типу массы: плотность выводится из влажности, CTE взят ориентировочно для сравнения с глазурью.</div>
  </div>`;
}

function renderList(){
  const list=MATERIALS.filter(matches);
  $('matList').innerHTML = list.length
    ? list.map(rowHTML).join('')
    : '<div class="empty">Под фильтр ничего не подходит.</div>';
  $('matList').querySelectorAll('.mat-row').forEach(b=>{
    b.onclick=()=>selectMaterial(b.dataset.id);
  });
  $('matCount').textContent = `${list.length} из ${MATERIALS.length}`;
}

function renderDetail(){
  const m=byId(state.mat);
  $('matDetail').innerHTML=detailHTML(m);
  $('matDetail').querySelectorAll('[data-kb]').forEach(b=>{
    b.onclick=()=>openArticle(b.dataset.kb);
  });
}

export function selectMaterial(id){
  if(!MATERIALS.some(m=>m.id===id))return;
  state.mat=id;
  syncLibrary();
  sceneAPI.applyMaterial(state);
  emit();
}

export function syncLibrary(){
  renderList();
  renderDetail();
  document.querySelectorAll('#firingSeg button').forEach(b=>b.classList.toggle('active',b.dataset.f===state.firing));
}

export function initLibrary(){
  const types=[['all','Все']].concat(Object.entries(MATERIAL_TYPES).map(([k,v])=>[k,v.name]));
  $('matFilters').innerHTML=types.map(([k,n])=>
    `<button class="chip-btn${k==='all'?' active':''}" data-type="${k}">${esc(n)}</button>`).join('')
    +`<button class="chip-btn" id="matFood" title="черепок спекается: водопоглощение не выше 3 %">только посудные</button>`;
  $('matFilters').querySelectorAll('[data-type]').forEach(b=>{
    b.onclick=()=>{
      filterType=b.dataset.type;
      $('matFilters').querySelectorAll('[data-type]').forEach(x=>x.classList.toggle('active',x===b));
      renderList();
    };
  });
  $('matFood').onclick=e=>{
    onlyTableware=!onlyTableware;
    e.currentTarget.classList.toggle('active',onlyTableware);
    renderList();
  };
  $('firingSeg').querySelectorAll('button').forEach(b=>{
    b.onclick=()=>{
      state.firing=b.dataset.f;
      document.querySelectorAll('#firingSeg button').forEach(x=>x.classList.toggle('active',x===b));
      sceneAPI.applyMaterial(state);
    };
  });
  syncLibrary();
}
