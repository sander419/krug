// file: js/core/tooling.js
// Оснастка для серийного производства: технологичность профиля под жёсткую форму,
// пересчёт размеров через усадку, усилие пресса, масса заготовки.
// Чистая логика, без DOM. Единицы — мм, граммы, если не сказано иначе.
import { userProfileMM, floorY } from './math.js';
import { partMetrics, partsHandMinutes, partSelfOverlap } from './parts.js';
import { partMouldBlock, partMouldFeatures } from '../three/partMould.js';
import { strainerHoles } from './strainer.js';
import { kindOf as partKind } from '../config/parts.js';
import { byId as materialById } from '../config/materials.js';
import { byId as processById, LIMITS } from '../config/processes.js';
import { economics } from './economics.js';
import { cavityStock } from './mould.js';
import { byId as plasterById, plasterMix } from '../config/plasters.js';

const DEG = 180 / Math.PI;

/* ---------- усадка ---------- */
/* Размер оснастки = размер готового изделия / ((1 - усадка сушки)(1 - усадка обжига)).
   В паспортах масс чаще одна цифра — полная усадка; тогда множитель тот же,
   только с одним сомножителем. */
export function shrinkFactor(mat) {
  const air = mat.airShrinkPct;                 // если поставщик дал воздушную отдельно
  if (air != null && mat.shrinkPct > air) {
    const sd = air / 100;
    const sf = (mat.shrinkPct - air) / 100 / (1 - sd);   // остаток до полной усадки
    return {k: 1 / ((1 - sd) * (1 - sf)), sd, sf, split: true};
  }
  const s = mat.shrinkPct / 100;
  return {k: 1 / (1 - s), sd: null, sf: s, split: false};
}

/* Какой сырой размер нужен, чтобы после обжига получить заданный. */
export const rawForTarget = (targetMM, mat) => targetMM * shrinkFactor(mat).k;
/* И обратно: что получится из нарисованного. */
export const firedFromRaw = (rawMM, mat) => rawMM / shrinkFactor(mat).k;

/* ---------- геометрия профиля ---------- */
/* Экстремумы радиуса, отфильтрованные по глубине. Мелкая рябь профиля —
   не поднутрение: считаем перегибом только тот, где радиус реально проваливается
   больше чем на `minDepth` миллиметров. Каждый оставшийся перегиб — это ещё одна
   часть жёсткой формы: изделие не вынуть цельной оснасткой через сужение. */
function significantExtrema(prof, minDepth = LIMITS.minUndercutMM) {
  // сырые экстремумы вместе с концами профиля
  let pts = [{r: prof[0].r, y: prof[0].y}];
  for (let i = 1; i < prof.length - 1; i++) {
    const a = prof[i - 1].r, b = prof[i].r, c = prof[i + 1].r;
    if ((b - a) * (c - b) < 0) pts.push({r: b, y: prof[i].y});
  }
  pts.push({r: prof[prof.length - 1].r, y: prof[prof.length - 1].y});

  // выбрасываем экстремумы с малым перепадом, пока такие есть
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    let worstI = -1, worstD = Infinity;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.min(Math.abs(pts[i].r - pts[i - 1].r), Math.abs(pts[i].r - pts[i + 1].r));
      if (d < minDepth && d < worstD) { worstD = d; worstI = i; }
    }
    if (worstI > 0) {
      pts.splice(worstI, 1);
      // после удаления соседи могут оказаться однонаправленными — схлопываем
      pts = pts.filter((p, i, arr) =>
        i === 0 || i === arr.length - 1 || (p.r - arr[i - 1].r) * (arr[i + 1].r - p.r) < 0);
      changed = true;
    }
  }
  return pts;
}

/* Что мешает снять жёсткую форму вдоль оси. Изделие вынимается вверх только если
   радиус нигде не убывает кверху: любое сужение выше широкого места запирает деталь.
   Поэтому считаем все внутренние экстремумы профиля — и пузо, и горло. Глубина
   перегиба = меньший из двух перепадов до соседних экстремумов. */
