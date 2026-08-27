// file: js/config/materials.js
// Реестр керамических масс, доступных на рынке РФ.
//
// ПРАВИЛО РЕЕСТРА: ни одного числа без первоисточника.
// Всё, что взято из паспорта поставщика, стоит в полях как есть и подтверждается `src`.
// Как добавить массу — docs/ADDING-MATERIALS.md.//
// СОГЛАШЕНИЕ О ДАННЫХ (одинаковое во всех реестрах проекта):
//   est     — значение посчитано или взято по типу, а не из паспорта;
//   unknown — данных нет, надо уточнять у поставщика;
//   na      — величина к этой записи неприменима.
// Каждое поле, которого нет в паспорте, обязано попасть ровно в один из трёх списков —
// иначе валидатор не пропустит запись.

export const MATERIALS_SCHEMA = 1;

/* Плотность сырой пластичной массы не публикуют почти нигде, но её можно посчитать
   из влажности поставки: объём воды плюс объём сухого вещества.
   ρ = 1 / (w + (1-w)/ρs), где w — доля воды по массе, ρs ≈ 2.6 г/см³ — плотность
   глинистого вещества. При w = 0.22 получается 1.92 г/см³. */
export const SOLIDS_DENSITY = 2.6;
export const DEFAULT_MOISTURE = 0.22;
export const densityFromMoisture = w => 1 / (w + (1 - w) / SOLIDS_DENSITY);

const SRC = {
  gzhel: {t: 'Керамика Гжели — масса гончарная красная пластичная 950–980 °С', u: 'https://ceramgzhel.ru/katalog/keramicheskie-massyi/massyi-dlya-lepki/keramika-gzheli/746.html'},
  mkf2info: {t: 'Керамические материалы — о глине МКФ-2', u: 'https://breezecolor.ru/poleznaya-informatsiya/156/'},
  mkf2shop: {t: 'Портал керамики — керамическая масса МКФ-2, S-6004', u: 'https://old.portalkeramiki.ru/index.php/eshop/materials/gliny/18/s-6004-detail'},
  s6015: {t: 'Портал керамики — шамотированная масса S-6015', u: 'https://portalkeramiki.ru/catalog/30/43/51/S-6015/'},
  s4p: {t: 'Портал керамики — шамотированная масса S4P, S-6014', u: 'https://portalkeramiki.ru/catalog/30/43/51/S-6014/'},
  pg75: {t: 'Портал керамики — шамотированная масса ПГ-75, S-6019', u: 'https://portalkeramiki.ru/catalog/30/43/51/S-6019/'},
  uralochka: {t: 'Портал керамики — шамотированная масса Уралочка МШ, S-6026', u: 'https://portalkeramiki.ru/catalog/30/43/51/S-6026/'},
  chugun: {t: 'Портал керамики — шамотированная масса Чугун М, S-6018-01', u: 'https://portalkeramiki.ru/catalog/30/43/51/S-6018-01/'},
  tihoretsk: {t: 'Портал керамики — пластичный Тихорецкий полуфарфор, S-6071', u: 'https://portalkeramiki.ru/catalog/30/43/50/S-6071/'},
  snezhny: {t: 'Портал керамики — фарфор Снежный, S-6115', u: 'https://portalkeramiki.ru/catalog/30/43/54/S-6115/'},
};

export const MATERIAL_TYPES = {
  terracotta:   {name: 'Красная (терракота)', note: 'Низкий обжиг, пористый черепок, тёплый цвет'},
  earthenware:  {name: 'Фаянс / майолика',    note: 'Светлый пористый черепок, под глазурь'},
  grogged:      {name: 'Шамотная масса',      note: 'С добавкой обожжённой крошки: держит форму, меньше ведёт'},
  stoneware:    {name: 'Каменная масса',      note: 'Спекается почти до нуля водопоглощения, посудная'},
  semiporcelain:{name: 'Полуфарфор',          note: 'Белый плотный черепок, высокая усадка'},
  porcelain:    {name: 'Фарфор',              note: 'Белый спёкшийся черепок, просвечивает, капризен на круге'},
};

