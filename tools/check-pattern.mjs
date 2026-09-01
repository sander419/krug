// Проверка узора на стенке: node tools/check-pattern.mjs
//
// Узор — единственная часть формы, которую нельзя вытянуть руками: её кладёт
// сопло, меняя радиус на каждом шаге спирали. Отсюда два обещания, которые
// инструмент обязан держать, и оба проверяются здесь:
//
//   1. **Показанное совпадает с напечатанным.** Модель, STL и G-code берут
//      рельеф из одной функции; если слайсер начнёт считать по-своему, машина
//      напечатает гладкую вазу под красивой картинкой.
//   2. **Числа считаются с рельефом.** В объём радиус входит квадратом, и
//      «как у гладкой» врало бы на проценты массы.
import { PATTERNS, PATTERN_PRESETS, LIMITS, sanitizePattern, patternById, patternOn,
         patternOffset, patternVolumeMl, patternWarnings, patternAmp, patternAreaMM2 }
  from '../js/core/pattern.js';
import { sliceGCode } from '../js/core/slicer.js';
import { state } from '../js/core/state.js';
import { computeProduction, userProfileMM } from '../js/core/math.js';

const problems = [];
const P = t => problems.push(t);
const H = 220;
const prof = Array.from({length: 40}, (_, i) => ({r: 70 + 8 * Math.sin(i / 39 * Math.PI), y: i / 39 * H}));

