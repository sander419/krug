// file: js/core/state.js
import { PRESETS } from '../config/data.js';
import { MATERIALS, LEGACY_CLAY_INDEX } from '../config/materials.js';
import { GLAZES } from '../config/glazes.js';
import { sanitizePart } from './parts.js';
import { sanitizeTune } from './tuning.js';
import { sanitizeLid } from './lid.js';
import { sanitizeCost } from './cost.js';
import { clamp } from './util.js';
import { sanitizePattern, packPattern } from './pattern.js';

// Единственный источник истины. Все расчёты в мм и граммах.
export const state = {
  name: 'Ваза',
  points: PRESETS[1].pts.map(p=>({...p})),
  activePreset: 1,
  H: 220, D: 160,               // мм (на круге)
  segments: 72, rings: 0.4,     // мм
  hollow: true, wall: 5,        // мм
  footH: 6, footK: 62,          // мм / %
  allow: 20,                    // % припуск
  mat: 'gzhel-red',             // id массы из js/config/materials.js
  firing: 'raw',
  seed: 48213,
  stage: 6, playing: false,
  spin: true, wire: false, heatmap: false,
  // принтер по умолчанию — с камерой, куда влезает форма по умолчанию: иначе
  // первое же нажатие «Слайсить» встречает человека красной ошибкой
  pr: {printer:1, nozzle:4.0, lh:2.4, feed:1800, cart:20, flow:100, tau:8},
  // формула по умолчанию — паспортная у glazeId ниже, а не «примерно такая»:
  // разошедшиеся умолчания означали, что инструмент с первой секунды считает
  // не ту глазурь, которая горит в списке
  glaze: {al:0.3, si:3.6, ca:0.7},
  glazeId: 'clear-gloss',       // id из js/config/glazes.js
  glazeOwn: false,              // формулу правили ползунками — она уже не паспортная
  // прилепы: ручки и носики, каждый со своим азимутом. Пусто — чистое тело вращения
  parts: [],
  // крышка: отдельное изделие, обжигается вместе и обязано сесть на своё
  lid: {on: false},
  /* Узор на стенке: стопка слоёв рельефа, который печатает машина. По умолчанию
     слоёв нет — на круге руками такого не вытянуть, и вещь по умолчанию гончарная. */
  pattern: {layers: []},
  // печь: id из реестра или 'own' со своими размерами, и цена киловатт-часа
  kiln: {id: 'studio-60', kwh: 6},
  // литьё: замер набора стенки и свойства шликера — калибровка мастерской
  cast: {},
  /* Деньги мастерской: ставка, минуты на изделие, цена глазури, брак, наценка
     и размер тиража. Это числа конкретной мастерской, а не паспорт материала. */
  cost: {},
  /* Гипс формовщика: марка и водогипсовое отношение. Выбор один на все формы —
     и на матрицу под штамповку, и на форму под отливку, — поэтому живёт
     в состоянии, а не в модуле одной вкладки. */
  plaster: {id: 'gvvs-16', wr: 70},
  // свои пороги вместо умолчаний инструмента (js/config/tuning.js)
  tune: {},
};