/* Каждая запись — одна масса. Обязательные поля проверяет tools/check-materials.mjs. */
export const MATERIALS = [
  {
    id: 'gzhel-red',
    name: 'Гончарная красная',
    vendor: 'Керамика Гжели',
    type: 'terracotta',
    grog: {percent: 0, grainMM: 0},
    firing: {bisqueC: [900, 950], glazeC: [950, 980]},
    shrinkPct: 9.1, shrinkNote: 'полная, не более 9,1 %',
    absorption: [{tempC: 980, pct: 12, note: 'не более'}],
    moisturePct: null,
    colors: {raw: 0xb4643c, bisque: 0xc9825b, glaze: 0xa9c4b1},
    cte: 6.8,
    uses: ['круг', 'лепка'],
    pack: 'валюшка 22 кг', packKg: 22, priceRub: 770,
    note: 'Рабочая лошадь для круга: дешёвая, пластичная, прощает ошибки. Терракотовый черепок, посуда — только под глазурь.',
    est: ['density', 'cte', 'colors'], unknown: ['moisturePct', 'airShrinkPct'], na: [],
    src: [SRC.gzhel],
  },
  {
    id: 'mkf-2',
    name: 'МКФ-2',
    vendor: 'Керамические массы Донбасса',
    type: 'earthenware',
    grog: {percent: 0, grainMM: 0},
    firing: {bisqueC: [900, 950], glazeC: [1050, 1180]},
    shrinkPct: 10, shrinkNote: 'полная, не более 10 %',
    absorption: [
      {tempC: 1080, pct: 12, note: 'не более'},
      {tempC: 1180, pct: 1, note: 'менее 1 %, черепок спекается'},
    ],
    moisturePct: null,
    colors: {raw: 0xc9a68f, bisque: 0xd8bda8, glaze: 0xcfd8d2},
    cte: 7.0,
    uses: ['круг', 'лепка', 'литьё', 'набивка'],
    pack: 'брикет 20 кг', packKg: 20, priceRub: null,
    note: 'Универсальная светложгущаяся с розоватым оттенком. Годится и в шликер для литья. Диапазон широкий: на 1080 °С — пористая, к 1180 °С спекается.',
    est: ['density', 'cte', 'colors'], unknown: ['moisturePct', 'priceRub', 'airShrinkPct'], na: [],
    src: [SRC.mkf2info, SRC.mkf2shop],
  },
  {
    id: 'pg-75',
    name: 'ПГ-75',
    vendor: 'Портал керамики (S-6019)',
    type: 'grogged',
    grog: {percent: 40, grainMM: 2},
    firing: {bisqueC: [900, 1000], glazeC: [1050, 1130]},
    shrinkPct: 8.5, shrinkNote: '6–7 % при 1050 °С, 8–9 % при 1130 °С',
    absorption: [
      {tempC: 1050, pct: 14.5, note: '14–15 %'},
      {tempC: 1130, pct: 4.5, note: '4–5 %'},
    ],
    moisturePct: null,
    colors: {raw: 0xa86a4a, bisque: 0xbd8462, glaze: 0xb0c0b4},
    cte: 6.5,
    uses: ['лепка', 'скульптура', 'круг'],
    pack: 'упаковка 2,5 кг', packKg: 2.5, priceRub: 205,
    note: 'Крупный шамот до 2 мм на красной основе: держит крупную форму и толстую стенку, но на круге дерёт руки.',
    est: ['density', 'cte', 'colors'], unknown: ['moisturePct', 'airShrinkPct'], na: [],
    src: [SRC.pg75],
  },
  {
    id: 's-6015',
    name: 'Шамотированная светлая S-6015',
    vendor: 'Портал керамики',
    type: 'grogged',
    grog: {percent: 40, grainMM: 0.8},
    firing: {bisqueC: [1050, 1200], glazeC: [1150, 1250]},
    shrinkPct: 9.5, shrinkNote: '7–8 % при 1150 °С, 9–10 % при 1200 °С',
    absorption: [
      {tempC: 1150, pct: 11.5, note: '11–12 %'},
      {tempC: 1200, pct: 8.5, note: '8–9 %'},
    ],
    moisturePct: null,
    colors: {raw: 0xb6a888, bisque: 0xcdc2a4, glaze: 0xd6d2bd},
    cte: 6.0,
    uses: ['лепка', 'круг', 'изразцы'],
    pack: 'упаковка 5 кг', packKg: 5, priceRub: 363,
    note: 'Очень светлый черепок с желтоватым оттенком, шамот мелкий. Водопоглощение высокое даже на 1200 °С — для посуды нужна плотная глазурь.',
    est: ['density', 'cte', 'colors'], unknown: ['moisturePct', 'airShrinkPct'], na: [],
    src: [SRC.s6015],
  },
  {
    id: 's4p',
    name: 'S4P',
    vendor: 'Портал керамики (S-6014)',
    type: 'grogged',
    grog: {percent: 28, grainMM: 0.3},
    firing: {bisqueC: [1050, 1200], glazeC: [1100, 1250]},
    shrinkPct: 11, shrinkNote: 'не более 8 % при 1050 °С, не более 11 % при 1200 °С',
    absorption: [
      {tempC: 1050, pct: 15},
      {tempC: 1200, pct: 7},
    ],
    moisturePct: 28,
    colors: {raw: 0xb9a887, bisque: 0xd2c3a1, glaze: 0xdad3c0},
    cte: 6.0,
    uses: ['круг', 'лепка', 'скульптура'],
    pack: 'кусок 10 кг', packKg: 10, priceRub: 1281,
    note: 'Самая ходовая шамотка у гончаров: тонкий шамот 0–0,3 мм почти не мешает вытяжке, но убирает поводку. Пластичность заявлена 5 из 10.',
    est: ['density', 'cte', 'colors'], unknown: ['airShrinkPct'], na: [],
    src: [SRC.s4p],
  },
  {
    id: 'uralochka-msh',
    name: 'Уралочка МШ',
    vendor: 'Портал керамики (S-6026)',
    type: 'stoneware',
    grog: {percent: 10, grainMM: 0.3},
    firing: {bisqueC: [900, 1050], glazeC: [1200, 1230]},
    shrinkPct: 14.5, airShrinkPct: 7.3, shrinkNote: '7,3 % воздушная, 11,5 % при 1050 °С, 14,5 % при 1200 °С',
    absorption: [
      {tempC: 1050, pct: 13.6},
      {tempC: 1200, pct: 2},
    ],
    moisturePct: 28,
    colors: {raw: 0xb3a68c, bisque: 0xcabfa2, glaze: 0xd3cdb8},
    cte: 5.8,
    uses: ['круг', 'лепка', 'посуда'],
    pack: 'упаковка 10 кг', packKg: 10, priceRub: 1386,
    note: 'Светло-кремовая с крапинками от шамота. На 1200 °С водопоглощение 2 % — уже посудная масса.',
    est: ['density', 'cte', 'colors'], unknown: [], na: [],
    src: [SRC.uralochka],
  },
  {
    id: 'chugun-m',
    name: 'Чугун М (чёрная)',
    vendor: 'Портал керамики (S-6018-01)',
    type: 'stoneware',
    grog: {percent: 14, grainMM: 0.3},
    firing: {bisqueC: [900, 1050], glazeC: [1160, 1220]},
    shrinkPct: 14.5, airShrinkPct: 7.5, shrinkNote: '7,5 % воздушная, 11,5 % при 1050 °С, 14,5 % при 1200 °С',
    absorption: [
      {tempC: 1050, pct: 8.7},
      {tempC: 1200, pct: 0},
    ],
    moisturePct: 21,
    colors: {raw: 0x4a4440, bisque: 0x55504b, glaze: 0x3f4a52},
    cte: 5.8,
    uses: ['круг', 'лепка'],
    pack: 'упаковка 10 кг', packKg: 10, priceRub: 1533,
    note: 'Тёмно-серый до чёрного черепок с тонкомолотым шамотом. На 1200 °С спекается полностью (водопоглощение 0 %).',
    est: ['density', 'cte', 'colors'], unknown: [], na: [],
    src: [SRC.chugun],
  },
  {
    id: 'tihoretsk-semiporcelain',
    name: 'Тихорецкий полуфарфор',
    vendor: 'Портал керамики (S-6071)',
    type: 'semiporcelain',
    grog: {percent: 0, grainMM: 0},
    firing: {bisqueC: [880, 920], glazeC: [1180, 1230]},
    shrinkPct: 16.5, shrinkNote: 'полная, среднее 16,5 %',
    absorption: [
      {tempC: 1190, pct: 1.38},
      {tempC: 1220, pct: 0.25},
      {tempC: 1230, pct: 0.2},
    ],
    moisturePct: null,
    colors: {raw: 0xded6c8, bisque: 0xe9e2d6, glaze: 0xeef0ee},
    cte: 6.2,
    uses: ['круг', 'лепка', 'станочная формовка'],
    pack: 'упаковка 10 кг', packKg: 10, priceRub: 1197,
    note: 'Белый плотный черепок, вакуумированная масса. Усадка 16,5 % — закладывайте размер с запасом, тонкие детали ведёт.',
    est: ['density', 'cte', 'colors'], unknown: ['moisturePct', 'airShrinkPct'], na: [],
    src: [SRC.tihoretsk],
  },
  {
    id: 'snezhny-porcelain',
    name: 'Фарфор Снежный',
    vendor: 'Портал керамики (S-6115)',
    type: 'porcelain',
    grog: {percent: 0, grainMM: 0},
    firing: {bisqueC: [900, 950], glazeC: [1178, 1290]},
    shrinkPct: 13.5, shrinkNote: '13,5 % при 1200 °С',
    absorption: [{tempC: 1200, pct: 0}],
    moisturePct: null,
    colors: {raw: 0xe6ddd0, bisque: 0xf0e9dd, glaze: 0xf4f6f5},
    cte: 6.2,
    uses: ['круг', 'мелкая пластика', 'формовка'],
    pack: 'упаковка 2 кг / мешок 20 кг', packKg: 2, priceRub: 714,
    note: 'Пластичный фарфор из Цзиндэчжэня, каолин 58 %. Самый белый и полупрозрачный, но на круге не прощает ни воды, ни спешки.',
    est: ['density', 'cte', 'colors'], unknown: ['moisturePct', 'airShrinkPct'], na: [],
    src: [SRC.snezhny],
  },
];