/* ---------- реестр ---------- */
for (const p of PATTERNS) {
  if (!p.id || !p.name || !p.what) { P(`узор «${p.id || '?'}» без имени или описания`); continue; }
  if (typeof p.f !== 'function') { P(`узор «${p.id}» без формы рельефа`); continue; }
  if (!Array.isArray(p.uses)) P(`узор «${p.id}»: не сказано, какие ручки он использует`);
  for (const k of p.uses || []) if (!LIMITS[k]) P(`узор «${p.id}» просит ручку «${k}», которой нет`);
  /* Рельеф обязан держаться в долях глубины: иначе ползунок «глубина» перестаёт
     что-либо значить, а стенка уходит в минус там, где её никто не проверял. */
  if (p.id !== 'none') {
    let lo = 0, hi = 0;
    for (let i = 0; i < 400; i++) {
      const v = p.f({th: i / 400 * Math.PI * 12, n: 7, v: (i % 100) / 100, m: 5});
      if (!Number.isFinite(v)) { P(`узор «${p.id}» вернул не число`); break; }
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    if (hi > 1.001 || lo < -1.001) P(`узор «${p.id}» выходит за ±1 (${lo.toFixed(2)}…${hi.toFixed(2)})`);
    if (hi - lo < 0.5) P(`узор «${p.id}» почти плоский — рельефа не будет`);
  }
}

/* ---------- очистка ---------- */
{
  const p = sanitizePattern({id: 'нет такого', n: 999, depth: -5, twist: 1e6, m: 0.2});
  if (p.id !== 'none') P('неизвестный узор не сводится к «без узора»');
  if (p.n !== LIMITS.n[1]) P('число повторов не прижато к верхней границе');
  if (p.depth !== 0) P('отрицательная глубина не прижата к нулю');
  if (p.twist !== LIMITS.twist[1]) P('закрутка не прижата к границе');
  if (p.m !== LIMITS.m[0]) P('повторов по высоте не прижато к нижней границе');
  if (patternOn(sanitizePattern({id: 'flute', depth: 0}))) P('нулевая глубина считается включённым узором');
}

/* ---------- рельеф ---------- */
{
  const pat = sanitizePattern({id: 'flute', n: 12, depth: 3, twist: 0, m: 8});
  /* У дна и у кромки рельеф гасится: на пояске он мешает стоять, на кромке —
     пить. Это обещание блока, и его легко потерять при правке формул. */
  if (Math.abs(patternOffset(pat, 0, 0, H)) > 0.2) P('узор не гасится у дна');
  if (Math.abs(patternOffset(pat, 0, H, H)) > 0.2) P('узор не гасится у кромки');
  const mid = patternOffset(pat, 0, H / 2, H);
  if (Math.abs(mid - 3) > 0.01) P(`в середине рельеф ${mid.toFixed(2)} мм вместо глубины 3 мм`);
  /* Повторов по кругу ровно столько, сколько заказано: считаем смены знака. */
  let sign = Math.sign(patternOffset(pat, 0, H / 2, H)), flips = 0;
  for (let i = 1; i <= 720; i++) {
    const s = Math.sign(patternOffset(pat, i / 720 * Math.PI * 2, H / 2, H));
    if (s && s !== sign) { flips++; sign = s; }
  }
  if (flips !== 24) P(`каннелюр по кругу ${flips / 2} вместо 12`);

  /* Закрутка уводит гребень по кругу тем дальше, чем выше. Сравнивать высоту
     рельефа в одной точке бессмысленно: у периодической функции она совпадает
     на разных фазах случайно. Ищем сам гребень. */
  const tw = sanitizePattern({id: 'flute', n: 12, depth: 3, twist: 180, m: 8});
  const crest = y => {
    let best = 0, bv = -Infinity;
    for (let i = 0; i < 720; i++) {
      const th = i / 720 * Math.PI * 2 / 12;          // ищем в пределах одного повтора
      const v = patternOffset(tw, th, y, H);
      if (v > bv) { bv = v; best = th; }
    }
    return best * 180 / Math.PI;
  };
  const moved = Math.abs(crest(H * 0.8) - crest(H * 0.2));
  if (moved < 5) P(`закрутка сдвинула гребень всего на ${moved.toFixed(1)}° по высоте`);
  const straight = sanitizePattern({id: 'flute', n: 12, depth: 3, twist: 0, m: 8});
  const c0 = (y) => {
    let best = 0, bv = -Infinity;
    for (let i = 0; i < 720; i++) {
      const th = i / 720 * Math.PI * 2 / 12;
      const v = patternOffset(straight, th, y, H);
      if (v > bv) { bv = v; best = th; }
    }
    return best;
  };
  if (Math.abs(c0(H * 0.2) - c0(H * 0.8)) > 1e-6) P('без закрутки гребень всё равно уползает');
}

/* ---------- объём ---------- */
{
  const none = sanitizePattern({id: 'none'});
  if (patternVolumeMl(none, prof) !== 0) P('без узора объём меняется');
  const pat = sanitizePattern({id: 'flute', n: 12, depth: 3, twist: 0, m: 8});
  const dv = patternVolumeMl(pat, prof);
  /* У косинуса средний радиус не меняется, но объём растёт: (r+d)² в среднем
     больше r². Поэтому поправка обязана быть положительной и небольшой. */
  if (!(dv > 0)) P(`поправка объёма ${dv.toFixed(2)} см³ — у синусоидального рельефа она положительна`);
  const smooth = Math.PI * 70 * 70 * H / 1000;
  if (dv > smooth * 0.05) P(`поправка объёма ${dv.toFixed(1)} см³ — это больше 5 % тела, что-то не так`);

  /* Та же поправка обязана дойти до массы изделия, а не остаться в модуле. */
  const before = computeProduction(state).massF;
  const keep = state.pattern;
  state.pattern = {id: 'flute', n: 12, depth: 3, twist: 0, m: 8};
  const after = computeProduction(state).massF;
  state.pattern = keep;
  if (!(after > before)) P('масса изделия не учитывает рельеф узора');
}

/* ---------- пресеты ---------- */
/* Пресет — обещание «нажми и получится»: он обязан проходить те же пороги,
   которыми инструмент ругает ручную настройку. Иначе кнопка выдаёт вещь,
   на которую сам же инструмент показывает красным. */
{
  const c = {wall: 5, D: 160, H: 220, bead: 4.2};
  const ids = new Set();
  for (const pr of PATTERN_PRESETS) {
    if (ids.has(pr.id)) P(`пресет «${pr.id}» повторяется`);
    ids.add(pr.id);
    if (!pr.name || !pr.what) P(`пресет «${pr.id}» без имени или описания`);
    const pat = sanitizePattern(pr.pat);
    if (JSON.stringify(pat) !== JSON.stringify({...pat, ...sanitizePattern(pat)}))
      P(`пресет «${pr.id}» не переживает очистку`);
    if (!patternOn(pat)) P(`пресет «${pr.id}» ничего не включает`);
    for (const w of patternWarnings(pat, c))
      if (w.lvl === 'bad') P(`пресет «${pr.name}» сразу даёт красное: ${w.txt}`);
  }
  if (PATTERN_PRESETS.length < 4) P('пресетов меньше четырёх — выбирать не из чего');
}

/* ---------- чертёж и сечение ---------- */
{
  const pat = sanitizePattern({id: 'flute', n: 12, depth: 3, twist: 0, m: 8});
  const amp = patternAmp(pat, H / 2, H);
  if (Math.abs(amp - 3) > 0.05) P(`огибающая чертежа ${amp.toFixed(2)} мм вместо глубины 3 мм`);
  if (patternAmp(pat, 0, H) > 0.2) P('огибающая не гаснет у дна — чертёж покажет рельеф там, где его нет');
  if (patternAmp(sanitizePattern({id: 'none'}), H / 2, H) !== 0) P('без узора огибающая не нулевая');

  /* Сечение с рельефом больше гладкого: гребни добавляют больше, чем убирают
     ложбины, потому что радиус входит в площадь квадратом. */
  const add = patternAreaMM2(pat, 70, H / 2, H);
  if (!(add > 0)) P(`прирост сечения ${add.toFixed(2)} мм² — должен быть положительным`);
  const ring = Math.PI * (70 * 70 - 65 * 65);
  if (add > ring * 0.5) P(`прирост сечения ${add.toFixed(0)} мм² — больше половины кольца, это перебор`);
}

/* ---------- показанное = напечатанное ---------- */
{
  const keep = state.pattern;
  state.pattern = {id: 'flute', n: 8, depth: 3, twist: 0, m: 8};
  const g = sliceGCode(state);
  const out = userProfileMM(state);
  const Hs = out[out.length - 1].y;
  /* Берём один слой в середине высоты и смотрим, гуляет ли радиус по кругу
     ровно так, как обещает patternOffset. */
  const z0 = Hs * 0.5;
  const pts = [];
  for (const line of g.text.split('\n')) {
    const m = /^G1 X(-?[\d.]+) Y(-?[\d.]+) Z([\d.]+)/.exec(line);
    if (!m) continue;
    const z = +m[3];
    if (Math.abs(z - z0) > 1) continue;
    pts.push({r: Math.hypot(+m[1] - 100, +m[2] - 100), a: Math.atan2(+m[2] - 100, +m[1] - 100)});
  }
  if (pts.length < 8) P('в G-code не нашлось слоя для проверки рельефа');
  else {
    const spread = Math.max(...pts.map(p => p.r)) - Math.min(...pts.map(p => p.r));
    const want = 2 * 3;                      // от гребня до ложбины: две глубины
    if (spread < want * 0.5)
      P(`в G-code рельеф ${spread.toFixed(1)} мм вместо ~${want} мм — сопло напечатает гладкую стенку`);
  }
  state.pattern = keep;
}

/* ---------- замечания ---------- */
{
  const c = {wall: 5, D: 160, H: 220, bead: 4.2};
  const ok = patternWarnings(sanitizePattern({id: 'flute', n: 12, depth: 1.5}), c);
  if (ok.length) P('спокойный узор вызывает замечания: ' + ok[0].txt);
  const deep = patternWarnings(sanitizePattern({id: 'flute', n: 12, depth: 4.5}), c);
  if (!deep.some(w => w.lvl === 'bad')) P('рельеф глубже стенки не помечен красным');
  const fine = patternWarnings(sanitizePattern({id: 'flute', n: 60, depth: 2}), c);
  if (!fine.some(w => w.lvl === 'bad')) P('узор мельче бусины не помечен красным');
  const twisted = patternWarnings(sanitizePattern({id: 'flute', n: 12, depth: 2, twist: 700}), c);
  if (!twisted.some(w => w.lvl === 'bad')) P('запредельная закрутка не помечена красным');
  if (patternWarnings(sanitizePattern({id: 'none'}), c).length) P('«без узора» о чём-то предупреждает');
}

console.log('\nПроверка узора на стенке');
console.log(`  узоров: ${PATTERNS.length - 1} плюс «без узора», пресетов: ${PATTERN_PRESETS.length}`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nРельеф считается одинаково для модели, массы и G-code.');
