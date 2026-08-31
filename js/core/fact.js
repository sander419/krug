// file: js/core/fact.js
// Фактический результат: что вышло на самом деле.
//
// Расчёт — это обещание. Изделие сохнет, садится и обжигается по-своему,
// и разница между обещанием и фактом — самое ценное, что мастер может
// накопить: по ней он поправит усадку, брак, минуты и расход глазури
// под свою мастерскую.
//
// Два правила, из которых следует остальное:
//
//   • **Факт не меняет рецепт.** Записали 438 г вместо расчётных 420 — модель
//     осталась прежней. Иначе следующий расчёт пойдёт от подогнанного числа,
//     и сравнивать станет не с чем.
//   • **Факт живёт в записи работы, а не в ДНК.** Ссылку отдают другому
//     человеку; его печь и его руки дадут свои числа.
//
// Здесь только арифметика отклонений. Ни DOM, ни хранилища.

/** Что меряют после обжига. `calc` берёт расчётное значение из числа изделия. */
export const FACT_FIELDS = [
  {k: 'H',        name: 'Высота',            unit: 'мм',  step: 1,    dec: 0},
  {k: 'D',        name: 'Диаметр',           unit: 'мм',  step: 1,    dec: 0},
  {k: 'massG',    name: 'Масса',             unit: 'г',   step: 1,    dec: 0},
  {k: 'shrinkPct', name: 'Усадка',           unit: '%',   step: 0.1,  dec: 1},
  {k: 'glazeG',   name: 'Расход глазури',    unit: 'г',   step: 1,    dec: 0},
  {k: 'workMin',  name: 'Время работы',      unit: 'мин', step: 1,    dec: 0},
  {k: 'fireH',    name: 'Время обжига',      unit: 'ч',   step: 0.5,  dec: 1},
  {k: 'lossPcs',  name: 'Брак',              unit: 'шт',  step: 1,    dec: 0},
];

const LIMITS = {
  H: [1, 3000], D: [1, 3000], massG: [1, 200000], shrinkPct: [0, 40],
  glazeG: [0, 100000], workMin: [0, 100000], fireH: [0, 500], lossPcs: [0, 100000],
};

/** Очистка: пустое остаётся пустым — «не мерил» это не ноль. */
export function sanitizeFact(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const f of FACT_FIELDS) {
    const v = src[f.k];
    if (v === null || v === undefined || v === '') continue;
    const n = +v;
    if (!Number.isFinite(n)) continue;
    const [lo, hi] = LIMITS[f.k];
    out[f.k] = Math.min(hi, Math.max(lo, n));
  }
  if (typeof src.lossWhy === 'string') out.lossWhy = src.lossWhy.slice(0, 400);
  if (typeof src.note === 'string') out.note = src.note.slice(0, 2000);
  return out;
}

/** Есть ли хоть один замер: по этому решается, начат ли контроль. */
export const hasFact = fact =>
  FACT_FIELDS.some(f => fact && fact[f.k] !== undefined);

/**
 * Сопоставление расчёта и факта.
 * @param calc {H, D, massG, shrinkPct, glazeG, workMin, fireH}
 * @returns [{k, name, unit, dec, calc, fact, delta, pct}] — только там, где есть замер
 */
export function compareFact(calc, fact) {
  const f = sanitizeFact(fact);
  const rows = [];
  for (const fld of FACT_FIELDS) {
    if (f[fld.k] === undefined) continue;
    const c = calc && Number.isFinite(+calc[fld.k]) ? +calc[fld.k] : null;
    const v = f[fld.k];
    rows.push({
      ...fld, calc: c, fact: v,
      delta: c == null ? null : v - c,
      /* Процент считаем от расчёта: вопрос всегда «насколько промахнулись
         относительно обещанного», а не «какую долю факт составил». */
      pct: c ? (v - c) / c * 100 : null,
    });
  }
  return rows;
}

/** Насколько отклонение существенно. Пороги — здравый смысл, не норматив. */
export function factLevel(row) {
  /* Брак сравнивать не с чем: расчёт его не обещает. Любой ненулевой брак —
     это замечание сам по себе. Поэтому проверяется раньше процента. */
  if (row.k === 'lossPcs') return row.fact > 0 ? 'warn' : 'ok';
  if (row.pct == null) return 'none';
  const a = Math.abs(row.pct);
  if (a <= 3) return 'ok';
  if (a <= 10) return 'warn';
  return 'bad';
}
