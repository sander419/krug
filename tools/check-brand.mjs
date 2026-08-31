// Проверка брендбука: node tools/check-brand.mjs
//
// Фирменный цвет выбирает человек, а читать интерфейс потом часами. Значит,
// правило то же, что и для собственных схем инструмента: какой бы цвет ни
// принесли, надпись на кнопке и ссылка на панели обязаны оставаться читаемыми,
// а если это невозможно — человеку надо сказать, а не молча испортить экран.
//
// Здесь проверяется именно это: санитайзер не пускает мусор, оттенки считаются
// под тему, а предупреждения появляются ровно там, где цвет и правда плох.
import { sanitizeBrand, blankBrand, accentTokens, brandWarnings, contrast,
         lighten, darken, toHex, toRGB, LOGO_LIMIT } from '../js/core/brand.js';

const problems = [];
const P = t => problems.push(t);

/* ---------- санитайзер ---------- */
{
  const b = sanitizeBrand({name: '  Гончарная  ', sub: 'x'.repeat(200),
    logo: 'javascript:alert(1)', accent: 'красный', where: {sheet: false}, чужое: 1});
  if (b.name !== 'Гончарная') P('имя не обрезается по краям');
  if (b.sub.length !== 90) P(`подпись не обрезана до 90 знаков: ${b.sub.length}`);
  if (b.logo !== '') P('в логотип пролез не data:image — это дыра, а не картинка');
  if (b.accent !== '') P('в фирменный цвет пролезло не #rrggbb');
  if (b.where.sheet !== false || b.where.card !== true) P('галочки «где показывать» теряются');
  if ('чужое' in b) P('санитайзер пропускает чужие поля');
  const empty = sanitizeBrand(null);
  if (empty.name || empty.logo || empty.accent) P('пустой брендбук не пустой');
  if (JSON.stringify(Object.keys(empty)) !== JSON.stringify(Object.keys(blankBrand())))
    P('пустой брендбук и санитайзер расходятся по полям');
  const big = sanitizeBrand({logo: 'data:image/png;base64,' + 'A'.repeat(LOGO_LIMIT * 2)});
  if (big.logo !== '') P('логотип сверх лимита не отбрасывается');
}

/* ---------- цветовая арифметика ---------- */
{
  if (toHex(toRGB('#e0693a')) !== '#e0693a') P('hex → rgb → hex не сходится');
  if (toHex(toRGB('#abc')) !== '#aabbcc') P('короткая запись цвета не разворачивается');
  if (contrast('#ffffff', '#000000') < 20.9) P('контраст белого и чёрного не 21:1');
  if (lighten('#000000', 1) !== '#ffffff') P('осветление до предела не даёт белый');
  if (darken('#ffffff', 1) !== '#000000') P('затемнение до предела не даёт чёрный');
}

/* ---------- оттенки под тему ---------- */
/* Берём цвета, которыми в самом деле красят мастерские: фирменный синий,
   зелёный, красный, а также заведомо трудные — жёлтый и почти белый. */
const CASES = ['#e0693a', '#2f6df6', '#127a4b', '#b0212a', '#f2c40c', '#f7f2ea', '#101010'];
for (const c of CASES) {
  for (const [theme, panel] of [['dark', '#191817'], ['light', '#ffffff']]) {
    const t = accentTokens(c, theme, panel);
    const link = contrast(t.accent2, panel);
    const warns = brandWarnings(c, theme, panel);
    /* Ссылка либо читается, либо про это сказано вслух. Молча оставить
       нечитаемое — единственный по-настоящему недопустимый исход. */
    if (link < 4.5 && !warns.length)
      P(`${c} на ${theme}: ссылка ${link.toFixed(2)}:1 и ни одного предупреждения`);
    const onBtn = contrast(t.onAccent, c);
    const alt = contrast(t.onAccent === '#101010' ? '#fffdfb' : '#101010', c);
    if (onBtn < alt) P(`${c}: на кнопке выбран худший из двух цветов текста`);
    if (!/^#[0-9a-f]{6}$/.test(t.accent2)) P(`${c} на ${theme}: оттенок ссылки не цвет`);
  }
}

/* Хороший цвет не вызывает предупреждений на пустом месте: берём тот самый
   кобальт, которым инструмент красит тёмную тему, — он проходит наш же порог. */
if (brandWarnings('#5b8ae8', 'dark', '#191817').length)
  P('нормальный синий помечен как проблемный');
/* А заведомо плохой — обязан. Жёлтый на белом и тёмно-синий на тёмной панели:
   один цвет на обе темы неизбежно оказывается плохим для одной из них, и это
   ровно то, о чём человек должен узнать до того, как отдаст лист клиенту. */
if (!brandWarnings('#f2c40c', 'light', '#ffffff').length)
  P('жёлтый на белом не вызвал ни одного предупреждения');
if (!brandWarnings('#1f5bb5', 'dark', '#191817').length)
  P('тёмно-синий на тёмной панели не вызвал предупреждения');

console.log('\nПроверка брендбука');
console.log(`  проверено цветов: ${CASES.length} × 2 темы`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nБрендбук не пускает мусор и не оставляет нечитаемый цвет молча.');
