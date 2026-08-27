// file: js/config/processes.js
// Реестр промышленных способов формования. Правило то же, что у масс:
// число из источника — со ссылкой в `src`; чего не нашли — `null` и честная пометка,
// а не выдуманная цифра. Пустое поле обязано попасть в один из двух списков:
//   est — данных не нашли, надо уточнять у изготовителя;
//   na  — к этому процессу величина неприменима (у литья нет давления).
// Проверка: node tools/check-processes.mjs

export const PROCESSES_SCHEMA = 1;

const SRC = {
  ramWiki:  {t: 'RAM press — Wikipedia', u: 'https://en.wikipedia.org/wiki/RAM_press'},
  ramPPP:   {t: 'Ceramic Industry — PPP: the RAM process and porous plastic', u: 'https://www.ceramicindustry.com/articles/90243-ppp-the-ram-process-and-porous-plastic'},
  ramSite:  {t: 'RAM Products — The RAM Process', u: 'http://ramprocess.com/Process/index.htm'},
  sacmiJig: {t: 'SACMI — Jiggering / plastic shaping lines', u: 'https://sacmi.it/en-US/ceramics/tableware/jiggering-plastic-shaping'},
  sacmiIso: {t: 'SACMI — Isostatic pressing for ceramic products', u: 'https://sacmi.it/en-US/ceramics/tableware/isostatic-pressing'},
  dorst:    {t: 'DORST Technologies — Mold Lab (оснастка для изостата)', u: 'https://www.dorst-technologies.com/en/products/mold-lab'},
  jigger:   {t: 'Digitalfire — Jiggering', u: 'https://digitalfire.com/glossary/jiggering'},
  castWiki: {t: 'Slip casting — Wikipedia', u: 'https://en.wikipedia.org/wiki/Slip_casting'},
  shrink:   {t: 'GC Porcelain — Drying shrinkage: formula and mold design', u: 'https://gcporcelain.com/blog/drying-shrinkage-in-ceramic-tableware-formula-mold-design-and-quality-control-guide/'},
};

/* Пороги технологичности — инженерные умолчания этого инструмента, а не отраслевой
   норматив. Меняются в одном месте, а не разбросаны по коду. */
export const LIMITS = {
  minDraftDeg: 1.5,       // меньше — стенка почти вертикальна, изделие липнет к форме
  flatMaxHD: 0.4,         // H/D, ниже которого форма считается плоской
  deepMinHD: 1.3,         // выше — глубокая форма, жёсткая оснастка уже неудобна
  thinWallRatio: 0.6,     // нормальная толщина упала ниже 60 % от заданной — предупреждение
  minWallRamMM: 3,        // тоньше этого пласт в жёсткой оснастке рвётся
  minFilletMM: 2,         // острые переходы в гипсе выкрашиваются
  minUndercutMM: 1,       // провал радиуса мельче этого — рябь профиля, а не поднутрение
  flashPct: 15,           // облой при прессовании, % к массе изделия
};

export const PROCESSES = [
  {
    id: 'ram',
    name: 'RAM-прессование (штамповка)',
    short: 'Штамповка',
    what: 'Пласт пластичной массы сжимается между двумя пористыми полуформами на гидравлическом прессе. Форма попутно обезвоживает массу, изделие снимается сжатым воздухом через поры.',
    tooling: 'Две полуформы (матрица и пуансон) из высокопрочного гипсового цемента или пористой керамики, в металлических обоймах, со штифтами совмещения и воздушными каналами.',
    pressureMPa: [0.7, 2.8],
    pressureNote: '100–400 psi по массе; зависит от состава, консистенции и толщины изделия',
    cycleSec: null,
    mouldLife: null,
    allowsUndercut: false,
    needsSplit: false,
    wares: 'Тарелки, миски, крышки, неглубокая посуда',
    good: ['плоские и неглубокие тела вращения', 'ровная толщина стенки', 'тиражи от сотен штук'],
    bad: ['поднутрения', 'вертикальные стенки без уклона', 'тонкий пласт'],
    est: ['cycleSec', 'mouldLife'], na: [],
    src: [SRC.ramWiki, SRC.ramPPP, SRC.ramSite],
  },
  {
    id: 'roller',
    name: 'Роликовое формование',
    short: 'Ролик',
    what: 'Гипсовая форма вращается, профильный ролик раскатывает по ней пласт массы. Форма даёт одну сторону изделия, ролик — другую.',
    tooling: 'Гипсовая форма (обратная сторона изделия) и стальной профильный ролик (лицевая сторона).',
    pressureMPa: null,
    pressureNote: 'усилие задаётся настройкой машины, не давлением на массу',
    cycleSec: null,
    mouldLife: null,
    allowsUndercut: false,
    needsSplit: false,
    wares: 'Тарелки, блюдца, чашки — массовые линии',
    good: ['тела вращения без поднутрений', 'открытая форма', 'крупная серия'],
    bad: ['поднутрения', 'глубокие узкие формы', 'резкие переходы профиля'],
    est: ['cycleSec', 'mouldLife'], na: ['pressureMPa'],
    src: [SRC.sacmiJig, SRC.jigger],
  },
  {
    id: 'isostatic',
    name: 'Изостатическое прессование',
    short: 'Изостат',
    what: 'Сухой гранулят распылительной сушки прессуется через эластичную мембрану. Сейчас основной способ плоской посуды на больших заводах.',
    tooling: 'Металлическая оснастка с эластичной мембраной — делается специализированными инструментальными производствами.',
    pressureMPa: null,
    pressureNote: 'по паспорту пресса; для посуды подтверждённых цифр не нашли',
    cycleSec: null,
    mouldLife: null,
    allowsUndercut: false,
    needsSplit: false,
    wares: 'Плоская и неглубокая посуда, круглая и некруглая',
    good: ['очень крупные тиражи', 'плоские изделия', 'стабильность размеров'],
    bad: ['пластичная масса не годится — нужен гранулят', 'оснастку в КРУГе не построить'],
    est: ['pressureMPa', 'cycleSec', 'mouldLife'], na: [],
    src: [SRC.sacmiIso, SRC.dorst],
  },
  {
    id: 'casting',
    name: 'Литьё в гипсовые формы',
    short: 'Литьё',
    what: 'Шликер заливается в разъёмную гипсовую форму, гипс вытягивает воду, на стенке нарастает черепок.',
    tooling: 'Разъёмная гипсовая форма из двух и более частей с замками.',
    pressureMPa: null,
    pressureNote: 'без давления',
    cycleSec: null,
    mouldLife: [50, 80],
    mouldLifeNote: 'около 70 заливок типично; простые формы без мелкой деталировки живут дольше',
    allowsUndercut: true,
    needsSplit: true,
    wares: 'Сложные формы, поднутрения, ручки и носики',
    good: ['поднутрения и сложный профиль', 'малые и средние тиражи', 'тонкая стенка'],
    bad: ['долгий цикл', 'ресурс формы', 'ручная сборка формы'],
    est: ['cycleSec'], na: ['pressureMPa'],
    src: [SRC.castWiki],
  },
];

export const byId = id => PROCESSES.find(p => p.id === id) || PROCESSES[0];
export const SHRINK_SRC = SRC.shrink;
