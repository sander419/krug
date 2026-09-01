// file: js/config/glazes.js
// Реестр глазурей. Записи — не марки поставщиков, а семейства: целадон, тенмоку,
// шино, пепельная и так далее. Семейство описано в литературе и воспроизводимо
// у любого поставщика, а паспортные числа конкретной банки — у каждого свои.
// Марка добавляется сюда же, теми же полями плюс `vendor`, `priceRub`, `packKg`
// и ссылкой на паспорт — реестр под это готов.
//
// СОГЛАШЕНИЕ О ДАННЫХ (одинаковое во всех реестрах проекта):
//   est     — значение посчитано или взято по типу, а не из паспорта;
//   unknown — данных нет, надо уточнять у поставщика;
//   na      — величина к этой записи неприменима.
//
// ОТДЕЛЬНО ПРО `look`: это параметры отрисовки, а не измеренная величина.
// Ими задаётся, как плёнка ведёт себя на форме — где пробивает ребро, где
// набирается в углублении, где течёт вниз. Числа подобраны по виду, и так
// и помечены: ни одно из них не выдаёт себя за паспортное.

export const GLAZES_SCHEMA = 1;

const SRC = {
  celadon:   {t: 'Digitalfire — Celadon Glaze', u: 'https://digitalfire.com/glossary/celadon', kind: 'dealer'},
  tenmoku:   {t: 'Digitalfire — Tenmoku', u: 'https://digitalfire.com/glossary/tenmoku', kind: 'dealer'},
  shino:     {t: 'Digitalfire — Shino Glaze', u: 'https://digitalfire.com/glossary/shino', kind: 'dealer'},
  crystal:   {t: 'Digitalfire — Crystalline Glaze', u: 'https://digitalfire.com/glossary/crystalline+glaze', kind: 'dealer'},
  matte:     {t: 'Digitalfire — Matte Glaze', u: 'https://digitalfire.com/glossary/matte+glaze', kind: 'dealer'},
  satin:     {t: 'Digitalfire — Satin Glaze', u: 'https://digitalfire.com/glossary/satin+glaze', kind: 'dealer'},
  crazing:   {t: 'Digitalfire — Crazing', u: 'https://digitalfire.com/glossary/crazing', kind: 'dealer'},
  ash:       {t: 'Digitalfire — Ash Glaze', u: 'https://digitalfire.com/glossary/ash+glaze', kind: 'dealer'},
  rutile:    {t: 'Digitalfire — Rutile', u: 'https://digitalfire.com/glossary/rutile', kind: 'dealer'},
  terrasig:  {t: 'Digitalfire — Terra Sigillata', u: 'https://digitalfire.com/glossary/terra+sigillata', kind: 'dealer'},
  majolica:  {t: 'Digitalfire — Majolica', u: 'https://digitalfire.com/glossary/majolica', kind: 'dealer'},
  clear:     {t: 'Digitalfire — Clear Glaze', u: 'https://digitalfire.com/glossary/clear+glaze', kind: 'dealer'},
  transp:    {t: 'Digitalfire — Transparent Glaze', u: 'https://digitalfire.com/glossary/transparent+glaze', kind: 'dealer'},
  oilspot:   {t: 'Digitalfire — Oil Spot Glaze', u: 'https://digitalfire.com/glossary/oil+spot', kind: 'dealer'},
  copperRed: {t: 'Digitalfire — Copper Red', u: 'https://digitalfire.com/glossary/copper+red', kind: 'dealer'},
  engobe:    {t: 'Digitalfire — Engobe', u: 'https://digitalfire.com/glossary/engobe', kind: 'dealer'},
  foodSafe:  {t: 'Digitalfire — Food Safe', u: 'https://digitalfire.com/glossary/food+safe', kind: 'dealer'},
  leaching:  {t: 'Digitalfire — Leaching', u: 'https://digitalfire.com/glossary/leaching', kind: 'dealer'},
  umf:       {t: 'Digitalfire — Unity Molecular Formula', u: 'https://digitalfire.com/glossary/unity+molecular+formula', kind: 'dealer'},
  glazy:     {t: 'Glazy — открытая база рецептов глазурей', u: 'https://glazy.org/', kind: 'dealer'},
  /* Цены рынка: конкретные товары конкретного продавца на 31.08.2026.
     Это не «столько стоит такая глазурь вообще», а «вот реальный товар этого
     типа и его цена» — по ней инструмент и считает, пока мастерская не впишет
     свою. Фасовка важна не меньше цены: килограмм из банки на 200 г вдвое
     дороже килограмма из ведра на 4 кг. */
  lkClear:   {t: 'Портал керамики — Глазурь ЛК Бесцветная прозрачная S-0104 (порошок, 4 кг — 3150 ₽)',
              u: 'https://portalkeramiki.ru/index.php/eshop/materials/glazuri/22/s-0104-detail',
              kind: 'dealer'},
  lkMatte:   {t: 'Портал керамики — Глазурь ЛК Белая матовая S-0220 (суспензия, 5 кг — 2472 ₽)',
              u: 'https://portalkeramiki.ru/index.php/eshop/materials/glazuri/21/s-0220-detail',
              kind: 'dealer'},
};