export function undercutList(prof, minDepth = LIMITS.minUndercutMM) {
  const ext = significantExtrema(prof, minDepth);
  const out = [];
  for (let i = 1; i < ext.length - 1; i++) {
    const depth = Math.min(Math.abs(ext[i].r - ext[i - 1].r), Math.abs(ext[i].r - ext[i + 1].r));
    out.push({
      y: ext[i].y,
      depthMM: depth,
      kind: ext[i].r > ext[i - 1].r ? 'пузо' : 'горло',
    });
  }
  return out;
}

/* Углы уклона по сегментам: 0° — стенка вдоль оси, положительный — расширяется вверх. */
function draftAngles(prof) {
  const out = [];
  for (let i = 1; i < prof.length; i++) {
    const dy = prof[i].y - prof[i - 1].y;
    if (dy <= 1e-6) continue;
    const dr = prof[i].r - prof[i - 1].r;
    out.push({y: (prof[i].y + prof[i - 1].y) / 2, deg: Math.atan2(dr, dy) * DEG});
  }
  return out;
}

/* Настоящая толщина стенки поперёк поверхности. В рецепте стенка отложена
   по горизонтали, поэтому на пологих участках (борт тарелки) реальный пласт
   получается тоньше: t = wall · cos(угол стенки от оси). */
function normalThickness(prof, wall) {
  const out = [];
  for (let i = 1; i < prof.length; i++) {
    const dy = prof[i].y - prof[i - 1].y, dr = prof[i].r - prof[i - 1].r;
    const len = Math.hypot(dy, dr);
    if (len < 1e-6) continue;
    out.push({y: (prof[i].y + prof[i - 1].y) / 2, t: wall * Math.abs(dy) / len});
  }
  return out;
}

/* Минимальный радиус кривизны профиля — по трём соседним точкам. */
function minCurvatureRadius(prof) {
  let min = Infinity, atY = 0;
  for (let i = 1; i < prof.length - 1; i++) {
    const a = prof[i - 1], b = prof[i], c = prof[i + 1];
    const ax = a.r, ay = a.y, bx = b.r, by = b.y, cx = c.r, cy = c.y;
    const area2 = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    if (area2 < 1e-9) continue;                       // три точки на прямой
    const ab = Math.hypot(bx - ax, by - ay);
    const bc = Math.hypot(cx - bx, cy - by);
    const ca = Math.hypot(ax - cx, ay - cy);
    const R = (ab * bc * ca) / (2 * area2);
    if (R < min) { min = R; atY = by; }
  }
  return {R: isFinite(min) ? min : null, y: atY};
}

/* ---------- технологичность ---------- */
export function analyzeFormability(state) {
  const prof = userProfileMM(state);
  const ext = significantExtrema(prof);
  const undercutsList = undercutList(prof);
  const drafts = draftAngles(prof);
  const th = normalThickness(prof, state.wall);
  const curv = minCurvatureRadius(prof);

  const maxR = Math.max(...prof.map(p => p.r));
  const partingY = prof.find(p => p.r >= maxR - 1e-6).y;

  const undercuts = undercutsList.length;
  const deepest = undercutsList.reduce((a, b) => (b.depthMM > (a ? a.depthMM : 0) ? b : a), null);
  const minDraft = drafts.length ? drafts.reduce((m, d) => Math.min(m, Math.abs(d.deg)), 90) : 90;
  const minDraftAt = drafts.length ? drafts.reduce((a, b) => (Math.abs(b.deg) < Math.abs(a.deg) ? b : a)).y : 0;
  const tMin = th.length ? th.reduce((m, x) => Math.min(m, x.t), Infinity) : state.wall;
  const tMinAt = th.length ? th.reduce((a, b) => (b.t < a.t ? b : a)).y : 0;

  return {
    prof, extrema: ext, undercutsList, undercuts, deepest,
    parts: undercuts + 1,                           // монотонных участков = частей формы вдоль оси
    partingY, maxR,
    minDraftDeg: minDraft, minDraftAtMM: minDraftAt,
    minWallMM: tMin, minWallAtMM: tMinAt, nominalWallMM: state.wall,
    minFilletMM: curv.R, minFilletAtMM: curv.y,
    hd: state.H / Math.max(state.D, 1),
    hasFoot: state.footH > 0,
    floorMM: floorY(state),
  };
}

