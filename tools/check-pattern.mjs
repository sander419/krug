// Проверка узора на стенке: node tools/check-pattern.mjs
//
// Узор — единственная часть формы, которую нельзя вытянуть руками: её кладёт
// сопло, меняя радиус на каждом шаге спирали. Отсюда три обещания, которые
// инструмент обязан держать, и все три проверяются здесь:
//
//   1. **Показанное совпадает с напечатанным.** Модель, STL и G-code берут
//      рельеф из одной функции; если слайсер начнёт считать по-своему, машина
//      напечатает гладкую вазу под красивой картинкой. Со стопкой слоёв это
//      обещание стало шире: в G-code обязана уехать сумма всех слоёв, а не
//      верхний из них.
//   2. **Числа считаются с рельефом.** В объём радиус входит квадратом, и
//      «как у гладкой» врало бы на проценты массы.
//   3. **Стенку режут все слои сразу.** Два слоя по 2,5 мм в одном поясе
//      прорвут стенку 5 мм, хотя по отдельности каждый безобиден. Арифметикой
//      по одному слою это не ловится — только перебором по всей вещи.
import { readFileSync } from 'node:fs';
import { PATTERNS, PATTERN_PRESETS, LIMITS, MAX_LAYERS, LAYER_DEFAULTS,
         sanitizePattern, sanitizeLayer, packPattern, patternById, patternOn,
         patternOffset, patternVolumeMl, patternWarnings, patternAmp, patternBand,
         patternRelief, patternAreaMM2, patternTitle, patternSummary, patternFn, patternFade }
  from '../js/core/pattern.js';
import { sliceGCode } from '../js/core/slicer.js';
import { state } from '../js/core/state.js';
import { computeProduction, userProfileMM } from '../js/core/math.js';

const problems = [];
const P = t => problems.push(t);
const H = 220;
const prof = Array.from({length: 40}, (_, i) => ({r: 70 + 8 * Math.sin(i / 39 * Math.PI), y: i / 39 * H}));
const one = (over = {}) => sanitizePattern({layers: [{id: 'flute', n: 12, depth: 3, twist: 0, m: 8, ...over}]});

