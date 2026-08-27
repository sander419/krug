// file: js/core/dxf.js
// Минимальный писатель DXF R12 (AC1009): полилинии по слоям.
// Инструментальщику нужен плоский контур в миллиметрах, а не сетка треугольников,
// поэтому профили уходят так, а не в STL. X — радиус, Y — высота.

const g = (code, value) => `${code}\n${value}\n`;

function polyline(points, layer, closed) {
  let s = g(0, 'POLYLINE') + g(8, layer) + g(66, 1) + g(70, closed ? 1 : 0);
  for (const p of points) {
    s += g(0, 'VERTEX') + g(8, layer) + g(10, p.r.toFixed(3)) + g(20, p.y.toFixed(3)) + g(30, '0.0');
  }
  return s + g(0, 'SEQEND') + g(8, layer);
}

function text(str, x, y, height, layer) {
  return g(0, 'TEXT') + g(8, layer) + g(10, x.toFixed(3)) + g(20, y.toFixed(3)) + g(30, '0.0')
       + g(40, height.toFixed(2)) + g(1, str);
}

/* layers: [{name, points, closed}], notes: [строки подписи] */
export function buildDXF(layers, notes = []) {
  let s = '';
  s += g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1009')
     + g(9, '$INSUNITS') + g(70, 4)              // 4 = миллиметры
     + g(0, 'ENDSEC');

  const tableLayers = notes.length ? [...layers, {name: 'NOTES', color: 8}] : layers;
  s += g(0, 'SECTION') + g(2, 'TABLES') + g(0, 'TABLE') + g(2, 'LAYER') + g(70, tableLayers.length);
  for (const l of tableLayers)
    s += g(0, 'LAYER') + g(2, l.name) + g(70, 0) + g(62, l.color || 7) + g(6, 'CONTINUOUS');
  s += g(0, 'ENDTAB') + g(0, 'ENDSEC');

  s += g(0, 'SECTION') + g(2, 'ENTITIES');
  for (const l of layers)
    if (l.points && l.points.length > 1) s += polyline(l.points, l.name, !!l.closed);

  // подписи столбиком под чертежом
  const minY = Math.min(...layers.flatMap(l => (l.points || []).map(p => p.y)), 0);
  notes.forEach((t, i) => { s += text(t, 0, minY - 12 - i * 8, 5, 'NOTES'); });

  s += g(0, 'ENDSEC') + g(0, 'EOF');
  return s;
}
