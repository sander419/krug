// file: js/ui/glazeLab.js
import { state } from '../core/state.js';
import { onChange, emit } from '../core/bus.js';
import { evaluateGlaze } from '../core/glaze.js';
import { coatWarnings } from '../core/glazeCoat.js';
import { byId } from '../config/materials.js';
import { GLAZES, GLAZE_FAMILIES, byGlazeId, firingFit } from '../config/glazes.js';
import { sceneAPI } from '../three/scene.js';
import { hookSlider } from './panels.js';
import { $, esc, hex } from './dom.js';

let stull, sctx, R={}, filterFamily='all';

function drawStull(){
  if(!stull||!sctx)return;
  const rect=stull.getBoundingClientRect();
  const w=rect.width,h=rect.height;
  if(w<60||h<60)return;              // панель ещё не разложена — рисовать нечего
  const dp=Math.min(devicePixelRatio,2);
  stull.width=w*dp;stull.height=h*dp;
  sctx.setTransform(dp,0,0,dp,0,0);
  const X=al=>14+(al-0.1)/(0.6-0.1)*(w-28);
  const Y=si=>h-16-(si-1.5)/(7-1.5)*(h-32);
  sctx.clearRect(0,0,w,h);
  sctx.strokeStyle='rgba(216,112,63,.12)';
  for(let al=0.2;al<=0.6;al+=0.1){sctx.beginPath();sctx.moveTo(X(al),12);sctx.lineTo(X(al),h-14);sctx.stroke();}
  for(let si=2;si<=7;si+=1){sctx.beginPath();sctx.moveTo(12,Y(si));sctx.lineTo(w-12,Y(si));sctx.stroke();}
  const blob=(al,si,rx,ry,col)=>{
    const RX=Math.max(0,rx/0.5*(w-28)/2), RY=Math.max(0,ry/5.5*(h-32)/2);
    sctx.beginPath();
    sctx.ellipse(X(al),Y(si),RX,RY,0,0,Math.PI*2);
    sctx.fillStyle=col;sctx.fill();
  };
  blob(0.16,2.1,0.13,1.1,'rgba(217,92,74,.22)');
  blob(0.45,3.4,0.16,1.5,'rgba(224,166,63,.24)');
  blob(0.36,4.7,0.16,1.3,'rgba(216,160,90,.14)');
  blob(0.26,5.7,0.2,1.7,'rgba(143,181,115,.26)');
  sctx.fillStyle='rgba(241,231,218,.55)';sctx.font='9px Manrope';
  sctx.fillText('недоплав',X(0.16)-18,Y(2.1));
  sctx.fillText('мат',X(0.45)-9,Y(3.4));
  sctx.fillText('сатин',X(0.36)-13,Y(4.7));
  sctx.fillText('глянец',X(0.26)-14,Y(5.9));
  sctx.fillStyle='rgba(216,112,63,.7)';
  sctx.fillText('Al₂O₃ →',w-52,h-4);
  sctx.save();sctx.translate(8,46);sctx.rotate(-Math.PI/2);sctx.fillText('SiO₂ →',0,0);sctx.restore();
  const gx=X(state.glaze.al),gy=Y(state.glaze.si);
  sctx.strokeStyle='#f1e7da';sctx.lineWidth=1.2;
  sctx.beginPath();sctx.moveTo(gx-9,gy);sctx.lineTo(gx+9,gy);sctx.moveTo(gx,gy-9);sctx.lineTo(gx,gy+9);sctx.stroke();
  sctx.beginPath();sctx.arc(gx,gy,5.5,0,Math.PI*2);
  sctx.strokeStyle='#e8935f';sctx.lineWidth=2;sctx.stroke();
}

/* ---------- ассортимент ---------- */
function rowHTML(g){
  const fam=GLAZE_FAMILIES[g.family];
  const cone=g.cone[0]===g.cone[1]?`конус ${g.cone[0]}`:`конус ${g.cone[0]}–${g.cone[1]}`;
  const look=g.look;
  const surface=look.gloss>0.85?'глянец':look.gloss>0.45?'сатин':'мат';
  const cover=look.opacity>0.8?'кроющая':look.opacity>0.35?'полукроющая':'прозрачная';
  return `<button class="mat-row${g.id===state.glazeId?' active':''}" data-gid="${g.id}" title="${esc(fam.note)}">
    <span class="mat-dot glz-dot" style="--a:${hex(g.color)};--b:${hex(g.breakColor??g.color)};
      --gloss:${(0.15+0.75*look.gloss).toFixed(2)}"></span>
    <span class="mat-main">
      <span class="mat-name">${esc(g.name)}</span>
      <span class="mat-sub">${esc(fam.name)} · ${cone} · ${g.tempC[0]}–${g.tempC[1]} °С</span>
      <span class="mat-sub dim">${cover} · ${surface}${look.flow>0.7?' · сильно течёт':look.flow>0.45?' · течёт':''}</span>
    </span>
  </button>`;
}
function renderGlazeList(){
  const list=GLAZES.filter(g=>filterFamily==='all'||g.family===filterFamily);
  $('glzList').innerHTML=list.length?list.map(rowHTML).join(''):'<div class="empty">В этом семействе пока пусто.</div>';
  $('glzList').querySelectorAll('[data-gid]').forEach(b=>{b.onclick=()=>selectGlaze(b.dataset.gid);});
  $('glzCount').textContent=`${GLAZES.length} семейств`;
}

