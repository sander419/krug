// file: js/core/state.js
import { PRESETS } from '../config/data.js';
import { MATERIALS, LEGACY_CLAY_INDEX } from '../config/materials.js';
import { clamp } from './util.js';

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
  pr: {printer:0, nozzle:3.0, lh:1.6, feed:1200, cart:48, flow:100, tau:8},
  glaze: {al:0.35, si:4.2, ca:0.7},
};


export function encodeDNA(){
  const d = {v:3, name:state.name, mat:state.mat, pts:state.points, H:state.H, D:state.D,
    seg:state.segments, ring:state.rings, hol:state.hollow?1:0, wall:state.wall,
    fh:state.footH, fk:state.footK, al:state.allow, seed:state.seed,
    pr:state.pr, gz:state.glaze};
  return btoa(unescape(encodeURIComponent(JSON.stringify(d))))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

// Читает location.hash и мутирует state. Возвращает true, если ДНК применена.
export function applyDNAFromHash(){
  const m = location.hash.match(/#dna=([\w-]+)/);
  if(!m) return false;
  try{
    const d = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g,'+').replace(/_/g,'/')))));
    if(d.v > 3 || !Array.isArray(d.pts) || d.pts.length < 2) return false;
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
    if(d.gz) Object.assign(state.glaze, {
      al: clamp(+d.gz.al||.35,.1,.6), si: clamp(+d.gz.si||4.2,1.5,7), ca: clamp(+d.gz.ca||.7,0,1)});
    return true;
  }catch(e){ return false; }
}
