// file: js/core/economics.js
// Экономика тиража: что дешевле — оснастка или руки, и с какой партии.
// Все цифры, которые нельзя взять из паспорта (цикл, ставка, стоимость оснастки),
// вводит пользователь: это его производство, а не наша выдумка.
import { byId as materialById, density } from '../config/materials.js';
import { byId as processById, LIMITS } from '../config/processes.js';

export const ECON_DEFAULTS = {
  batch: 500,             // штук в партии
  cycleSec: 45,           // машинный цикл на изделие, с
  toolingCostRub: 60000,  // комплект оснастки
  labourRubPerHour: 600,  // ставка с накладными
  manualPerHour: 8,       // сколько изделий делает гончар на круге за час
  shiftHours: 8,
};

/* Цена массы за килограмм — из фасовки и цены-ориентира в реестре. */
export function pricePerKg(mat) {
  return mat.priceRub && mat.packKg ? mat.priceRub / mat.packKg : null;
}

/* Сколько комплектов оснастки нужно на партию: ресурс формы известен не у всех
   процессов, поэтому возвращаем диапазон или честное «неизвестно». */
function mouldSets(procId, pieces) {
  const proc = processById(procId);
  if (!proc.mouldLife) return {known: false, lo: 1, hi: 1};
  const [lifeLo, lifeHi] = proc.mouldLife;
  return {known: true, lo: Math.ceil(pieces / lifeHi), hi: Math.ceil(pieces / lifeLo)};
}

/* Полная себестоимость партии по двум путям и точка, где оснастка окупается. */
export function economics(state, prod, procId, opt = {}) {
  const e = {...ECON_DEFAULTS, ...opt};
  const mat = materialById(state.mat);
  const perKg = pricePerKg(mat);

  const blankKg = prod.massF * (1 + LIMITS.flashPct / 100) / 1000;   // прессование: изделие + облой
  const manualKg = prod.massN / 1000;                                 // круг: изделие + припуск на подрезку

  const matMachine = perKg == null ? null : blankKg * perKg;
  const matManual = perKg == null ? null : manualKg * perKg;

  const machineHoursPerPiece = e.cycleSec / 3600;
  const manualHoursPerPiece = 1 / Math.max(e.manualPerHour, 0.1);
  const labourMachine = machineHoursPerPiece * e.labourRubPerHour;
  const labourManual = manualHoursPerPiece * e.labourRubPerHour;

  const varMachine = (matMachine || 0) + labourMachine;
  const varManual = (matManual || 0) + labourManual;

  const totalFor = n => {
    const sets = mouldSets(procId, n);
    return {
      machine: e.toolingCostRub * sets.hi + varMachine * n,
      manual: varManual * n,
      sets,
    };
  };

  // точка безубыточности: первый тираж, где машинный путь дешевле ручного
  let breakEven = null;
  if (varManual > varMachine) {
    const step = Math.max(1, Math.round(e.batch / 200));
    for (let n = step; n <= 500000; n += step) {
      const t = totalFor(n);
      if (t.machine <= t.manual) { breakEven = n; break; }
    }
  }

  const at = totalFor(e.batch);
  const toolingTotal = e.toolingCostRub * at.sets.hi;
  return {
    toolingTotal,
    perKg, blankKg, manualKg,
    matMachine, matManual,
    labourMachine, labourManual,
    varMachine, varManual,
    sets: at.sets,
    machineTotal: at.machine, manualTotal: at.manual,
    machinePerPiece: at.machine / e.batch, manualPerPiece: at.manual / e.batch,
    machineHours: machineHoursPerPiece * e.batch,
    manualHours: manualHoursPerPiece * e.batch,
    shifts: machineHoursPerPiece * e.batch / Math.max(e.shiftHours, 1),
    clayKgMachine: blankKg * e.batch,
    clayKgManual: manualKg * e.batch,
    breakEven,
    cheaper: at.machine < at.manual ? 'machine' : 'manual',
    input: e,
  };
}