/* ---------- реестр ---------- */
{
  const ids = new Set();
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  for (const p of PATTERNS) {
    if (ids.has(p.id)) P(`узор «${p.id}» повторяется в реестре`);
    ids.add(p.id);
    if (!p.id || !p.name || !p.what) { P(`узор «${p.id || '?'}» без имени или описания`); continue; }
    if (typeof p.f !== 'function') { P(`узор «${p.id}» без формы рельефа`); continue; }
    if (!Array.isArray(p.uses)) P(`узор «${p.id}»: не сказано, какие ручки он использует`);
    for (const k of p.uses || []) if (!LIMITS[k]) P(`узор «${p.id}» просит ручку «${k}», которой нет`);
    /* Узор выбирают глазами: карточка без росчерка — пустой квадрат в списке,
       и человек жмёт наугад. */
    if (!css.includes(`[data-pat-ico="${p.id}"]`)) P(`у узора «${p.id}» нет росчерка в styles.css`);
    /* Рельеф обязан держаться в долях глубины: иначе ползунок «глубина» перестаёт
       что-либо значить, а стенка уходит в минус там, где её никто не проверял. */
    let lo = 0, hi = 0;
    for (let i = 0; i < 400; i++) {
      const v = p.f({th: i / 400 * Math.PI * 12, n: 7, v: (i % 100) / 100, m: 5});
      if (!Number.isFinite(v)) { P(`узор «${p.id}» вернул не число`); break; }
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    if (hi > 1.001 || lo < -1.001) P(`узор «${p.id}» выходит за ±1 (${lo.toFixed(2)}…${hi.toFixed(2)})`);
    if (hi - lo < 0.5) P(`узор «${p.id}» почти плоский — рельефа не будет`);
    /* Обещание «растёт наружу» проверяется формулой, а не словом: на нём
       держится и остаток стенки в ложбине, и огибающая на чертеже. */
    if (p.outward && lo < -0.001) P(`узор «${p.id}» помечен наружным, но уходит внутрь на ${lo.toFixed(2)}`);
  }
  if (PATTERNS.length < 8) P('форм рельефа меньше восьми — конструктору не из чего собирать');
}

/* ---------- очистка ---------- */
{
  const bad = sanitizeLayer({id: 'нет такого'});
  if (bad !== null) P('неизвестная форма рельефа не отбрасывается');
  if (patternOn(sanitizePattern({layers: [{id: 'нет такого'}]}))) P('стопка из несуществующего узора считается включённой');

  const l = sanitizeLayer({id: 'flute', n: 999, depth: -5, twist: 1e6, m: 0.2, phase: -40, from: 0.9, to: 0.2, edge: 9});
  if (l.n !== LIMITS.n[1]) P('число повторов не прижато к верхней границе');
  if (l.depth !== 0) P('отрицательная глубина не прижата к нулю');
  if (l.twist !== LIMITS.twist[1]) P('закрутка не прижата к границе');
  if (l.m !== LIMITS.m[0]) P('повторов по высоте не прижато к нижней границе');
  if (l.phase !== LIMITS.phase[0]) P('сдвиг по кругу не прижат к границе');
  if (!(l.to > l.from)) P('перевёрнутый пояс не развёрнут: конец не выше начала');
  if (l.edge > LIMITS.edge[1]) P('мягкость края не прижата к границе');
  if (patternOn(sanitizePattern({layers: [{id: 'flute', depth: 0}]}))) P('нулевая глубина считается включённым узором');

  /* Старая ссылка обязана открываться тем же рельефом, а не «примерно похожим»:
     до слоёв узор лежал плоской записью, и таких ссылок уже выпущено. */
  const old = sanitizePattern({id: 'weave', n: 14, depth: 2.5, twist: 60, m: 10});
  if (old.layers.length !== 1) P('старая плоская запись узора не читается');
  else {
    const o = old.layers[0];
    if (o.id !== 'weave' || o.n !== 14 || o.depth !== 2.5 || o.twist !== 60 || o.m !== 10)
      P('старая запись узора прочиталась с другими числами');
    if (o.from !== 0 || o.to !== 1) P('у старого узора появился пояс, которого в нём не было');
  }

  const many = sanitizePattern({layers: Array.from({length: MAX_LAYERS + 3}, () => ({id: 'flute'}))});
  if (many.layers.length !== MAX_LAYERS) P(`стопка не обрезана до ${MAX_LAYERS} слоёв`);
  if (sanitizePattern(null).layers.length) P('пустая запись даёт слои из ниоткуда');

  /* ДНК уезжает ссылкой: запись обязана пережить упаковку без потерь
     и быть заметно короче полной. */
  const rich = sanitizePattern({layers: [
    {id: 'bump', n: 14, depth: 2.2, m: 5, from: 0.34, to: 0.66, edge: 0.06, phase: 45},
    {id: 'wave', depth: 1, m: 2}]});
  const back = sanitizePattern(packPattern(rich));
  if (JSON.stringify(back.layers) !== JSON.stringify(rich.layers)) P('узор не переживает упаковку в ДНК');
  const packed = JSON.stringify(packPattern(rich)), full = JSON.stringify(rich);
  if (packed.length >= full.length) P(`упаковка не короче полной записи (${packed.length} против ${full.length})`);
  if (packPattern(sanitizePattern(null)) !== null) P('пустой узор занимает место в ДНК');
}

/* ---------- рельеф одного слоя ---------- */
{
  const pat = one();
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
  const crestOf = (p, y) => {
    let best = 0, bv = -Infinity;
    for (let i = 0; i < 1440; i++) {
      const th = i / 1440 * Math.PI * 2 / 12;          // в пределах одного повтора
      const v = patternOffset(p, th, y, H);
      if (v > bv) { bv = v; best = th; }
    }
    return best * 180 / Math.PI;
  };
  const tw = one({twist: 180});
  const moved = Math.abs(crestOf(tw, H * 0.8) - crestOf(tw, H * 0.2));
  if (moved < 5) P(`закрутка сдвинула гребень всего на ${moved.toFixed(1)}° по высоте`);
  if (Math.abs(crestOf(pat, H * 0.2) - crestOf(pat, H * 0.8)) > 0.1) P('без закрутки гребень всё равно уползает');

  /* Сдвиг по кругу двигает гребень ровно на заданный угол — им совмещают
     слои между собой и уводят рисунок от ручки. */
  const shifted = one({phase: 10});
  const d = crestOf(shifted, H / 2) - crestOf(pat, H / 2);
  const per = 360 / 12;
  const got = ((d % per) + per) % per;
  if (Math.abs(got - (per - 10)) > 0.6 && Math.abs(got - 10) > 0.6)
    P(`сдвиг 10° сдвинул гребень на ${got.toFixed(1)}°`);
}

/* ---------- пояс по высоте ---------- */
{
  const belt = sanitizePattern({layers: [
    {id: 'flute', n: 12, depth: 3, from: 0.4, to: 0.6, edge: 0.04}]});
  if (Math.abs(patternOffset(belt, 0, H * 0.5, H) - 3) > 0.01)
    P('в середине своего пояса слой не даёт полной глубины');
  for (const q of [0.2, 0.8])
    if (Math.abs(patternOffset(belt, 0, H * q, H)) > 0.001)
      P(`слой с поясом 40–60 % даёт рельеф на высоте ${q * 100} %`);
  /* Край пояса мягкий, а не ступенькой: ступенька на печати это шов,
     на котором вещь и трескается. */
  const edge = Math.abs(patternOffset(belt, 0, H * 0.41, H));
  if (!(edge > 0.05 && edge < 2.95)) P(`край пояса не растушёван: на 41 % высоты ${edge.toFixed(2)} мм`);

  /* Пояс на всю высоту обязан вести себя ровно как узор до появления слоёв:
     иначе все выпущенные ссылки поехали бы. */
  const full = one();
  if (Math.abs(patternOffset(full, 0, H * 0.1, H) - patternOffset(one({from: 0, to: 1}), 0, H * 0.1, H)) > 1e-9)
    P('слой на всю высоту гасится собственным поясом');
}

/* ---------- слои складываются ---------- */
{
  const a = {id: 'flute', n: 12, depth: 2};
  const b = {id: 'wave', depth: 1, m: 4};
  const both = sanitizePattern({layers: [a, b]});
  const pa = sanitizePattern({layers: [a]}), pb = sanitizePattern({layers: [b]});
  for (const y of [H * 0.3, H * 0.5, H * 0.77]) {
    for (const th of [0, 0.4, 2.1]) {
      const sum = patternOffset(pa, th, y, H) + patternOffset(pb, th, y, H);
      if (Math.abs(patternOffset(both, th, y, H) - sum) > 1e-9)
        P('стопка не равна сумме своих слоёв — печатается не то, что показано');
    }
  }
  if (patternTitle(both) !== 'Каннелюры + Кольца') P(`имя стопки «${patternTitle(both)}» вместо «Каннелюры + Кольца»`);
  if (patternSummary(both).length !== 2) P('в описании стопки не все слои');

  /* Настоящий размах рельефа: два слоя в одном поясе режут стенку вместе.
     Считается перебором, а не сложением глубин, и это не педантизм: у слоёв
     с разным числом повторов гребни встречаются не в одной точке, и складывать
     их глубины значило бы пугать человека рельефом, которого нет. */
  const deep = sanitizePattern({layers: [
    {id: 'flute', n: 12, depth: 2.5}, {id: 'flute', n: 12, depth: 2.5}]});
  const {carve, raise} = patternRelief(deep, H);
  if (Math.abs(carve - 5) > 0.05) P(`два совпавших слоя по 2,5 мм срезают ${carve.toFixed(2)} мм вместо 5`);
  if (Math.abs(raise - 5) > 0.05) P(`два совпавших слоя по 2,5 мм поднимают ${raise.toFixed(2)} мм вместо 5`);
  const apartCrests = patternRelief(sanitizePattern({layers: [
    {id: 'flute', n: 12, depth: 2.5}, {id: 'flute', n: 12, depth: 2.5, phase: 15}]}), H);
  if (apartCrests.carve > 4.9)
    P('слои с разведёнными гребнями засчитаны как совпавшие');

  /* Наружный слой стенку не режет — на этом стоит весь остаток стенки. */
  const out = patternRelief(sanitizePattern({layers: [{id: 'bump', n: 14, depth: 3, m: 8}]}), H);
  if (out.carve > 0.001) P(`чешуя срезает ${out.carve.toFixed(2)} мм, хотя растёт наружу`);
  if (out.raise < 2.9) P('чешуя не поднимается на свою глубину');
}

/* ---------- быстрая функция = медленная ---------- */
/* Сцена собирает тело вращения через patternFn (всё, что не зависит от точки,
   посчитано заранее), а слайсер зовёт patternOffset. Это две записи одной
   формулы, и разойтись они могут молча: на экране один рельеф, в G-code другой.
   Поэтому они сверяются числами на всех формах рельефа сразу. */
{
  const layers = PATTERNS.map((x, i) => ({
    id: x.id, n: 7 + i, depth: 1 + (i % 3) * 0.5, m: 3 + (i % 5), twist: (i % 4) * 45,
    phase: (i % 6) * 30, from: i % 2 ? 0.2 : 0, to: i % 2 ? 0.8 : 1, edge: 0.07,
  }));
  let worst = 0;
  for (const l of layers) {
    const pat = sanitizePattern({layers: [l]});
    const fn = patternFn(pat);
    for (let i = 0; i <= 30; i++) {
      const y = i / 30 * H, v = y / H;
      for (let k = 0; k < 16; k++) {
        const th = k / 16 * Math.PI * 2;
        const fast = fn(th, v, patternFade(y, H));
        worst = Math.max(worst, Math.abs(fast - patternOffset(pat, th, y, H)));
      }
    }
  }
  if (worst > 1e-9) P(`быстрая функция рельефа расходится с медленной на ${worst.toFixed(4)} мм`);
  /* И стопка целиком: пояса в горячем цикле считаются заново. */
  const st = sanitizePattern({layers: [
    {id: 'flute', n: 12, depth: 2, phase: 20},
    {id: 'bump', n: 9, depth: 1.5, m: 6, from: 0.3, to: 0.7, edge: 0.05}]});
  const fn = patternFn(st);
  let w2 = 0;
  for (let i = 0; i <= 40; i++) {
    const y = i / 40 * H;
    for (let k = 0; k < 12; k++) {
      const th = k / 12 * Math.PI * 2;
      w2 = Math.max(w2, Math.abs(fn(th, y / H, patternFade(y, H)) - patternOffset(st, th, y, H)));
    }
  }
  if (w2 > 1e-9) P(`на стопке быстрая функция расходится с медленной на ${w2.toFixed(4)} мм`);
  if (patternFn(sanitizePattern(null)) !== null) P('без узора быстрая функция не пустая');
}

/* ---------- объём ---------- */
{
  if (patternVolumeMl(sanitizePattern(null), prof) !== 0) P('без узора объём меняется');
  const pat = one();
  const dv = patternVolumeMl(pat, prof);
  /* У косинуса средний радиус не меняется, но объём растёт: (r+d)² в среднем
     больше r². Поэтому поправка обязана быть положительной и небольшой. */
  if (!(dv > 0)) P(`поправка объёма ${dv.toFixed(2)} см³ — у синусоидального рельефа она положительна`);
  const smooth = Math.PI * 70 * 70 * H / 1000;
  if (dv > smooth * 0.05) P(`поправка объёма ${dv.toFixed(1)} см³ — это больше 5 % тела, что-то не так`);
  /* Второй слой добавляет глины: если поправка не растёт, в массу уходит
     только верхний слой. */
  const two = sanitizePattern({layers: [
    {id: 'flute', n: 12, depth: 3}, {id: 'bump', n: 10, depth: 2, m: 8}]});
  if (!(patternVolumeMl(two, prof) > dv + 1)) P('второй слой не прибавляет глины');

  /* Та же поправка обязана дойти до массы изделия, а не остаться в модуле. */
  const before = computeProduction(state).massF;
  const keep = state.pattern;
  state.pattern = {layers: [{id: 'flute', n: 12, depth: 3}]};
  const after = computeProduction(state).massF;
  state.pattern = keep;
  if (!(after > before)) P('масса изделия не учитывает рельеф узора');
}

/* ---------- пресеты ---------- */
/* Пресет — обещание «нажми и получится»: он обязан проходить те же пороги,
   которыми инструмент ругает ручную настройку. Иначе кнопка выдаёт вещь,
   на которую сам же инструмент показывает красным. */
{
  const c = {wall: 5, D: 160, H: 220, bead: 4.2, layerH: 2.4};
  const ids = new Set();
  let stacked = 0;
  for (const pr of PATTERN_PRESETS) {
    if (ids.has(pr.id)) P(`пресет «${pr.id}» повторяется`);
    ids.add(pr.id);
    if (!pr.name || !pr.what) P(`пресет «${pr.id}» без имени или описания`);
    const pat = sanitizePattern(pr.pat);
    if (JSON.stringify(pat.layers) !== JSON.stringify(sanitizePattern({layers: pat.layers}).layers))
      P(`пресет «${pr.id}» не переживает очистку`);
    if (!patternOn(pat)) P(`пресет «${pr.id}» ничего не включает`);
    if (pat.layers.length > 1) stacked++;
    for (const w of patternWarnings(pat, c))
      if (w.lvl === 'bad') P(`пресет «${pr.name}» сразу даёт красное: ${w.txt}`);
  }
  if (PATTERN_PRESETS.length < 6) P('пресетов меньше шести — выбирать не из чего');
  /* Хотя бы пара пресетов обязана быть стопкой: иначе конструктор слоёв
     показан только на словах, и до второго слоя никто не доберётся. */
  if (stacked < 2) P('среди пресетов меньше двух многослойных — конструктор не с чего начать');
}

/* ---------- чертёж и сечение ---------- */
{
  const pat = one();
  const amp = patternAmp(pat, H / 2, H);
  if (Math.abs(amp - 3) > 0.05) P(`огибающая чертежа ${amp.toFixed(2)} мм вместо глубины 3 мм`);
  if (patternAmp(pat, 0, H) > 0.2) P('огибающая не гаснет у дна — чертёж покажет рельеф там, где его нет');
  if (patternAmp(sanitizePattern(null), H / 2, H) !== 0) P('без узора огибающая не нулевая');

  /* Огибающие несимметричны там, где рельеф односторонний: чешуя растёт
     наружу, лунки уходят внутрь. Симметричный пунктир обещал бы борозду,
     которой на вещи нет. */
  const up = patternBand(sanitizePattern({layers: [{id: 'bump', n: 12, depth: 2, m: 8}]}), H / 2, H);
  if (up.lo < -0.001) P('огибающая чешуи уходит внутрь стенки');
  const down = patternBand(sanitizePattern({layers: [{id: 'dimple', n: 12, depth: 2, m: 8}]}), H / 2, H);
  if (down.hi > 0.001) P('огибающая лунок выходит наружу стенки');

  /* Сечение с рельефом больше гладкого: гребни добавляют больше, чем убирают
     ложбины, потому что радиус входит в площадь квадратом. */
  const add = patternAreaMM2(pat, 70, H / 2, H);
  if (!(add > 0)) P(`прирост сечения ${add.toFixed(2)} мм² — должен быть положительным`);
  const ring = Math.PI * (70 * 70 - 65 * 65);
  if (add > ring * 0.5) P(`прирост сечения ${add.toFixed(0)} мм² — больше половины кольца, это перебор`);
}

/* ---------- показанное = напечатанное ---------- */
/* Стопка проверяется целиком: слои складываются в модели, и если слайсер
   возьмёт из неё один, машина напечатает не ту вещь. */
{
  const keep = state.pattern;
  state.pattern = {layers: [
    {id: 'flute', n: 8, depth: 2}, {id: 'wave', depth: 1, m: 5}]};
  const pat = sanitizePattern(state.pattern);
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
    const c0 = bedCenter(g.text);
    pts.push({r: Math.hypot(+m[1] - c0.x, +m[2] - c0.y), a: Math.atan2(+m[2] - c0.y, +m[1] - c0.x)});
  }
  if (pts.length < 8) P('в G-code не нашлось слоя для проверки рельефа');
  else {
    const spread = Math.max(...pts.map(p => p.r)) - Math.min(...pts.map(p => p.r));
    const want = 2 * 2;                      // от гребня до ложбины: две глубины каннелюр
    if (spread < want * 0.5)
      P(`в G-code рельеф ${spread.toFixed(1)} мм вместо ~${want} мм — сопло напечатает гладкую стенку`);
    /* Кольца лежат по высоте, и на разных слоях радиус в одной и той же точке
       круга обязан отличаться: без второго слоя он был бы одинаков. */
    const at = z => {
      const c0 = bedCenter(g.text);
      for (const line of g.text.split('\n')) {
        const m = /^G1 X(-?[\d.]+) Y(-?[\d.]+) Z([\d.]+)/.exec(line);
        if (!m) continue;
        if (Math.abs(+m[3] - z) > 0.5) continue;
        const x = +m[1] - c0.x, y = +m[2] - c0.y;
        if (Math.abs(Math.atan2(y, x)) < 0.05) return Math.hypot(x, y);
      }
      return null;
    };
    const r1 = at(Hs * 0.5), r2 = at(Hs * 0.56);
    if (r1 !== null && r2 !== null && Math.abs(r1 - r2) < 0.3)
      P('в G-code второй слой узора не виден: по высоте радиус не меняется');
  }
  state.pattern = keep;
}

