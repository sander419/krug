// file: js/ui/palette.js
// Цвета для рисования на canvas берутся из тех же токенов, что и вся вёрстка.
// Иначе при смене темы чертёж и диаграмма Сталла остаются тёмными посреди
// светлой страницы — а это половина видимой площади.
//
// getComputedStyle стоит недёшево, а чертёж перерисовывается по движению камеры,
// поэтому значения читаются один раз и сбрасываются на смене темы.

const VARS = ['--text', '--muted', '--muted2', '--accent', '--accent2',
              '--line', '--line2', '--sunken', '--field', '--panel', '--panel2',
              '--ok', '--warn', '--bad'];

let cache = null;

/* '#e8935f' | 'rgb(232,147,95)' -> [232,147,95] */
function toRGB(v) {
  v = (v || '').trim();
  if (v.startsWith('#')) {
    const h = v.length === 4 ? v[1] + v[1] + v[2] + v[2] + v[3] + v[3] : v.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = v.match(/-?[\d.]+/g);
  return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
}

function build() {
  const cs = getComputedStyle(document.documentElement);
  const rgb = {};
  for (const v of VARS) rgb[v] = toRGB(cs.getPropertyValue(v));
  const at = (name, a = 1) => {
    const c = rgb[name] || [128, 128, 128];
    return a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  };
  return {
    at,
    text: a => at('--text', a),
    muted: a => at('--muted', a),
    accent: a => at('--accent', a),
    accent2: a => at('--accent2', a),
    line: a => at('--line', a),
    sunken: a => at('--sunken', a),
    field: a => at('--field', a),
    ok: a => at('--ok', a),
    warn: a => at('--warn', a),
    bad: a => at('--bad', a),
  };
}

export function pal() { return cache || (cache = build()); }
export function resetPalette() { cache = null; }
