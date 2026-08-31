// file: js/ui/brand.js
// Брендбук в интерфейсе: хранение, применение и подготовка логотипа.
//
// Правила и цветовая арифметика лежат в `js/core/brand.js`, здесь — работа
// с браузером: localStorage, чтение файла логотипа, подстановка в шапку
// и переопределение акцентных токенов.
//
// Фирменный цвет ставится **инлайновым стилем на корень**, а не отдельным
// блоком в стилях: так он перекрывает и тему, и любую цветовую схему, не
// заводя третьего места, где живут цвета. Оттенки пересчитываются на смене
// темы — на тёмной панели ссылка обязана быть светлее фирменного цвета,
// на светлой темнее.
import { blankBrand, sanitizeBrand, hasBrand, accentTokens, fontById, LOGO_LIMIT }
  from '../core/brand.js';
import { currentTheme, onTheme } from './theme.js';
import { $ } from './dom.js';

const KEY = 'krug.brand';
const listeners = new Set();

let brand = blankBrand();

export function loadBrand() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw ? sanitizeBrand(raw) : blankBrand();
  } catch (_) { return blankBrand(); }
}

export const currentBrand = () => brand;
export function onBrand(fn) { listeners.add(fn); }

export function saveBrand(next) {
  brand = sanitizeBrand(next);
  try { localStorage.setItem(KEY, JSON.stringify(brand)); }
  catch (_) { return false; }              // квота: логотип не влез
  applyBrand();
  return true;
}

export function patchBrand(part) {
  return saveBrand({...brand, ...part, where: {...brand.where, ...(part.where || {})}});
}

/* Токены акцента и подпись в шапке. Вызывается на каждое изменение бренда
   и на каждую смену темы: оттенки зависят от того, светло сейчас или темно. */
export function applyBrand() {
  const root = document.documentElement;
  const b = brand;
  const useHead = b.where.header;

  if (b.accent && useHead) {
    const panel = getComputedStyle(root).getPropertyValue('--panel').trim() || null;
    const t = accentTokens(b.accent, currentTheme(), panel);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent2', t.accent2);
    root.style.setProperty('--accentDark', t.accentDark);
    root.style.setProperty('--onAccent', t.onAccent);
    root.style.setProperty('--glow', t.glow);
    root.style.setProperty('--sect-form', t.accent);
    root.dataset.brandAccent = '1';
  } else {
    for (const v of ['--accent', '--accent2', '--accentDark', '--onAccent', '--glow', '--sect-form'])
      root.style.removeProperty(v);
    delete root.dataset.brandAccent;
  }

  /* Шрифт — часть оболочки, а не документа: он ставится независимо от того,
     разрешено ли показывать имя мастерской в шапке. */
  const f = fontById(b.font);
  root.style.setProperty('--font-ui', f.ui);
  root.style.setProperty('--font-head', f.head);

  const logo = $('brandLogo');
  if (logo) {
    const on = useHead && !!b.logo;
    logo.hidden = !on;
    if (on && logo.getAttribute('src') !== b.logo) logo.setAttribute('src', b.logo);
    const mark = $('krugMark');
    if (mark) mark.hidden = on;
  }
  const name = $('brandName');
  if (name) name.textContent = useHead && b.name ? b.name : 'КРУГ';
  const sub = $('brandOwn');
  if (sub) {
    const on = useHead && !!b.sub;
    sub.hidden = !on;
    if (on) sub.textContent = b.sub;
  }
  /* Название документа — то же имя: вкладка в браузере тоже часть оболочки. */
  const title = useHead && b.name ? `${b.name} · КРУГ` : null;
  if (title && document.title !== title) document.title = title;

  for (const fn of listeners) fn(brand);
}

/**
 * Логотип из файла: уменьшается до 320 px по большей стороне и кладётся
 * в PNG-строку. Уменьшаем сами, потому что в localStorage лежит ещё и список
 * изделий с миниатюрами — фотография логотипа на 4 МБ вытеснила бы его.
 * SVG остаётся как есть: он и так лёгкий, а растрировать вектор незачем.
 */
export function readLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('это не картинка'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('файл не читается'));
    fr.onload = () => {
      const src = String(fr.result || '');
      if (file.type === 'image/svg+xml') {
        return src.length <= LOGO_LIMIT ? resolve(src)
          : reject(new Error('SVG крупнее 256 КБ — упростите файл'));
      }
      const img = new Image();
      img.onerror = () => reject(new Error('картинка не открывается'));
      img.onload = () => {
        const max = 320;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        /* PNG — потому что у знака бывает прозрачный фон, а JPEG его зальёт. */
        const out = c.toDataURL('image/png');
        out.length <= LOGO_LIMIT ? resolve(out)
          : reject(new Error('логотип слишком тяжёлый даже после уменьшения'));
      };
      img.src = src;
    };
    fr.readAsDataURL(file);
  });
}

export function initBrand() {
  brand = loadBrand();
  applyBrand();
  /* Тема поменялась — оттенки фирменного цвета пересчитываются заново. */
  onTheme(() => { if (hasBrand(brand)) applyBrand(); });
}