/* Центр изделия на столе печатает сам слайсер — берём оттуда, а не наугад:
   у принтеров с нулём в углу он не в начале координат. */
function bedCenter(text) {
  const m = /центр изделия X([\d.-]+) Y([\d.-]+)/.exec(text);
  return m ? {x: +m[1], y: +m[2]} : {x: 0, y: 0};
}

/* Рельеф обязан быть на каждом периметре, а не только на наружном: внутренние
   идут тем же контуром со смещением внутрь. Пока это было не так, между
   петлями гулял зазор в две глубины — местами бусины наезжали друг на друга,
   местами между ними оставалась щель.

   Проверяем не «на глаз по размаху», а совпадение с формулой: каждая точка
   слоя обязана лечь на одну из петель, посчитанных тем же patternOffset. */
{
  const keep = {pattern: state.pattern, wall: state.wall};
  state.pattern = {layers: [{id: 'flute', n: 10, depth: 2.5}]};
  state.wall = 9;                                  // толстая стенка — несколько петель
  const pat = sanitizePattern(state.pattern);
  const g = sliceGCode(state);
  const out2 = userProfileMM(state);
  const Hs = out2[out2.length - 1].y;
  const z0 = Hs * 0.5;
  const bead = (state.pr.nozzle || 4) * 1.05;
  const c = bedCenter(g.text);
  const seen = new Set();
  let offCurve = 0, total = 0;
  for (const line of g.text.split(String.fromCharCode(10))) {
    const m = /^G1 X(-?[\d.]+) Y(-?[\d.]+) Z([\d.]+)/.exec(line);
    if (!m) continue;
    const z = +m[3];
    if (Math.abs(z - z0) > 0.6) continue;
    const x = +m[1] - c.x, y = +m[2] - c.y;
    const r = Math.hypot(x, y), ang = Math.atan2(y, x);
    /* Радиус профиля на этой высоте — по тем же точкам, что и у слайсера. */
    let rProf = out2[0].r;
    for (let i = 1; i < out2.length; i++)
      if (out2[i].y >= z) {
        const k = (z - out2[i - 1].y) / Math.max(out2[i].y - out2[i - 1].y, 1e-9);
        rProf = out2[i - 1].r + (out2[i].r - out2[i - 1].r) * k;
        break;
      }
    const base = rProf + patternOffset(pat, ang, z, Hs) - bead / 2;
    let bestP = -1, bestD = Infinity;
    for (let p = 0; p < 4; p++) {
      const d = Math.abs(r - (base - p * bead * 0.95));
      if (d < bestD) { bestD = d; bestP = p; }
    }
    total++;
    if (bestD > 0.4) offCurve++; else seen.add(bestP);
  }
  if (total < 20) P('в G-code не нашлось слоя с петлями для проверки рельефа');
  else {
    if (offCurve > total * 0.1)
      P(`${offCurve} из ${total} точек слоя не лежат ни на одной петле с рельефом`);
    if (seen.size < 2)
      P('рельеф нашёлся только на одной петле — внутренние идут по гладкому контуру');
  }
  state.pattern = keep.pattern; state.wall = keep.wall;
}