export const GLAZE_FAMILIES = {
  transparent: {name: 'Прозрачные',  note: 'Черепок виден насквозь: цвет массы работает вместе с глазурью'},
  opaque:      {name: 'Кроющие',     note: 'Плёнка закрывает черепок целиком, цвет задаёт глазурь'},
  matte:       {name: 'Матовые',     note: 'Свет рассеивается: поверхность бархатная, бликов нет'},
  reactive:    {name: 'Реактивные',  note: 'Толщина решает всё: пробивает рёбра, набирается в углублениях, течёт'},
  atmospheric: {name: 'Печные',      note: 'Рисунок даёт печь и атмосфера обжига, а не только рецепт'},
  surface:     {name: 'Не глазури',  note: 'Ангобы и сигиллаты: черепок закрыт, но стеклофазы нет'},
};

/* Конус Ортона → температура. Хранятся оба: конус привычен мастеру, градусы —
   реестру масс, где обжиг записан в °C. */
export const CONE_C = {'06': 999, '04': 1060, '02': 1101, '4': 1186, '6': 1222, '8': 1249, '10': 1285};

/* Каждая запись — одно семейство. Обязательные поля проверяет tools/check-glazes.mjs.
   look: opacity 0 прозрачная … 1 кроющая; gloss 0 мат … 1 зеркало;
         breakEdge — насколько обнажает черепок на выпуклом ребре;
         pool — насколько набирается и темнеет в углублении;
         flow — текучесть, длина потёка вниз;
         speck — крап и точки; crystal — кристаллы; crackle — сетка цека. */
