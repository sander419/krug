// file: js/core/casting.js
// Литьё в гипсовую форму: расчёт под маленькую мастерскую, а не под завод.
//
// Завод считает циклы и съёмы в смену. Крафтовая мастерская упирается в другое:
// форма отдаёт воду медленнее, чем хочется, и вся дневная выработка определяется
// не руками, а тем, сколько отливок форма выдержит до сушки. Поэтому здесь три
// числа, которых нет в заводском расчёте:
//
//   1. сколько держать шликер, чтобы набралась заданная стенка;
//   2. сколько шликера уйдёт на отливку и сколько вернётся в ведро;
//   3. сколько отливок форма примет подряд и сколько форм нужно на дневной план.
//
// Всё, что зависит от конкретного шликера и гипса, вводится руками и служит
// калибровкой: набор стенки меряется один раз секундомером на своей форме,
// дальше расчёт идёт от этого замера. Выдуманных коэффициентов здесь нет.

/* Умолчания — типовые для гончарного шликера и формовочного гипса. Каждое
   можно и нужно заменить своим замером; в интерфейсе они все поля ввода. */
export const CAST_DEFAULTS = {
  slipDensity: 1.75,     // кг/л, плотность шликера
  solidsPct: 65,         // % твёрдого в шликере по массе
  calibMM: 3,            // на замере набралось столько миллиметров
  calibMin: 17,          // за столько минут
  greenMoisturePct: 20,  // влага в свежеснятом черепке, % к сухой массе
  plasterUptakePct: 30,  // сколько воды форма принимает, % к своей сухой массе
  dryHours: 24,          // сушка формы между сериями, ч
  sprueMM: 25,           // высота литника над кромкой
  wastePct: 5,           // потери шликера: плёнка на воронке и ведре
};

/**
 * Набор стенки идёт как корень из времени: гипс тянет воду через уже набранный
 * черепок, и каждый следующий миллиметр даётся дольше предыдущего. Коэффициент
 * берётся из замера мастера, а не из справочника.
 */
export function buildRate({calibMM, calibMin}) {
  const mm = Math.max(0.5, calibMM), min = Math.max(1, calibMin);
  return mm / Math.sqrt(min);          // мм за корень из минуты
}

/** Сколько минут держать шликер, чтобы набралось wallMM. */
export function holdMinutes(wallMM, opt) {
  const k = buildRate(opt);
  return Math.pow(Math.max(0.5, wallMM) / k, 2);
}

/** Толщина стенки через minutes минут — обратная задача, для таблицы выдержки. */
export function wallAfter(minutes, opt) {
  return buildRate(opt) * Math.sqrt(Math.max(0, minutes));
}

/**
 * Одна отливка: сколько шликера налить, сколько уйдёт в изделие, сколько вернётся.
 * @param dryG  сухая масса черепка (масса изделия после обжига без глазури)
 * @param cavityL объём полости формы: во что заливаем (внешний объём изделия + литник)
 */
export function slipPerCast(dryG, cavityL, opt) {
  const f = Math.max(0.3, Math.min(0.85, opt.solidsPct / 100));
  const dens = Math.max(1.2, opt.slipDensity);
  const wasteK = 1 + Math.max(0, opt.wastePct) / 100;

  const usedKg = (dryG / 1000) / f * wasteK;        // шликера ушло в черепок и потери
  const pourKg = cavityL * dens;                    // столько наливают в форму
  const backKg = Math.max(0, pourKg - usedKg);      // слили обратно в ведро

  /* Вода, которую форма забрала: вся вода ушедшего шликера минус та,
     что осталась в сыром черепке. Это и есть ресурс формы на одну отливку. */
  const waterKg = (dryG / 1000) * (1 / f - 1) - (dryG / 1000) * opt.greenMoisturePct / 100;
  return {usedKg, pourKg, backKg, waterKg: Math.max(0, waterKg), usedL: usedKg / dens};
}

/**
 * Сколько отливок форма примет подряд и сколько форм нужно на план.
 * @param plasterKg сухая масса гипсовой формы
 */
export function mouldCapacity(plasterKg, waterPerCastKg, opt, perDay) {
  const capacityKg = plasterKg * Math.max(5, opt.plasterUptakePct) / 100;
  const inRow = waterPerCastKg > 0 ? Math.floor(capacityKg / waterPerCastKg) : 0;
  /* Сутки — это серия подряд плюс сушка. Если сушка длиннее суток, за день
     форма успевает меньше одной серии, и форм нужно тем больше. */
  const cycleH = Math.max(1, opt.dryHours);
  const perMouldPerDay = inRow * (24 / cycleH);
  const need = perDay > 0 && perMouldPerDay > 0 ? Math.ceil(perDay / perMouldPerDay) : null;
  return {capacityKg, inRow, perMouldPerDay, mouldsNeeded: need};
}

/**
 * Полный расчёт литья для мастерской.
 * @param {object} a  {dryG, cavityL, wallMM, plasterKg, parts, perDay}
 */
export function castingPlan(a, opt = {}) {
  const o = {...CAST_DEFAULTS, ...opt};
  const hold = holdMinutes(a.wallMM, o);
  const slip = slipPerCast(a.dryG, a.cavityL, o);
  const cap = mouldCapacity(a.plasterKg, slip.waterKg, o, a.perDay || 0);

  /* Таблица выдержки: что успеет набраться к круглым отметкам времени.
     По ней мастер ставит таймер, а не считает корни. */
  const table = [5, 10, 15, 20, 30, 45, 60].map(m => ({min: m, mm: wallAfter(m, o)}));

  return {
    opt: o, hold, slip, cap, table,
    rateMMperSqrtMin: buildRate(o),
    parts: a.parts,
    sprueMM: o.sprueMM,
  };
}
