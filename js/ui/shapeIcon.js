// file: js/ui/shapeIcon.js
// Иконка пресета — его собственный силуэт. Готового набора «ваза / кувшин / банка»
// в линейном стиле не существует, а рисовать их руками значит рисовать неправду:
// у пресета уже есть точный профиль. Половина сечения отражается по оси — и на
// кнопке видно ровно ту форму, которая появится на круге.
import { sampleProfile } from '../core/math.js';

export function shapeIcon(pts, size = 18) {
  const sm = sampleProfile(pts, 20);
  const maxR = Math.max(1e-6, ...sm.map(s => s.x));
  const pad = 2.5, W = 24, H = 24;
  const x = r => (W / 2 + r / maxR * (W / 2 - pad)).toFixed(1);
  const y = t => (H - pad - t * (H - pad * 2)).toFixed(1);
  const right = sm.map(s => `${x(s.x)},${y(s.y)}`);
  const left = [...sm].reverse().map(s => `${x(-s.x)},${y(s.y)}`);
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"` +
    ' stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"' +
    ` focusable="false"><path d="M${right.join(' L')} L${left.join(' L')} Z"/></svg>`;
}