/* ---------- выбор процесса ---------- */
export function recommendProcess(state, an) {
  const why = [];
  let id;
  if (an.undercuts > 0) {
    id = 'casting';
    why.push(`Поднутрение ${an.deepest.depthMM.toFixed(1)} мм на высоте ${Math.round(an.deepest.y)} мм (${an.deepest.kind}): широкое место не пройдёт через узкое, из жёсткой оснастки не вынуть.`);
  } else if (an.hd < LIMITS.flatMaxHD) {
    id = 'ram';
    why.push(`Плоская форма (H/D = ${an.hd.toFixed(2)}) без поднутрений — классика для штамповки и ролика.`);
  } else if (an.hd <= LIMITS.deepMinHD) {
    id = 'ram';
    why.push(`Открытая форма средней глубины (H/D = ${an.hd.toFixed(2)}) без поднутрений — жёсткая оснастка работает.`);
  } else {
    id = 'casting';
    why.push(`Глубокая узкая форма (H/D = ${an.hd.toFixed(2)}) — пласт в такую оснастку не додавится.`);
  }
  if (id !== 'casting' && an.minDraftDeg < LIMITS.minDraftDeg)
    why.push(`Уклон стенки ${an.minDraftDeg.toFixed(1)}° на высоте ${Math.round(an.minDraftAtMM)} мм — изделие будет липнуть к форме.`);
  return {id, alt: id === 'ram' ? 'roller' : 'ram', why};
}

/* ---------- проверки для карточки ---------- */
export function checks(state, an, procId) {
  const proc = processById(procId);
  const rigid = !proc.allowsUndercut;
  const out = [];
  const add = (lvl, txt, help) => out.push({lvl, txt, help});

  // ручка ломает саму посылку тела вращения: её не отформовать вместе с корпусом
  const np = (state.parts || []).length;
  if (np)
    add('warn', `Прилепов ${np}: тело вращения кончается на корпусе. Каждый формуют отдельно — своя гипсовая форма или ручная работа — и прилепляют к подвяленному изделию. Всё, что ниже, посчитано по корпусу.`, 'handles-joins');

  if (an.undercuts === 0) add('ok', 'Поднутрений нет: профиль снимается с оснастки вдоль оси.', 'tooling-basics');
  else if (rigid) add('bad', `Поднутрение ${an.deepest.depthMM.toFixed(1)} мм на высоте ${Math.round(an.deepest.y)} мм — ${an.deepest.kind} (всего перегибов ${an.undercuts}). Для «${proc.short}» нужна форма из ${an.parts} частей — процесс не подходит. Уберите завал профиля, и форма станет пригодной.`, 'tooling-basics');
  else add('warn', `Перегибов профиля ${an.undercuts}, самый глубокий ${an.deepest.depthMM.toFixed(1)} мм на высоте ${Math.round(an.deepest.y)} мм (${an.deepest.kind}) — форма разъёмная, из ${an.parts} частей. Линия разъёма на высоте ${Math.round(an.partingY)} мм.`, 'casting');

  if (an.minDraftDeg >= LIMITS.minDraftDeg)
    add('ok', `Минимальный уклон ${an.minDraftDeg.toFixed(1)}° — изделие сходит с формы.`, 'tooling-basics');
  else
    add(rigid ? 'bad' : 'warn', `Минимальный уклон ${an.minDraftDeg.toFixed(1)}° на высоте ${Math.round(an.minDraftAtMM)} мм: стенка почти вдоль оси, изделие липнет. Порог инструмента — ${LIMITS.minDraftDeg}°.`, 'tooling-basics');

  const ratio = an.minWallMM / an.nominalWallMM;
  if (ratio >= LIMITS.thinWallRatio && (!rigid || an.minWallMM >= LIMITS.minWallRamMM))
    add('ok', `Толщина пласта ровная: минимум ${an.minWallMM.toFixed(1)} мм при заданных ${an.nominalWallMM} мм.`, 'ram-press');
  else
    add(rigid && an.minWallMM < LIMITS.minWallRamMM ? 'bad' : 'warn',
        `Реальная толщина падает до ${an.minWallMM.toFixed(1)} мм на высоте ${Math.round(an.minWallAtMM)} мм (задано ${an.nominalWallMM} мм): стенка отложена по горизонтали, а на пологом участке пласт тоньше.`, 'ram-press');

  if (an.minFilletMM != null && an.minFilletMM < LIMITS.minFilletMM)
    add('warn', `Радиус перехода ${an.minFilletMM.toFixed(1)} мм на высоте ${Math.round(an.minFilletAtMM)} мм — острые углы в гипсовой форме выкрашиваются.`, 'plaster-tooling');

  if (an.hasFoot)
    add('warn', 'Подрезка ножки даёт выемку в дне: в жёсткой оснастке ей нужен свой уклон, в этот расчёт профиля она не входит.', 'tooling-basics');

  return out;
}

