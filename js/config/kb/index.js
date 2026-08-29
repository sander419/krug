// file: js/config/kb/index.js
// База знаний: сборка статей из файлов разделов + поиск.
//
// Формат статьи:
// {
//   id: 'kebab-case',                  // уникальный, попадает в ссылку #kb=<id>
//   section: 'material' | 'forming' | 'drying' | 'firing' | 'glaze' | 'print' | 'safety',
//   title: 'Заголовок',
//   lead: 'Один абзац сути — показывается в списке и вверху статьи',
//   tags: ['слово', 'слово'],          // ищутся наравне с текстом
//   body: [                            // блоки по порядку
//     {p: 'абзац, допускается <b> и <i>'},
//     {h: 'подзаголовок'},
//     {ul: ['пункт', ...]} | {ol: [...]},
//     {table: {head: [...], rows: [[...], ...]}},
//     {note: 'спокойное примечание'} | {warn: 'предупреждение'},
//   ],
//   links: ['id-другой-статьи', ...],   // «Читать дальше»
//   src: [{t: 'название', u: 'https://…'}],   // необязательно, для чисел из внешних таблиц
// }
//
// Новый раздел: создать файл, добавить его в IMPORTS ниже и описать в SECTIONS.
// Проверка целостности: node tools/check-kb.mjs

import { ARTICLES as material } from './material.js';
import { ARTICLES as forming } from './forming.js';
import { ARTICLES as firing } from './firing.js';
import { ARTICLES as glaze } from './glaze.js';
import { ARTICLES as print } from './print.js';
import { ARTICLES as production } from './production.js';

export const SECTIONS = [
  {id: 'material', name: 'Материал',       ico: 'layers', note: 'Из чего масса и как её выбрать'},
  {id: 'forming',  name: 'Формовка',        ico: 'disc', note: 'Круг: от центровки до ножки'},
  {id: 'drying',   name: 'Сушка и брак',    ico: 'wind', note: 'Где рождаются трещины'},
  {id: 'firing',   name: 'Обжиг',           ico: 'flame', note: 'Утиль, политой, конусы, усадка'},
  {id: 'glaze',    name: 'Глазурь',         ico: 'droplet', note: 'UMF, цек и отскок, посуда'},
  {id: 'print',    name: 'Печать глиной',   ico: 'printer', note: 'LDM: осадка, слайсинг'},
  {id: 'production', name: 'Производство',  ico: 'factory', note: 'Оснастка, штамповка, ролик, литьё'},
  {id: 'safety',   name: 'Безопасность',    ico: 'shield-alert', note: 'Пыль и печь'},
];

export const ARTICLES = [...material, ...forming, ...firing, ...glaze, ...print, ...production];

export const bySection = id => ARTICLES.filter(a => a.section === id);
export const articleById = id => ARTICLES.find(a => a.id === id) || null;

/* плоский текст статьи — для поиска */
function plain(a) {
  const parts = [a.title, a.lead, ...(a.tags || [])];
  for (const b of a.body || []) {
    if (b.p) parts.push(b.p);
    if (b.h) parts.push(b.h);
    if (b.note) parts.push(b.note);
    if (b.warn) parts.push(b.warn);
    if (b.ul) parts.push(b.ul.join(' '));
    if (b.ol) parts.push(b.ol.join(' '));
    if (b.table) parts.push(b.table.head.join(' '), b.table.rows.map(r => r.join(' ')).join(' '));
  }
  return parts.join(' ').replace(/<[^>]+>/g, ' ').toLowerCase();
}
const INDEX = new Map(ARTICLES.map(a => [a.id, plain(a)]));

export function search(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const hits = [];
  for (const a of ARTICLES) {
    const text = INDEX.get(a.id);
    let score = 0;
    for (const w of words) {
      if (!text.includes(w)) { score = 0; break; }
      score += 1;
      if (a.title.toLowerCase().includes(w)) score += 3;
      if ((a.tags || []).some(t => t.toLowerCase().includes(w))) score += 2;
    }
    if (score) hits.push({a, score});
  }
  return hits.sort((x, y) => y.score - x.score).map(h => h.a);
}

/* контекстные подсказки: что открыть по конкретному предупреждению интерфейса */
/* Порядок для новичка: шесть шагов, после которых можно читать что угодно.
   Пары «статья — зачем» показываются на обзорном экране обучения. */
export const LEARN_PATH = [
  {id: 'clay-what',      why: 'Из чего вообще состоит масса и почему она себя так ведёт'},
  {id: 'wheel-basics',   why: 'Что происходит на круге: центровка, вскрытие, вытяжка'},
  {id: 'wall-thickness', why: 'Толщина стенки решает и вес, и сушку, и прочность'},
  {id: 'drying',         why: 'Где рождаются трещины и как их не получить'},
  {id: 'bisque',         why: 'Первый обжиг: зачем он и что происходит с черепком'},
  {id: 'glaze-families', why: 'Чем глазури отличаются и что они сделают с формой'},
];

export const CONTEXT_HELP = {
  thinWall: 'wall-thickness',
  unstable: 'foot-trim',
  tooTall: 'wheel-basics',
  overhang: 'ldm-slicing',
  collapse: 'slump',
  slump: 'slump',
  crazing: 'crazing-shivering',
  shivering: 'crazing-shivering',
  shrink: 'shrinkage',
  material: 'choose-mass',
  glazeFit: 'crazing-shivering',
  umf: 'umf',
  handle: 'handles-joins',
  spout: 'handles-joins',
  'glaze-run': 'glaze-thickness',
  'glaze-relief': 'glaze-thickness',
  'glaze-food': 'food-safe',
  glazeFamily: 'glaze-families',
  ldm: 'ldm-basics',
  tooling: 'tooling-basics',
  ram: 'ram-press',
  roller: 'roller-forming',
  casting: 'casting',
  plaster: 'plaster-tooling',
};
