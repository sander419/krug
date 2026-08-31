// file: js/core/brand.js
// Брендбук мастерской: логотип, название и свой акцент.
//
// КРУГ считает вещь, но отдаёт её наружу: лист A3 уходит на верстак, техкарта —
// в производство, витрина — на сайт мастерской. Пока на всех трёх стояло только
// слово «КРУГ», мастерская отдавала клиенту документ чужого инструмента.
//
// Отсюда брендбук: логотип, имя, подпись и один фирменный цвет. Цвет — именно
// **один**: остальные оттенки (ссылка, нажатая кнопка, текст на кнопке) выводятся
// из него, потому что подобранная руками пятёрка почти всегда расходится
// по контрасту, а инструмент, в который смотрят часами, обязан оставаться
// читаемым. Насколько читаемым — считается тут же и говорится прямо.
//
// Здесь только правила и цветовая арифметика. Ни DOM, ни localStorage: экран
// настроек (`js/ui/settings.js`) хранит и применяет, ядро — проверяет и считает.

/**
 * Наборы шрифтов. Только те, что лежат в `vendor/`, и системный: внешних
 * запросов у КРУГа нет принципиально, поэтому «любой шрифт мастерской»
 * означал бы либо загрузку с чужого сервера, либо обещание, которого
 * инструмент не сдержит.
 */
export const FONTS = [
  {id: 'krug', name: 'Как в КРУГе', what: 'Unbounded в заголовках, Manrope в тексте',
   head: "'Unbounded','Manrope',system-ui,sans-serif", ui: "'Manrope',system-ui,sans-serif"},
  {id: 'plain', name: 'Один Manrope', what: 'спокойнее: заголовки тем же шрифтом',
   head: "'Manrope',system-ui,sans-serif", ui: "'Manrope',system-ui,sans-serif"},
  {id: 'system', name: 'Системный', what: 'шрифт этой машины — для длинных смен',
   head: 'system-ui,"Segoe UI",Roboto,sans-serif', ui: 'system-ui,"Segoe UI",Roboto,sans-serif'},
];
export const fontById = id => FONTS.find(f => f.id === id) || FONTS[0];

/** Пустой брендбук: инструмент выглядит как КРУГ. */
export function blankBrand() {
  return {
    name: '', sub: '', logo: '', accent: '', font: 'krug',
    where: {header: true, sheet: true, card: true, embed: true},
  };
}

/* Логотип живёт в localStorage вместе со всем остальным, а квота там общая
   на весь сайт и обычно 5 МБ. Четверть мегабайта — заведомо достаточно для
   знака мастерской и заведомо безопасно для списка изделий. */
export const LOGO_LIMIT = 256 * 1024;
export const NAME_LIMIT = 40;
export const SUB_LIMIT = 90;

const HEX = /^#[0-9a-f]{6}$/i;

/** Привести запись к схеме: чужие поля выбрасываются, свои — обрезаются. */
export function sanitizeBrand(b) {
  const src = b && typeof b === 'object' ? b : {};
  const w = src.where && typeof src.where === 'object' ? src.where : {};
  const logo = typeof src.logo === 'string' && /^data:image\//.test(src.logo)
    && src.logo.length <= LOGO_LIMIT * 1.4 ? src.logo : '';
  return {
    name: String(src.name || '').trim().slice(0, NAME_LIMIT),
    sub: String(src.sub || '').trim().slice(0, SUB_LIMIT),
    logo,
    accent: HEX.test(String(src.accent || '')) ? String(src.accent).toLowerCase() : '',
    font: FONTS.some(f => f.id === src.font) ? src.font : 'krug',
    where: {
      header: w.header !== false, sheet: w.sheet !== false,
      card: w.card !== false, embed: w.embed !== false,
    },
  };
}

/** Есть ли вообще что показывать. */
export const hasBrand = b => !!(b && (b.name || b.logo || b.accent || (b.font && b.font !== 'krug')));

/* ---------- цвет ---------- */