/* ---------- замечания ---------- */
{
  const c = {wall: 5, D: 160, H: 220, bead: 4.2, layerH: 2.4};
  const ok = patternWarnings(one({depth: 1.5}), c);
  if (ok.length) P('спокойный узор вызывает замечания: ' + ok[0].txt);
  if (!patternWarnings(one({depth: 4.5}), c).some(w => w.lvl === 'bad'))
    P('рельеф глубже стенки не помечен красным');
  if (!patternWarnings(one({n: 60, depth: 2}), c).some(w => w.lvl === 'bad'))
    P('узор мельче бусины не помечен красным');
  if (!patternWarnings(one({depth: 2, twist: 700}), c).some(w => w.lvl === 'bad'))
    P('запредельная закрутка не помечена красным');
  if (patternWarnings(sanitizePattern(null), c).length) P('«без узора» о чём-то предупреждает');

  /* Главная новая ловушка: каждый слой сам по себе безобиден, а вместе
     они прорывают стенку. Считать по одному слою здесь нельзя. */
  const stack = sanitizePattern({layers: [
    {id: 'flute', n: 12, depth: 2.4}, {id: 'flute', n: 12, depth: 2.4}]});
  if (!patternWarnings(stack, c).some(w => w.lvl === 'bad'))
    P('два слоя, вместе прорывающие стенку, не помечены красным');
  /* А те же слои в разных поясах стенку не режут вместе — и ругать их не за что. */
  const apart = sanitizePattern({layers: [
    {id: 'flute', n: 12, depth: 2.4, from: 0, to: 0.45},
    {id: 'flute', n: 12, depth: 2.4, from: 0.55, to: 1}]});
  if (patternWarnings(apart, c).some(w => w.lvl === 'bad'))
    P('слои в разных поясах засчитаны как режущие стенку вместе');

  /* Печать набирается слоями: рельеф с периодом короче трёх слоёв машине
     нечем нарисовать. На экране кольца, на изделии — гладкая стенка. */
  const fast = sanitizePattern({layers: [{id: 'wave', depth: 1, m: 40}]});
  if (!patternWarnings(fast, c).some(w => w.lvl === 'bad' && /высот/.test(w.txt)))
    P('рельеф мельче высоты слоя печати не помечен красным');
  if (patternWarnings(sanitizePattern({layers: [{id: 'wave', depth: 1, m: 6}]}), c).length)
    P('спокойные кольца ругаются на высоту слоя');

  /* Пояс, целиком лежащий в зоне гашения, — ползунки крутятся, рельефа нет. */
  const lost = sanitizePattern({layers: [{id: 'flute', n: 12, depth: 2, from: 0, to: 0.05}]});
  if (!patternWarnings(lost, c).some(w => w.lvl === 'warn'))
    P('пояс в зоне гашения не помечен: рельефа не будет, а сказать некому');
}

console.log('\nПроверка узора на стенке');
console.log(`  форм рельефа: ${PATTERNS.length}, пресетов: ${PATTERN_PRESETS.length}, слоёв в стопке: до ${MAX_LAYERS}`);
console.log(`  умолчание слоя: ${LAYER_DEFAULTS.id} ${LAYER_DEFAULTS.depth} мм, ${LAYER_DEFAULTS.n} по кругу`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nРельеф считается одинаково для модели, массы и G-code, а стопка — как сумма слоёв.');
