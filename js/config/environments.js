// file: js/config/environments.js
// Окружение вокруг модели. Одна и та же форма читается по-разному: на круге
// в мастерской видно, что это работа в процессе; на белом фоне — товар в каталоге;
// в печи — то, что сейчас обжигается. Это не украшение, а разные задачи:
// показать заказчику, снять для магазина, посмотреть силуэт без бликов.
//
// Сцена живёт по ту же сторону переключателя тем, что и вёрстка, поэтому у
// каждого окружения два набора цветов: на светлой теме тёмный купол выглядит
// дырой посреди страницы.
//
// pedestal — на чём стоит изделие. Геометрия одна (широкий низкий цилиндр),
// меняются пропорции и материал: круг гончарный, подиум, доска, полка печи.

export const ENVIRONMENTS = [
  {
    id: 'workshop',
    name: 'Мастерская',
    note: 'Гончарный круг, тёплый свет из окна',
    ico: 'disc',
    dark:  {sky: 0x2b211a, ground: 0x120e0b},
    light: {sky: 0xefe7db, ground: 0xd3c7b5},
    fog: [900, 2400],
    key: {color: 0xffe4c4, intensity: 2.6, pos: [300, 420, 240]},
    hemi: {dark: [0xbfa98f, 0x241a12, 0.5], light: [0xfff4e6, 0xcbbba6, 0.85]},
    exposure: {dark: 1.05, light: 0.95},
    shadow: {dark: 0.38, light: 0.18},
    pedestal: {kind: 'wheel', pad: 35, height: 15, color: {dark: 0x332a23, light: 0x9b8b7a},
               roughness: 0.62, metalness: 0.25},
    grid: false,
  },
  {
    id: 'studio',
    name: 'Фотостудия',
    note: 'Бесшовный светлый фон, мягкий свет — для снимка в каталог',
    ico: 'camera',
    dark:  {sky: 0xd9d4cc, ground: 0xb8b1a7},
    light: {sky: 0xfbfaf8, ground: 0xe6e2db},
    fog: null,
    key: {color: 0xffffff, intensity: 2.2, pos: [260, 480, 320]},
    hemi: {dark: [0xffffff, 0xb8b1a7, 1.1], light: [0xffffff, 0xdedad3, 1.2]},
    exposure: {dark: 1.0, light: 1.0},
    shadow: {dark: 0.22, light: 0.16},
    pedestal: {kind: 'podium', pad: 60, height: 38, color: {dark: 0xe8e4dd, light: 0xf6f4f0},
               roughness: 0.85, metalness: 0},
    grid: false,
  },
  {
    id: 'shelf',
    name: 'Полка',
    note: 'Деревянная доска у тёплой стены — как вещь стоит дома',
    ico: 'package',
    dark:  {sky: 0x3a2c22, ground: 0x1d1611},
    light: {sky: 0xe8d9c4, ground: 0xc7ac8a},
    fog: [1100, 2800],
    key: {color: 0xffe0bb, intensity: 2.3, pos: [-220, 400, 300]},
    hemi: {dark: [0xd8bb99, 0x2a1e16, 0.6], light: [0xfff0dd, 0xc9b49a, 0.95]},
    exposure: {dark: 1.08, light: 0.98},
    shadow: {dark: 0.42, light: 0.24},
    pedestal: {kind: 'slab', pad: 95, height: 20, color: {dark: 0x6b4a2f, light: 0x9c7248},
               roughness: 0.78, metalness: 0.05},
    grid: false,
  },
  {
    id: 'kiln',
    name: 'Печь',
    note: 'Шамотная полка и жар сбоку — вид на обжиге',
    ico: 'flame',
    dark:  {sky: 0x2a1a12, ground: 0x140c08},
    light: {sky: 0x6b4a34, ground: 0x33211a},
    fog: [600, 1900],
    key: {color: 0xff9a44, intensity: 3.2, pos: [420, 180, 120]},
    hemi: {dark: [0xff8a3c, 0x1a0f0a, 0.75], light: [0xffa356, 0x2a1a12, 0.85]},
    exposure: {dark: 1.15, light: 1.05},
    shadow: {dark: 0.5, light: 0.4},
    pedestal: {kind: 'shelf', pad: 70, height: 26, color: {dark: 0xa89a86, light: 0xc4b8a4},
               roughness: 0.95, metalness: 0},
    grid: false,
  },
  {
    id: 'gallery',
    name: 'Витрина',
    note: 'Тёмный зал и один направленный свет сверху',
    ico: 'lightbulb',
    dark:  {sky: 0x14100e, ground: 0x080605},
    light: {sky: 0x2a2522, ground: 0x141110},
    fog: [700, 2200],
    key: {color: 0xfff2e0, intensity: 3.6, pos: [80, 560, 140]},
    hemi: {dark: [0x6a6058, 0x0a0806, 0.28], light: [0x8a7f74, 0x100d0b, 0.35]},
    exposure: {dark: 1.1, light: 1.05},
    shadow: {dark: 0.55, light: 0.5},
    pedestal: {kind: 'plinth', pad: 55, height: 62, color: {dark: 0x1b1815, light: 0x241f1b},
               roughness: 0.9, metalness: 0},
    grid: false,
  },
  {
    id: 'tech',
    name: 'Технический',
    note: 'Ровный свет и сетка: смотреть силуэт, а не картинку',
    ico: 'ruler',
    dark:  {sky: 0x22201e, ground: 0x181614},
    light: {sky: 0xe9e7e3, ground: 0xd6d3ce},
    fog: null,
    key: {color: 0xffffff, intensity: 1.6, pos: [200, 500, 400]},
    hemi: {dark: [0xffffff, 0x3a3734, 1.3], light: [0xffffff, 0xc9c6c1, 1.4]},
    exposure: {dark: 1.0, light: 1.0},
    shadow: {dark: 0.12, light: 0.1},
    pedestal: {kind: 'none'},
    grid: true,
  },
];

export const byEnvId = id => ENVIRONMENTS.find(e => e.id === id) || ENVIRONMENTS[0];