/* ---------- числа техкарты ---------- */
export function toolingNumbers(state, prod, an, procId) {
  const mat = materialById(state.mat);
  const proc = processById(procId);
  const sh = shrinkFactor(mat);

  // модель оснастки строится по сырому размеру — это и есть то, что нарисовано
  const model = {H: state.H, D: state.D, wall: state.wall};
  const fired = {H: state.H / sh.k, D: state.D / sh.k};

  const projAreaMM2 = Math.PI * Math.pow(state.D / 2, 2);
  const force = proc.pressureMPa
    ? proc.pressureMPa.map(p => p * projAreaMM2 / 1000)      // МПа·мм² → кН
    : null;

  const blankG = prod.massF * (1 + LIMITS.flashPct / 100);

  return {
    proc, mat, shrink: sh, model, fired,
    projAreaMM2,
    forceKN: force,
    forceTons: force ? force.map(f => f / 9.80665) : null,
    blankG, flashPct: LIMITS.flashPct,
    pieceG: prod.massF,
    partingY: an.partingY,
    parts: an.parts,
  };
}

/* Сколько комплектов форм нужно на тираж и что известно про ресурс. */
export function batchPlan(procId, pieces) {
  const proc = processById(procId);
  if (!proc.mouldLife) return {known: false, proc};
  const [lo, hi] = proc.mouldLife;
  return {
    known: true, proc, lo, hi,
    setsLo: Math.ceil(pieces / hi),
    setsHi: Math.ceil(pieces / lo),
  };
}