/** Выбор глазури: подставляет её UMF в лабораторию и сразу показывает на изделии. */
export function selectGlaze(id){
  const g=GLAZES.find(x=>x.id===id);
  if(!g)return;
  state.glazeId=id;
  if(g.umf){                       // у сигиллаты формулы нет — ползунки не трогаем
    state.glaze.al=g.umf.al;state.glaze.si=g.umf.si;state.glaze.ca=g.umf.ca;
    syncGlaze();
  }
  state.firing='glaze';            // смотреть глазурь на утиле бессмысленно
  document.querySelectorAll('#firingSeg button').forEach(x=>x.classList.toggle('active',x.dataset.f==='glaze'));
  renderGlazeList();
  sceneAPI.applyMaterial(state);
  emit();                          // пересборка вернёт свежую толщину плёнки
  updateGlaze();
}

/* ---------- как ляжет на форму ---------- */
export function updateCoatPanel(){
  const g=byGlazeId(state.glazeId), body=byId(state.mat);
  const st=sceneAPI.coatStats()||{runMax:1,sharpest:0};
  const fit=firingFit(g,body);
  const w=coatWarnings(g,st);
  const na=g.na.includes('umf');
  const risk=`<p class="note">${esc(g.risk)}</p>`;
  const rows=[
    ['Плёнка', `${g.look.opacity>0.8?'кроющая':g.look.opacity>0.35?'полукроющая':'прозрачная'} · ${
      g.look.gloss>0.85?'глянец':g.look.gloss>0.45?'сатин':'мат'}`],
    ['Натёк у подошвы', `<b>${st.runMax.toFixed(2)}×</b> от толщины на плече`],
    ['Пробой ребра', g.look.breakEdge>0.6?'сильный — кромка вспыхнет черепком'
      :g.look.breakEdge>0.3?'умеренный':'почти нет'],
    ['Рельеф формы', st.sharpest>0.45?'острый — есть за что зацепиться'
      :st.sharpest>0.2?'мягкий':'гладкая, глазури нечего подчеркнуть'],
  ];
  $('glzCoat').innerHTML=
    `<p class="mat-note">${esc(g.note)}</p>`+
    `<dl class="spec">${rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`+
    (fit?`<div class="tool-verdict ${fit.lvl}"><b>${esc(fit.txt)}</b>
       <span>${esc(body.name)} · ${esc(g.name)}</span></div>`:'')+
    (na?'<p class="note">Это не глазурь: стеклофазы нет, формулу Зегера считать не к чему.</p>':'')+
    (w.length?`<div class="warn-list">${w.map(x=>
      `<div class="warn-item ${x.lvl}"><i></i><span>${esc(x.txt)}</span></div>`).join('')}</div>`:'')+
    risk+
    `<p class="note src-list">Источники: ${g.src.map(sc=>
      `<a href="${esc(sc.u)}" target="_blank" rel="noopener">${esc(sc.t)}</a>`).join(' · ')}</p>`;
}

function updateGlaze(){
  const g=state.glaze, body=byId(state.mat);
  const ev=evaluateGlaze(g, body.cte);
  updateCoatPanel();
  $('glazeVerdict').innerHTML=
    `<div>UMF: флюсы <b>1.0</b> · Al₂O₃ <b>${g.al.toFixed(2)}</b> · SiO₂ <b>${g.si.toFixed(2)}</b> · Si:Al <b>${ev.ratio.toFixed(1)}</b></div>`+
    `<div>Поверхность (конус 6): <span class="${ev.surface.c}">${ev.surface.t}</span></div>`+
    `<div>CTE глазури ≈ <b>${ev.cte.toFixed(1)}</b> vs черепок <b>${body.cte.toFixed(1)}</b> ·10⁻⁶/°C</div>`+
    `<div><span class="${ev.fit.c}">${ev.fit.t}</span></div>`;
  drawStull();
}

export function initGlazeLab(){
  const fams=[['all','Все']].concat(Object.entries(GLAZE_FAMILIES).map(([k,v])=>[k,v.name]));
  $('glzFilters').innerHTML=fams.map(([k,n])=>
    `<button class="chip-btn${k==='all'?' active':''}" data-fam="${k}">${esc(n)}</button>`).join('');
  $('glzFilters').querySelectorAll('[data-fam]').forEach(b=>{
    b.onclick=()=>{
      filterFamily=b.dataset.fam;
      $('glzFilters').querySelectorAll('[data-fam]').forEach(x=>x.classList.toggle('active',x===b));
      renderGlazeList();
    };
  });
  renderGlazeList();

  stull=$('stullCanvas');sctx=stull.getContext('2d');
  let pending=false;
  new ResizeObserver(()=>{
    if(pending)return;
    pending=true;
    setTimeout(()=>{pending=false;drawStull();},0);
  }).observe($('stullWrap'));
  onChange(updateGlaze);   // смена глины меняет CTE черепка — вердикт пересчитать
  R.al=hookSlider('alSl','alOut',v=>v.toFixed(2),v=>{state.glaze.al=v;updateGlaze();});
  R.si=hookSlider('siSl','siOut',v=>v.toFixed(2),v=>{state.glaze.si=v;updateGlaze();});
  R.ca=hookSlider('caSl','caOut',v=>Math.round(v*100)+'%',v=>{state.glaze.ca=v;updateGlaze();});
}
export function syncGlaze(){
  R.al.sync(state.glaze.al);
  R.si.sync(state.glaze.si);
  R.ca.sync(state.glaze.ca);
}