export function toRGB(hex) {
  const h = String(hex || '').replace('#', '');
  const s = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(s.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
}

export const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, '0')).join('');

const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = rgb => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);

/** Отношение контраста по WCAG 2.1. */
export function contrast(a, b) {
  const [x, y] = [luminance(toRGB(a)), luminance(toRGB(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const mix = (a, b, t) => toRGB(a).map((v, i) => v + (toRGB(b)[i] - v) * t);

/** Светлее к белому (t = 0…1). */
export const lighten = (hex, t) => toHex(mix(hex, '#ffffff', t));
/** Темнее к чёрному. */
export const darken = (hex, t) => toHex(mix(hex, '#000000', t));

/**
 * Полный набор акцентных токенов из одного фирменного цвета.
 *
 * Оттенки считаются под тему, а не «на глаз»: на тёмной панели ссылка обязана
 * быть светлее фирменного цвета, на светлой — темнее, иначе она читается хуже
 * обычного текста. Подмешиваем ступенями по 6 % и останавливаемся на первой,
 * которая проходит порог 4,5:1 — так фирменный цвет искажается ровно настолько,
 * насколько этого требует читаемость, и ни каплей больше.
 *
 * @param accent фирменный цвет `#rrggbb`
 * @param theme 'dark' | 'light'
 * @param surface цвет панели, на которой всё это лежит
 */
export function accentTokens(accent, theme, surface) {
  const dark = theme !== 'light';
  const panel = surface || (dark ? '#191817' : '#ffffff');
  let accent2 = accent;
  for (let t = 0; t <= 0.9; t += 0.06) {
    accent2 = dark ? lighten(accent, t) : darken(accent, t);
    if (contrast(accent2, panel) >= 4.5) break;
  }
  /* Текст на самой кнопке: берём тот из двух, что читается лучше. Белая
     надпись на светло-жёлтой кнопке — самый частый способ испортить бренд. */
  const onAccent = contrast('#ffffff', accent) >= contrast('#101010', accent)
    ? '#fffdfb' : '#101010';
  const rgb = toRGB(accent);
  return {
    accent,
    accent2,
    accentDark: dark ? darken(accent, 0.22) : darken(accent, 0.14),
    onAccent,
    glow: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${dark ? 0.3 : 0.2})`,
  };
}

/**
 * Что не так с выбранным цветом. Пустой список — всё в порядке.
 * Проверяется то же, что и у собственных схем инструмента: текст на кнопке
 * и акцент на панели.
 */
export function brandWarnings(accent, theme, surface) {
  if (!HEX.test(String(accent || ''))) return [];
  const t = accentTokens(accent, theme, surface);
  const panel = surface || (theme === 'light' ? '#ffffff' : '#191817');
  const out = [];
  /* Числа печатаем с двумя знаками: «4,5 при норме 4,5» выглядит придиркой,
     хотя на самом деле там 4,46 — и это честная разница. */
  const fmt = v => v.toFixed(2).replace('.', ',');
  const onBtn = contrast(t.onAccent, accent);
  if (onBtn < 4.5)
    out.push({lvl: 'warn', txt: `Надпись на кнопке этого цвета читается на ${fmt(onBtn)}:1 ` +
      'при норме 4,5:1 — возьмите цвет темнее или светлее.'});
  const onPanel = contrast(t.accent, panel);
  if (onPanel < 3)
    out.push({lvl: 'warn', txt: `Сам цвет на панели даёт ${fmt(onPanel)}:1 при норме 3:1 — ` +
      'рамки и подписи этим цветом будут теряться.'});
  if (contrast(t.accent2, panel) < 4.5)
    out.push({lvl: 'warn', txt: 'Ссылки и числа этим цветом читаются хуже нормы даже после ' +
      'осветления — КРУГ подберёт ближайший читаемый оттенок.'});
  return out;
}

/** Подпись для документов: что писать в шапке листа и техкарты. */
export function brandLine(b, fallback = 'КРУГ') {
  const s = sanitizeBrand(b);
  return s.name || fallback;
}