export const GLAZES = [
  {
    id: 'clear-gloss',
    name: 'Прозрачная глянцевая',
    family: 'transparent',
    cone: ['04', '6'], tempC: [1060, 1222],
    umf: {al: 0.30, si: 3.6, ca: 0.70},
    color: 0xf3ece0,
    look: {opacity: 0.06, gloss: 0.96, breakEdge: 0.20, pool: 0.55, flow: 0.25, speck: 0, crystal: 0, crackle: 0},
    note: 'Рабочая лошадь: показывает цвет черепка и ангоба, даёт мытьё и посудную пригодность. ' +
          'На красной массе уходит в тёплый тон, на фарфоре остаётся холодной.',
    risk: 'Цек, если КТР черепка и глазури разошлись — проверяется вердиктом ниже.',
    /* Ориентир цены — конкретный товар рынка, а не «такая глазурь стоит».
       Порошок: килограммы сухой смеси, те же, что считает смета. */
    vendor: 'Лаборатория керамики / Портал керамики',
    product: 'ЛК Бесцветная прозрачная, S-0104', form: 'powder',
    pack: 'ведро 4 кг', packKg: 4, priceRub: 3150,
    est: ['umf'], unknown: [], na: [],
    src: [SRC.clear, SRC.transp, SRC.lkClear],
  },
  {
    id: 'clear-crackle',
    name: 'Кракле',
    family: 'transparent',
    cone: ['06', '4'], tempC: [999, 1186],
    umf: {al: 0.18, si: 2.6, ca: 0.45},
    color: 0xe8e2d4,
    look: {opacity: 0.08, gloss: 0.92, breakEdge: 0.18, pool: 0.5, flow: 0.3, speck: 0, crystal: 0, crackle: 1},
    note: 'Цек здесь не брак, а рисунок: сетку намеренно вызывают избытком щёлочи и потом ' +
          'втирают краситель или чай. Декоративная вещь, не посуда.',
    risk: 'Сетка трещин — открытый путь для влаги и бактерий: под еду и напитки не годится.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.crazing, SRC.foodSafe],
  },
  {
    id: 'majolica-white',
    name: 'Кроющая белая (майолика)',
    family: 'opaque',
    cone: ['06', '02'], tempC: [999, 1101],
    umf: {al: 0.26, si: 2.9, ca: 0.55},
    color: 0xf2efe6,
    look: {opacity: 0.96, gloss: 0.74, breakEdge: 0.12, pool: 0.35, flow: 0.15, speck: 0, crystal: 0, crackle: 0},
    note: 'Белый экран поверх красного черепка: по нему пишут красками, как по бумаге. ' +
          'Оловянная или цирконовая муть закрывает массу целиком.',
    risk: 'Толстый слой на ребре скалывается и сползает при обжиге.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.majolica],
  },
  {
    id: 'celadon',
    name: 'Целадон',
    family: 'transparent',
    cone: ['6', '10'], tempC: [1222, 1285],
    umf: {al: 0.42, si: 4.4, ca: 0.80},
    color: 0x93bcae,
    look: {opacity: 0.20, gloss: 0.95, breakEdge: 0.40, pool: 0.98, flow: 0.42, speck: 0, crystal: 0, crackle: 0.25},
    note: 'Классика: прозрачная плёнка с малым железом, цвет живёт толщиной. ' +
          'Ради этого и режут рельеф — в канавке слой глубже, и рисунок проявляется цветом.',
    risk: 'На гладкой форме почти бесцветен: без рельефа целадон нечем показать.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.celadon],
  },
  {
    id: 'tenmoku',
    name: 'Тенмоку',
    family: 'reactive',
    cone: ['6', '10'], tempC: [1222, 1285],
    umf: {al: 0.36, si: 3.9, ca: 0.72},
    color: 0x271811, breakColor: 0xa8531f,
    look: {opacity: 0.92, gloss: 0.90, breakEdge: 0.95, pool: 0.85, flow: 0.55, speck: 0.1, crystal: 0, crackle: 0},
    note: 'Железа столько, что на ребре плёнка утоньшается и вспыхивает ржавой рыжиной, ' +
          'а в глубине остаётся чёрно-коричневым зеркалом. Форма читается сама собой.',
    risk: 'Течёт: у самого низа оставляйте сухой поясок, иначе прикипит к полке.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.tenmoku],
  },
  {
    id: 'oil-spot',
    name: 'Масляное пятно',
    family: 'atmospheric',
    cone: ['8', '10'], tempC: [1249, 1285],
    umf: {al: 0.33, si: 3.6, ca: 0.66},
    color: 0x1d1712, breakColor: 0xb08a4a,
    look: {opacity: 0.95, gloss: 0.88, breakEdge: 0.55, pool: 0.7, flow: 0.4, speck: 0.85, crystal: 0, crackle: 0},
    note: 'Пузырь железа лопается у поверхности и оставляет серебристо-рыжее пятно. ' +
          'Рисунок задаёт выдержка на пике, а не кисть.',
    risk: 'Узкое окно обжига: перегрев съедает пятна, недожог оставляет булькающие оспины.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.oilspot],
  },
  {
    id: 'shino',
    name: 'Шино',
    family: 'atmospheric',
    cone: ['8', '10'], tempC: [1249, 1285],
    umf: {al: 0.48, si: 3.2, ca: 0.30},
    color: 0xe3c197, breakColor: 0x8c5a33,
    look: {opacity: 0.88, gloss: 0.42, breakEdge: 0.45, pool: 0.45, flow: 0.05, speck: 0.35, crystal: 0, crackle: 0},
    note: 'Густая неподвижная плёнка цвета топлёного молока с угольными затёками. ' +
          'Не течёт вовсе, поэтому терпит толстый слой и держит след пальца от макания.',
    risk: 'Наколы и складки — часть характера; на посуде под нож это минус.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.shino],
  },
  {
    id: 'satin-matte',
    name: 'Матовая сатиновая',
    family: 'matte',
    cone: ['4', '8'], tempC: [1186, 1249],
    umf: {al: 0.52, si: 3.0, ca: 0.85},
    color: 0xd9cfc0,
    look: {opacity: 0.90, gloss: 0.16, breakEdge: 0.25, pool: 0.30, flow: 0.05, speck: 0, crystal: 0, crackle: 0},
    note: 'Матовость от избытка глинозёма и кальция: свет рассеивается кристаллами, ' +
          'а не гасится недожогом. Приятна в руке, не бликует на фото.',
    risk: 'Настоящая матовость и недоплав выглядят похоже, а ведут себя по-разному: ' +
          'сухая недоплавленная поверхность царапается и пачкается.',
    est: ['umf'], vendor: 'Лаборатория керамики / Портал керамики',
    product: 'ЛК Белая матовая, S-0220', form: 'suspension',
    pack: 'ведро 5 кг готовой суспензии', packKg: 5, priceRub: 2472,
    unknown: [], na: [],
    src: [SRC.matte, SRC.satin, SRC.lkMatte],
  },
  {
    id: 'rutile-blue',
    name: 'Рутиловая синяя',
    family: 'reactive',
    cone: ['6', '10'], tempC: [1222, 1285],
    umf: {al: 0.34, si: 3.8, ca: 0.60},
    color: 0x5b7f9c, breakColor: 0xc99a5e,
    look: {opacity: 0.78, gloss: 0.82, breakEdge: 0.80, pool: 0.90, flow: 0.62, speck: 0.2, crystal: 0.25, crackle: 0},
    note: 'Рутил разделяет плёнку на слои: синее пятно в глубине, охристые полосы по движению. ' +
          'Самая «фотогеничная» группа и самая непредсказуемая.',
    risk: 'Рисунок зависит от толщины и скорости остывания — две одинаковые чашки не выйдут.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.rutile],
  },
  {
    id: 'ash',
    name: 'Пепельная',
    family: 'reactive',
    cone: ['8', '10'], tempC: [1249, 1285],
    umf: {al: 0.28, si: 3.4, ca: 0.92},
    color: 0x7f8a55, breakColor: 0x9d6a34,
    look: {opacity: 0.40, gloss: 0.96, breakEdge: 0.55, pool: 1.0, flow: 0.95, speck: 0.15, crystal: 0, crackle: 0.15},
    note: 'Древесная зола плавится сама и течёт: на плечах прозрачная, в перехвате собирается ' +
          'в тёмно-зелёную каплю. Форму нужно рисовать под этот сток.',
    risk: 'Самая текучая группа: без подставки и сухого пояска изделие приваривается к полке.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.ash],
  },
  {
    id: 'crystal-zinc',
    name: 'Кристаллическая цинковая',
    family: 'reactive',
    cone: ['8', '10'], tempC: [1249, 1285],
    umf: {al: 0.14, si: 2.6, ca: 0.35},
    color: 0x6d7fa4, breakColor: 0xd8e0e6,
    look: {opacity: 0.55, gloss: 1.0, breakEdge: 0.35, pool: 0.85, flow: 0.90, speck: 0, crystal: 0.95, crackle: 0},
    note: 'Мало глинозёма — расплав жидкий, и в нём успевают вырасти цветы виллемита. ' +
          'Требует выдержки на остывании и всегда штучная вещь.',
    risk: 'Стекает полностью: печатают и ставят только с ловушкой под изделием.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.crystal],
  },
  {
    id: 'copper-red',
    name: 'Медная красная',
    family: 'atmospheric',
    cone: ['10', '10'], tempC: [1285, 1285],
    umf: {al: 0.30, si: 3.7, ca: 0.68},
    color: 0x9c3226, breakColor: 0xd8cbb4,
    look: {opacity: 0.75, gloss: 0.94, breakEdge: 0.70, pool: 0.80, flow: 0.5, speck: 0.1, crystal: 0, crackle: 0},
    note: 'Цвет даёт не медь как таковая, а восстановительная атмосфера: та же банка ' +
          'в окислении даёт зелёное. В электропечи без горелки не повторяется.',
    risk: 'Нужен газ или дровяная печь с восстановлением — на муфельной печи смысла нет.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: ['umf'], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: [],
    src: [SRC.copperRed],
  },
  {
    id: 'terra-sigillata',
    name: 'Терра сигиллата',
    family: 'surface',
    cone: ['06', '04'], tempC: [999, 1060],
    umf: null,
    color: 0xb2653d,
    look: {opacity: 1.0, gloss: 0.34, breakEdge: 0.10, pool: 0.15, flow: 0.0, speck: 0.05, crystal: 0, crackle: 0},
    note: 'Не глазурь: тончайшая фракция той же глины, отмученная и залощённая. ' +
          'Стеклофазы нет, блеск даёт полировка — так работали до глазурей вообще.',
    risk: 'Не герметична: воду держит черепок, а не покрытие. Под пищу только с обжигом в спекание.',
    form: null,        // поставщик не публикует: порошок или суспензия
    est: [], unknown: ['priceRub', 'packKg', 'vendor', 'form'], na: ['umf'],
    src: [SRC.terrasig, SRC.engobe],
  },
];

export const byGlazeId = id => GLAZES.find(g => g.id === id) || GLAZES[0];
export const byFamily = f => GLAZES.filter(g => g.family === f);

/* Совпадает ли обжиг глазури с тем, что выдерживает выбранная масса.
   Обе величины уже есть в реестрах, поэтому проверка бесплатная. */
export function firingFit(glaze, material) {
  const m = material.firing && material.firing.glazeC;
  if (!m || !glaze.tempC) return null;
  const [gLo, gHi] = glaze.tempC, [mLo, mHi] = m;
  if (gLo > mHi) return {ok: false, lvl: 'bad', txt: `Глазурь идёт от ${gLo} °C, масса держит до ${mHi} °C — черепок поплывёт.`};
  if (gHi < mLo) return {ok: false, lvl: 'warn', txt: `Глазурь плавится к ${gHi} °C, а масса спекается от ${mLo} °C — глазурь перегорит раньше, чем спечётся черепок.`};
  return {ok: true, lvl: 'ok', txt: `Обжиг сходится: глазурь ${gLo}–${gHi} °C, масса ${mLo}–${mHi} °C.`};
}