export function encodeDNA(){
  const d = {v:8, name:state.name, gid:state.glazeId, pt:state.parts, mat:state.mat, pts:state.points, H:state.H, D:state.D,
    seg:state.segments, ring:state.rings, hol:state.hollow?1:0, wall:state.wall,
    fh:state.footH, fk:state.footK, al:state.allow, seed:state.seed,
    pr:state.pr, gz:state.glaze, kl:state.kiln, ct:state.cast, tn:state.tune, ld:state.lid,
    ps:state.plaster, cs:state.cost, pn:packPattern(state.pattern),
    /* Этап обжига — часть рецепта, а не вида: от него зависят замечания
       по глазури и посадке крышки, число обжигов в садке и цена изделия.
       Без него ссылка показывала другому человеку другие деньги.
       `go` — правил ли мастер формулу глазури руками: иначе у получателя
       своя формула выглядит паспортной. */
    fr:state.firing, go:state.glazeOwn?1:0};
  return btoa(unescape(encodeURIComponent(JSON.stringify(d))))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

// Читает location.hash и мутирует state. Возвращает true, если ДНК применена.
export function applyDNAFromHash(){
  const m = location.hash.match(/#dna=([\w-]+)/);
  return m ? applyDNA(m[1]) : false;
}

/* Что пришлось поправить в последней прочитанной ссылке. Пустой список —
   ссылка была цельной.

   Зачем это вообще. Ссылка приходит от другого человека или из старой
   переписки, и в ней бывает мусор: высота в километр, отрицательная стенка,
   неизвестная масса. Молча привести такое к пределам — значит показать
   человеку **другое изделие** под тем же именем, и он этого не заметит.
   Поэтому правки запоминаются и показываются: «ссылку открыли, но вот это
   в ней пришлось поправить». */
let dnaNotes = [];
export const lastDNANotes = () => dnaNotes.slice();

// Применяет ДНК из строки (ссылка или автосохранение). true, если получилось.
export function applyDNA(code){
  try{
    dnaNotes = [];
    const d = JSON.parse(decodeURIComponent(escape(atob(String(code).replace(/-/g,'+').replace(/_/g,'/')))));
    if(d.v > 8 || !Array.isArray(d.pts) || d.pts.length < 2) return false;
    /* Число вне пределов — не «почти то же самое»: это другая вещь. Каждую
       такую правку запоминаем поимённо, чтобы сказать о ней человеку. */
    const clamped = (name, raw, lo, hi, unit) => {
      const v = +raw;
      if (!Number.isFinite(v) || v < lo || v > hi)
        dnaNotes.push(`${name}: в ссылке ${Number.isFinite(v) ? v + (unit || '') : 'не число'}, ` +
          `допустимо ${lo}–${hi}${unit || ''}`);
    };
    clamped('Высота', d.H, 50, 400, ' мм');
    clamped('Диаметр', d.D, 50, 400, ' мм');
    clamped('Стенка', d.wall, 2, 12, ' мм');
    if (d.mat && !MATERIALS.some(x => x.id === d.mat))
      dnaNotes.push(`Масса «${d.mat}» этому КРУГу неизвестна — взята первая из списка`);
    if (d.gid && !GLAZES.some(g => g.id === d.gid))
      dnaNotes.push(`Глазурь «${d.gid}» неизвестна — осталась прежняя`);
    if (Array.isArray(d.pt) && d.pt.length > 8)
      dnaNotes.push(`Прилепов в ссылке ${d.pt.length}, взято 8 — больше инструмент не считает`);
    state.name = d.name || state.name;
    state.points = d.pts.map(p=>({t:clamp(+p.t||0,0,1), r:clamp(+p.r||0,0,1)}));
    // v3 хранит id массы, v2 — индекс из первой версии справочника
    const wanted = d.mat || LEGACY_CLAY_INDEX[clamp(d.clay|0,0,LEGACY_CLAY_INDEX.length-1)];
    state.mat = MATERIALS.some(x=>x.id===wanted) ? wanted : MATERIALS[0].id;
    state.H = clamp(+d.H||220, 50, 400);
    state.D = clamp(+d.D||160, 50, 400);
    state.segments = clamp(d.seg|0||72, 24, 128);
    state.rings = clamp(+d.ring||0, 0, 1.5);
    state.hollow = !!d.hol;
    state.wall = clamp(+d.wall||5, 2, 12);
    state.footH = clamp(+d.fh||0, 0, 12);
    state.footK = clamp(+d.fk||62, 30, 85);
    state.allow = clamp(+d.al||20, 5, 40);
    state.seed = d.seed|0 || 48213;
    state.activePreset = -1;
    if(d.pr) Object.assign(state.pr, {
      printer: clamp(d.pr.printer|0,0,2),
      nozzle: clamp(+d.pr.nozzle||3,0.4,10), lh: clamp(+d.pr.lh||1.6,0.2,5),
      feed: clamp(+d.pr.feed||1200,300,3600), cart: clamp(+d.pr.cart||48,10,75),
      flow: clamp(+d.pr.flow||100,60,160), tau: clamp(+d.pr.tau||8,1,10)});
    // v3 и старше глазури не знали — остаётся прозрачная по умолчанию
    if(d.gid && GLAZES.some(g=>g.id===d.gid)) state.glazeId=d.gid;
    // v6 — список прилепов; в v5 была одна ручка с выключателем
    state.tune = sanitizeTune(d.tn);
    state.lid = sanitizeLid(d.ld);
    /* Этап обжига и «формулу правили руками» старые ссылки не несли —
       у них остаётся сырой черепок и паспортная формула. */
    state.firing = ['raw','bisque','glaze'].includes(d.fr) ? d.fr : 'raw';
    state.glazeOwn = !!d.go;
    /* v6 и старше узора не знали — у них стенка гладкая, и это верно.
       v7 знала один узор плоской записью, v8 — стопку слоёв: обе читаются
       одной функцией, старая ссылка обязана открываться тем же рельефом. */
    state.pattern = sanitizePattern(d.pn);
    if(d.ct&&typeof d.ct==='object') state.cast={...d.ct};
    if(d.cs&&typeof d.cs==='object') state.cost=sanitizeCost(d.cs);
    if(d.ps&&typeof d.ps==='object')
      state.plaster={id:String(d.ps.id||'gvvs-16'), wr:clamp(+d.ps.wr||70,20,200)};
    if(d.kl&&typeof d.kl==='object')
      state.kiln={id:String(d.kl.id||'studio-60'), kwh:clamp(+d.kl.kwh||6,0,100),
                  ...(d.kl.own?{own:d.kl.own}:{})};
    if(Array.isArray(d.pt)) state.parts=d.pt.slice(0,8).map(sanitizePart);
    else if(d.hd) state.parts = d.hd.on ? [sanitizePart({kind:'handle', az:0, ...d.hd})] : [];
    else state.parts=[];
    if(d.gz) Object.assign(state.glaze, {
      al: clamp(+d.gz.al||.35,.1,.6), si: clamp(+d.gz.si||4.2,1.5,7), ca: clamp(+d.gz.ca||.7,0,1)});
    return true;
  }catch(e){ return false; }
}

/**
 * Посчитать что-нибудь по чужой ДНК, не трогая текущую работу.
 * «Производство» показывает числа по каждой сохранённой работе, а считают их
 * те же функции, что и для открытой: они читают глобальное состояние. Поэтому
 * состояние подменяется на время расчёта и возвращается назад — иначе список
 * работ переписывал бы то, что человек сейчас держит на экране.
 */
export function withDNA(code, fn){
  const snap = JSON.parse(JSON.stringify(state));
  try{
    if(!applyDNA(code)) return null;
    return fn(state);
  }finally{
    Object.assign(state, snap);
  }
}