/* ---------- производные величины и доступ ---------- */

export function density(m) {
  const w = m.moisturePct != null ? m.moisturePct / 100 : DEFAULT_MOISTURE;
  return densityFromMoisture(w);
}
export function densityIsEstimated(m) { return m.moisturePct == null; }

export function absorptionAt(m, tempC) {
  if (!m.absorption || !m.absorption.length) return null;
  const sorted = [...m.absorption].sort((a, b) => a.tempC - b.tempC);
  if (tempC <= sorted[0].tempC) return sorted[0];
  for (let i = 1; i < sorted.length; i++) if (tempC <= sorted[i].tempC) return sorted[i];
  return sorted[sorted.length - 1];
}
/* Посудная пригодность: черепок с водопоглощением ниже 3 % считается спёкшимся. */
export function tablewareReady(m) {
  const top = m.absorption && m.absorption.length
    ? [...m.absorption].sort((a, b) => a.tempC - b.tempC).pop() : null;
  return top ? top.pct <= 3 : false;
}

export const byId = id => MATERIALS.find(m => m.id === id) || MATERIALS[0];
export const typeName = t => (MATERIAL_TYPES[t] || {name: t}).name;

/* Старые ДНК-ссылки (v2) хранили индекс массы 0..3 из первой версии справочника. */
export const LEGACY_CLAY_INDEX = ['gzhel-red', 's4p', 'snezhny-porcelain', 'chugun-m'];