/* ---------- техкарта текстом ---------- */
export function techCard(state, prod, an, procId, pieces, econOpt = {}, mouldOpt = {}) {
  const stock = cavityStock(state, mouldOpt.mould || {});
  const plaster = plasterById(mouldOpt.plasterId);
  const wr = mouldOpt.waterRatio || plaster.waterRatio || 70;
  const mix = plasterMix(stock.netLitres, wr);
  const n = toolingNumbers(state, prod, an, procId);
  const ch = checks(state, an, procId);
  const bp = batchPlan(procId, pieces);
  const L = [];
  const fmt = v => (Math.round(v * 10) / 10).toString().replace('.', ',');

  L.push(`# Техкарта оснастки · ${state.name || 'изделие'}`);
  L.push('');
  L.push(`Процесс: ${n.proc.name}`);
  L.push(`Масса: ${n.mat.name} (${n.mat.vendor})`);
  L.push('');
  L.push('## Размеры');
  L.push(`- Модель оснастки (сырой размер): ${fmt(n.model.H)} × ⌀${fmt(n.model.D)} мм, стенка ${fmt(n.model.wall)} мм`);
  L.push(`- После обжига: ${fmt(n.fired.H)} × ⌀${fmt(n.fired.D)} мм`);
  L.push(`- Коэффициент усадки: ×${n.shrink.k.toFixed(4)} (полная усадка ${n.mat.shrinkPct} %)`);
  L.push(`- Линия разъёма: высота ${fmt(n.partingY)} мм, частей формы ${n.parts}`);
  L.push('');
  L.push('## Прессование');
  L.push(`- Проекционная площадь: ${fmt(n.projAreaMM2 / 100)} см²`);
  if (n.forceKN) {
    L.push(`- Давление на массу: ${n.proc.pressureMPa[0]}–${n.proc.pressureMPa[1]} МПа (${n.proc.pressureNote})`);
    L.push(`- Потребное усилие: ${fmt(n.forceKN[0])}–${fmt(n.forceKN[1])} кН, то есть ${fmt(n.forceTons[0])}–${fmt(n.forceTons[1])} тс`);
  } else {
    L.push(`- Давление: ${n.proc.pressureNote}`);
  }
  L.push(`- Масса изделия: ${Math.round(n.pieceG)} г`);
  L.push(`- Масса заготовки с облоем ${n.flashPct} %: ${Math.round(n.blankG)} г`);
  L.push('');
  L.push('## Технологичность');
  for (const c of ch) L.push(`- [${c.lvl === 'ok' ? 'ок' : c.lvl === 'warn' ? 'внимание' : 'стоп'}] ${c.txt}`);
  L.push('');
  /* Прилепы формуются отдельно: без этого раздела техкарта описывает не то
     изделие, которое видно на экране. */
  const parts = (state.parts || []);
  if (parts.length) {
    const prof = userProfileMM(state);
    L.push('## Прилепы');
    L.push(`- Деталей: ${parts.length} · ручной сборки ${partsHandMinutes(parts)} мин на изделие`);
    parts.forEach((p, i) => {
      const kind = partKind(p);
      const m = partMetrics(prof, p);
      if (p.kind === 'lip') {
        L.push(`- ${kind.name} ${i + 1}: поворот ${p.az}°, ширина ${p.width}°, отгиб ${fmt(p.out)} мм, кромка ниже на ${fmt(p.drop)} мм (отгибается, не приставляется)`);
        return;
      }
      const blk = partMouldBlock(prof, p, 20);
      const ft = partMouldFeatures(prof, p, 20);
      const pm = plasterMix(Math.max(blk.boxL - m.volMl / 2000 - ft.flashL, 0), wr);
      const geom = p.kind === 'spout'
        ? `корень на высоте ${fmt(p.at * 100)} % (${fmt(p.at * state.H)} мм), длина ${fmt(p.len)} мм, подъём ${p.rise}°, ⌀ ${fmt(p.bore)}→${fmt(p.tip)} мм`
        : `прилепы ${fmt(p.top * 100)} %–${fmt(p.bot * 100)} % высоты, вылет ${fmt(p.out)} мм, лента ${fmt(p.thick)}×${fmt(p.wide)} мм`;
      if (partSelfOverlap(prof, p)) {
        // деталь вошла сама в себя: канавка сворачивается в узел, формы нет
        L.push(`- ${kind.name} ${i + 1}: поворот ${p.az}°, ${geom}; глины ${Math.round(m.volMl * 1.92)} г` +
          `; форма не строится — деталь пересекает сама себя`);
        return;
      }
      L.push(`- ${kind.name} ${i + 1}: поворот ${p.az}°, ${geom}; глины ${Math.round(m.volMl * 1.92)} г` +
        `; форма из двух половин, блок ${blk.blockMM.map(v => Math.round(v)).join('×')} мм на половину, гипса ${fmt(pm.plasterKg)} кг на каждую` +
        `; замков ${ft.keys} (⌀${fmt(2 * 7)} мм, высота ${fmt(ft.keyH)} мм), облойная канавка ${fmt(ft.flashW)}×${fmt(ft.flashD)} мм в ${fmt(2)} мм от детали`);
      if (p.kind === 'spout') {
        const h = strainerHoles(p);
        L.push(`  - Ситечко: ${h.count} отв. ⌀${fmt(h.holeD)} мм, живое сечение ${Math.round(h.ratio * 100)} % от носика; режется по кожетвёрдому до прилепки носика`);
      }
    });
    L.push('');
  }

  L.push('## Тираж');
  L.push(`- Партия: ${pieces} шт`);
  if (bp.known) L.push(`- Ресурс формы ${bp.lo}–${bp.hi} циклов → комплектов оснастки: ${bp.setsLo}–${bp.setsHi}`);
  else L.push('- Ресурс оснастки для этого процесса не подтверждён источником — уточните у изготовителя форм');
  L.push('');
  const ec = economics(state, prod, procId, {...econOpt, batch: pieces});
  L.push('## Экономика партии');
  L.push(`- Ваши вводные: цикл ${ec.input.cycleSec} с, комплект оснастки ${Math.round(ec.input.toolingCostRub)} ₽, ставка ${ec.input.labourRubPerHour} ₽/ч, вручную ${ec.input.manualPerHour} шт/ч`);
  if (ec.perKg != null) L.push(`- Материал: ${Math.round(ec.perKg)} ₽/кг, заготовка ${ec.blankKg.toFixed(2)} кг, ${Math.round(ec.matMachine)} ₽ на изделие`);
  else L.push('- Материал: цена массы в реестре не указана');
  L.push(`- Машиной: ${Math.round(ec.machinePerPiece)} ₽/шт, ${Math.round(ec.machineTotal)} ₽ за партию, ${ec.machineHours.toFixed(1)} ч`);
  L.push(`- Руками: ${Math.round(ec.manualPerPiece)} ₽/шт, ${Math.round(ec.manualTotal)} ₽ за партию, ${ec.manualHours.toFixed(0)} ч`);
  L.push(`- Глины на партию: ${Math.round(ec.clayKgMachine)} кг`);
  if (ec.firePerPiece > 0)
    L.push(`- Обжиг: ${Math.round(ec.firePerPiece)} ₽/шт, ${Math.round(ec.fireTotal)} ₽ за партию (из садки печи, входит в обе строки выше)`);
  else L.push('- Обжиг: не посчитан — изделие не входит в выбранную печь или печь не выбрана');
  if (ec.cheaper === 'machine') L.push(`- На этом тираже оснастка выгоднее на ${Math.round(ec.manualTotal - ec.machineTotal)} ₽`);
  else if (ec.breakEven) L.push(`- Оснастка окупается начиная с ${ec.breakEven} шт`);
  else L.push('- На этих цифрах оснастка не окупается ни при каком тираже');
  L.push('');
  L.push('## Оснастка');
  L.push(`- Габарит матрицы: ⌀${fmt(stock.radiusMM * 2)} × ${fmt(stock.heightMM)} мм, тело формы ${fmt(stock.netLitres)} л`);
  L.push(`- Гипс: ${plaster.name} (${plaster.vendor}), ${plaster.strengthMPa} МПа, схватывание ${plaster.setMin.join('–')} мин`);
  L.push(`- Замес при В/Г ${wr}: ${fmt(mix.plasterKg)} кг гипса и ${fmt(mix.waterL)} л воды`);
  L.push(`- ${n.proc.tooling}`);
  L.push('');
  L.push('## Оговорки');
  L.push('- Расчёт для тел вращения. Ручки, носики и несимметричные элементы не учитываются.');
  L.push('- Расширение гипса при схватывании в коэффициент усадки не заложено — уточняйте по марке.');
  L.push('- Пороги уклона и толщины — умолчания инструмента, а не отраслевой норматив.');
  L.push('');
  L.push('Источники по процессу:');
  for (const s of n.proc.src) L.push(`- ${s.t}: ${s.u}`);
  return L.join('\n');
}
