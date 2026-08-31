// file: js/core/sheet.js
// Лист для передачи на производство: три вида, размеры и таблица данных.
//
// Техкарта текстом отвечает на вопрос «что делать», но её нельзя положить
// на верстак рядом с гипсом. Мастеру нужен лист: изделие видно со всех сторон,
// размеры проставлены, числа собраны в одну таблицу. Отсюда SVG — он векторный,
// открывается любым браузером, печатается в PDF и не требует ни одной программы.
//
// Формат A3 в альбом (420×297 мм), единица SVG = миллиметр листа. Масштаб видов
// подбирается под самый крупный габарит, чтобы три вида были в одном масштабе:
// на чертеже нельзя сравнивать виды, снятые по-разному.
//
// Прилепы на видах спереди и в разрезе развёрнуты в плоскость листа — так же,
// как на чертеже в самом инструменте, и об этом на листе написано. По азимутам
// они стоят на виде сверху, где это и читают.

const esc = s => String(s).replace(/[&<>"']/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const SHEET = {w: 420, h: 297, pad: 10};
const INK = '#1a1a1a', THIN = '#8a8a8a', AXIS = '#b03a1a';

/* Рамка вида с подписью: у каждого вида на чертеже своё поле и своё имя. */
function frame(x, y, w, h, title) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"
            stroke="${THIN}" stroke-width="0.25"/>
    <text x="${x + 3}" y="${y + 6}" font-size="4" fill="${INK}" font-weight="600">${esc(title)}</text>`;
}

function dimH(x1, x2, y, label) {
  const m = (x1 + x2) / 2;
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${INK}" stroke-width="0.25"
            marker-start="url(#a)" marker-end="url(#a)"/>
    <text x="${m}" y="${y - 1.5}" font-size="3.2" fill="${INK}" text-anchor="middle">${esc(label)}</text>`;
}
function dimV(y1, y2, x, label) {
  const m = (y1 + y2) / 2;
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${INK}" stroke-width="0.25"
            marker-start="url(#a)" marker-end="url(#a)"/>
    <text x="${x - 1.5}" y="${m}" font-size="3.2" fill="${INK}" text-anchor="middle"
          transform="rotate(-90 ${x - 1.5} ${m})">${esc(label)}</text>`;
}

const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

/**
 * @param m {name, date, dna, brand?:{name, sub, logo}, prof, wall, H, D, firedH, firedD, shrinkPct,
 *           parts:[{name, az, pts, reach}], rows:[[label, value]], notes:[string],
 *           lid?:{pts:[{r,y}], outline:[{r,y}], seatD, seatDFired, gapFired, topY, outD}}
 */
export function buildSheet(m) {
  const {pad} = SHEET;
  /* Лист уходит клиенту и на верстак: если у мастерской есть свой знак и имя,
     в углу стоят они, а не название инструмента. Нет — стоит «КРУГ». */
  const brand = {name: 'КРУГ', sub: '', logo: '', ...(m.brand || {})};
  const tblY = SHEET.h - pad - 40;                 // над этой линией — виды
  const top = pad + 10;
  const viewH = tblY - top - 6;

  /* Три поля во всю ширину листа: разрез уже остальных — он половинный,
     виду сверху нужно больше всех, потому что прилепы торчат в обе стороны. */
  const W = SHEET.w - pad * 2;
  const col = [0.34, 0.24, 0.42].map(f => f * W);
  const x0 = [pad, pad + col[0], pad + col[0] + col[1]];

  const reach = Math.max(m.D / 2, ...m.parts.map(p => p.reach || 0));
  /* Масштаб один на все виды: чертёж, снятый по-разному, сравнивать нельзя.
     Ограничивает самый тесный вид — сверху, где укладывается два вылета. */
  /* Крышку обжигают на изделии, и на лист она попадает вместе с ним: иначе
     мастер не увидит ни высоты в сборе, ни того, куда садится поясок. */
  const lid = m.lid || null;
  const hTotal = Math.max(m.H, lid ? lid.topY : 0);
  const dTotal = Math.max(m.D, lid ? lid.outD : 0);
  const k = Math.min((col[2] - 18) / (reach * 2), (col[0] - 14) / (reach + dTotal / 2),
                     (viewH - 26) / hTotal);

  const outer = m.prof.map(p => ({r: p.r, y: p.y}));
  const base = top + viewH - 14;                    // общая линия земли для видов
  const px = cx => (r, y) => ({x: cx + r * k, y: base - y * k});

  /* ---- вид спереди: силуэт и его зеркало ---- */
  const fx = x0[0] + col[0] / 2;
  const P = px(fx);
  const right = outer.map(p => P(p.r, p.y));
  const left = outer.slice().reverse().map(p => P(-p.r, p.y));
  const front = `<path d="${path(right)} ${path(left).replace('M', 'L')} Z"
      fill="none" stroke="${INK}" stroke-width="0.5" stroke-linejoin="round"/>
    <line x1="${fx}" y1="${base + 4}" x2="${fx}" y2="${base - m.H * k - 8}"
      stroke="${AXIS}" stroke-width="0.25" stroke-dasharray="6 2 1 2"/>`;
  /* Спереди крышку видно силуэтом: наружная поверхность и её зеркало,
     внутренние линии на этом виде — мусор, их место в разрезе. */
  const lidOut = lid ? (lid.outline || lid.pts) : [];
  const lidFront = lid ? `<path d="${path(lidOut.map(q => P(q.r, q.y)))}
      ${path(lidOut.slice().reverse().map(q => P(-q.r, q.y))).replace('M', 'L')} Z"
      fill="none" stroke="${INK}" stroke-width="0.5" stroke-linejoin="round"/>` : '';
  const partsFront = m.parts.map(p =>
    `<path d="${path(p.pts.map(q => P(q.x, q.y)))}" fill="none"
       stroke="${INK}" stroke-width="0.5" stroke-linecap="round"/>`).join('');

  /* ---- разрез: закрашен материал, а не тело. Половина сечения от оси вправо:
     наружу по профилю, через кромку внутрь, вниз по стенке до дна и по дну
     обратно к оси. Ровно то, что увидел бы пилящий изделие пополам. ---- */
  const sx = x0[1] + col[1] * 0.34;
  const S = px(sx);
  const floorY = m.footH || 0;
  const above = outer.filter(p => p.y >= floorY);
  const cut = [S(0, outer[0].y)]
    .concat(outer.map(p => S(p.r, p.y)))                                  // наружу снизу вверх
    .concat(above.slice().reverse().map(p => S(Math.max(0, p.r - m.wall), p.y)))  // внутрь вниз
    .concat([S(0, floorY)]);                                              // по дну к оси
  const section = `<path d="${path(cut)} Z" fill="#ded8d2" stroke="${INK}" stroke-width="0.45"
      stroke-linejoin="round"/>
    <line x1="${sx}" y1="${base + 4}" x2="${sx}" y2="${base - m.H * k - 8}"
      stroke="${AXIS}" stroke-width="0.3" stroke-dasharray="6 2 1 2"/>
    <text x="${sx - 2}" y="${base - m.H * k - 10}" font-size="2.8" fill="${AXIS}"
      text-anchor="end">ось</text>`;

  /* Крышка в разрезе — та же штриховка материала, что и у корпуса: видно,
     как поясок входит в горловину и какой между ними зазор. */
  const lidSection = lid ? `<path d="${path(lid.pts.map(q => S(q.r, q.y)))} Z"
      fill="#ded8d2" stroke="${INK}" stroke-width="0.45" stroke-linejoin="round"/>` : '';

  /* ---- вид сверху: окружности и прилепы по азимутам ---- */
  const tx = x0[2] + col[2] / 2, ty = top + viewH / 2;
  const plan = [`<circle cx="${tx}" cy="${ty}" r="${(m.D / 2) * k}" fill="none"
      stroke="${INK}" stroke-width="0.5"/>`,
    `<circle cx="${tx}" cy="${ty}" r="${(m.footR || m.D / 4) * k}" fill="none"
      stroke="${THIN}" stroke-width="0.3" stroke-dasharray="2 1.5"/>`,
    `<line x1="${tx - (reach + 5) * k}" y1="${ty}" x2="${tx + (reach + 5) * k}" y2="${ty}"
      stroke="${AXIS}" stroke-width="0.25" stroke-dasharray="6 2 1 2"/>`,
    `<line x1="${tx}" y1="${ty - (reach + 5) * k}" x2="${tx}" y2="${ty + (reach + 5) * k}"
      stroke="${AXIS}" stroke-width="0.25" stroke-dasharray="6 2 1 2"/>`,
  ];
  if (lid) plan.push(`<circle cx="${tx}" cy="${ty}" r="${(lid.outD / 2) * k}" fill="none"
      stroke="${INK}" stroke-width="0.35" stroke-dasharray="3 1.5"/>
    <text x="${tx}" y="${ty - (lid.outD / 2) * k - 1.5}" font-size="2.8" fill="${INK}"
      text-anchor="middle">крышка ⌀${Math.round(lid.outD)}</text>`);
  for (const p of m.parts) {
    const a = (p.az || 0) * Math.PI / 180;
    const r0 = (m.D / 2) * k, r1 = (p.reach || m.D / 2) * k;
    const x1 = tx + Math.sin(a) * r1, y1 = ty - Math.cos(a) * r1;
    plan.push(`<line x1="${(tx + Math.sin(a) * r0).toFixed(2)}" y1="${(ty - Math.cos(a) * r0).toFixed(2)}"
        x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="${INK}" stroke-width="1.4"
        stroke-linecap="round"/>
      <circle cx="${x1.toFixed(2)}" cy="${y1.toFixed(2)}" r="0.8" fill="${INK}"/>
      <text x="${x1.toFixed(2)}" y="${(y1 - 2.5).toFixed(2)}" font-size="3" fill="${INK}"
        text-anchor="middle">${esc(p.name)} ${p.az}° · ${Math.round(p.reach || 0)}</text>`);
  }

  /* ---- размеры: высота и диаметр на виде спереди, стенка на разрезе ---- */
  const dims = [
    dimH(fx - (m.D / 2) * k, fx + (m.D / 2) * k, base + 8, `⌀${Math.round(m.D)}`),
    dimV(base, base - m.H * k, x0[0] + 6, `${Math.round(m.H)}`),
    dimH(sx, sx + m.wall * k, base - m.H * k * 0.5, `${m.wall}`),
    lid ? dimH(fx - (lid.seatD / 2) * k, fx + (lid.seatD / 2) * k, base - lid.topY * k - 4,
               `поясок ⌀${lid.seatD.toFixed(1)}`) : '',
    lid ? dimV(base, base - lid.topY * k, x0[0] + 12, `${Math.round(lid.topY)} с крышкой`) : '',
  ].join('');
  /* ---- таблица данных ---- */
  const tblX = pad;
  const colN = 4, cw = (SHEET.w - pad * 2) / colN;
  const rows = m.rows.map(([label, value], i) => {
    const c = i % colN, r = Math.floor(i / colN);
    const x = tblX + c * cw, y = tblY + 6 + r * 5.2;
    return `<text x="${x + 2}" y="${y}" font-size="3.1" fill="${THIN}">${esc(label)}</text>
      <text x="${x + cw - 2}" y="${y}" font-size="3.4" fill="${INK}" font-weight="600"
        text-anchor="end">${esc(value)}</text>`;
  }).join('');

  const notes = m.notes.map((n, i) =>
    `<text x="${pad + 2}" y="${SHEET.h - pad - 7 + i * 3.6}" font-size="2.8"
      fill="${THIN}">${esc(n)}</text>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.w}mm" height="${SHEET.h}mm"
  viewBox="0 0 ${SHEET.w} ${SHEET.h}" font-family="Arial, Helvetica, sans-serif">
  <defs><marker id="a" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
    <path d="M0 3 L6 1.2 L6 4.8 Z" fill="${INK}"/></marker></defs>
  <rect width="${SHEET.w}" height="${SHEET.h}" fill="#ffffff"/>
  <rect x="${pad / 2}" y="${pad / 2}" width="${SHEET.w - pad}" height="${SHEET.h - pad}"
    fill="none" stroke="${INK}" stroke-width="0.5"/>

  ${brand.logo ? `<image href="${brand.logo}" x="${pad}" y="${pad - 4}" width="12" height="12"
    preserveAspectRatio="xMidYMid meet"/>` : ''}
  <text x="${pad + (brand.logo ? 15 : 0)}" y="${pad + 5}" font-size="6" font-weight="700"
    fill="${INK}">${esc(m.name)}</text>
  <text x="${SHEET.w - pad}" y="${pad + 5}" font-size="3.4" fill="${THIN}"
    text-anchor="end">${esc(brand.name)} · ${esc(m.date)} · масштаб 1:${(1 / k).toFixed(1)}</text>
  ${brand.sub ? `<text x="${SHEET.w - pad}" y="${pad + 9.5}" font-size="2.8" fill="${THIN}"
    text-anchor="end">${esc(brand.sub)}</text>` : ''}

  ${frame(x0[0], top, col[0], viewH, 'Вид спереди')}
  ${frame(x0[1], top, col[1], viewH, 'Разрез')}
  ${frame(x0[2], top, col[2], viewH, 'Вид сверху')}
  ${front}${partsFront}${lidFront}${section}${lidSection}${plan.join('')}${dims}

  <line x1="${pad}" y1="${tblY}" x2="${SHEET.w - pad}" y2="${tblY}"
    stroke="${INK}" stroke-width="0.4"/>
  ${rows}${notes}
  <text x="${SHEET.w - pad}" y="${SHEET.h - pad - 1}" font-size="2.6" fill="${THIN}"
    text-anchor="end">${esc(m.dna || '')}</text>
</svg>`;
}
