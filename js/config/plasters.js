// file: js/config/plasters.js
// Гипс для оснастки. Правило то же, что у масс и процессов: число — из паспорта
// поставщика со ссылкой; чего не публикуют — null и пометка, а не выдумка.
// Водогипсовое отношение российские поставщики обычно не печатают: его подбирают
// под задачу, поэтому в интерфейсе оно вводится руками.
// Проверка: node tools/check-plasters.mjs

export const PLASTERS_SCHEMA = 1;

/* Абсолютная плотность гипсового вяжущего. Нужна, чтобы из объёма формы получить
   массу сухого гипса: объём замеса = объём порошка + объём воды. */
export const PLASTER_SOLID_DENSITY = 2.64;   // г/см³

const SRC = {
  gvvs: {t: 'ОМА — гипс высокопрочный ГВВС-16', u: 'https://spb.oma-polymer.com/gips-vysokoprochnyj-gvvs-16/'},
  pesh: {t: 'Портал керамики — гипс Пешеланский формовочный Г-5, S-4866', u: 'https://portalkeramiki.ru/catalog/143/145/S-4866/'},
  usg:  {t: 'USG — No. 1 Pottery Plaster, submittal sheet', u: 'https://www.usg.com/content/dam/USG_Marketing_Communications/united_states/product_promotional_materials/finished_assets/usg-no1-pottery-plaster-data-en-IG1366.pdf'},
  gost: {t: 'ГОСТ 125-2018 «Вяжущие гипсовые. Технические условия»', u: 'https://allgosts.ru/91/100/gost_125-2018'},
  samara: {t: 'Самарагипс — гипс формовочный', u: 'https://samaragips.ru/catalog/gips-dlya-proizvoditeley-sanitarno-stroitelnykh-izdeliy/gips-formovochnyi/'},
};

export const PLASTERS = [
  {
    id: 'gvvs-16',
    name: 'ГВВС-16',
    vendor: 'ОМА',
    grade: 'высокопрочный, Г-16 по прочности',
    strengthMPa: 16,
    strengthNote: 'при сжатии в возрасте 2 часов; на изгиб 6 МПа',
    setMin: [4.5, 20],
    setNote: 'начало не ранее 4,5 мин, конец не позднее 20 мин',
    waterRatio: null,               // В/Г не публикуют — подбирается
    pack: 'мешок 40 кг', packKg: 40, priceRub: 1460,
    use: 'Рабочие формы, модели и капы в фарфоро-фаянсовой и керамической промышленности',
    note: 'Прочный и мелко смолотый: остаток на сите 0,2 мм не более 1 %. Держит много съёмов, но пористость ниже, чем у мягких формовочных гипсов.',
    est: [], na: [],
    unknown: ['waterRatio'],
    src: [SRC.gvvs, SRC.gost],
  },
  {
    id: 'peshelan-g5',
    name: 'Пешеланский формовочный Г-5',
    vendor: 'Портал керамики',
    grade: 'формовочный, Г-5 по прочности',
    strengthMPa: 6,
    strengthNote: 'предел прочности при сжатии не менее 6 МПа',
    setMin: [5, 9],
    setNote: 'начало 5 мин, конец 9 мин — работать быстро',
    waterRatio: null,
    pack: 'ведро 5 кг / мешок 30 кг', packKg: 30, priceRub: 820,
    use: 'Пористые формы, небольшие модели',
    note: 'Мягкий пористый гипс: водопоглощение 38 %, форма быстрее тянет воду из шликера, но и садится быстрее. Схватывается за девять минут — замес готовят заранее.',
    est: [], na: [],
    unknown: ['waterRatio'],
    src: [SRC.pesh],
  },
  {
    id: 'usg-pottery-1',
    name: 'USG No. 1 Pottery Plaster',
    vendor: 'USG',
    grade: 'модельно-формовочный, отраслевой стандарт',
    strengthMPa: 16.5,
    strengthNote: 'сухая прочность на сжатие 2400 psi',
    setMin: [14, 24],
    setNote: 'по Вика при машинном замесе; горячая вода сокращает срок',
    waterRatio: 70,
    waterRatioNote: '70 частей воды на 100 частей гипса по массе — паспортная консистенция',
    pack: 'мешок 22,7 кг (50 lb)', packKg: 22.7, priceRub: null,
    use: 'Формы для шликерного литья и роликового формования: санфаянс, посуда',
    note: 'Единственный в списке, у кого водогипсовое отношение опубликовано. От него и пляшут, когда подбирают замес для отечественных марок.',
    est: [], na: [],
    unknown: ['priceRub'],
    src: [SRC.usg],
  },
];

export const byId = id => PLASTERS.find(p => p.id === id) || PLASTERS[0];
export const SAMARA_SRC = SRC.samara;

/* Замес по объёму формы. Объём смеси = объём порошка + объём воды, поэтому
   масса сухого гипса = V / (1/ρ + В/Г). Усадка и расширение при схватывании
   в расчёт не заложены — это доли процента. */
export function plasterMix(litres, waterRatio) {
  const w = waterRatio / 100;
  if (!(litres > 0) || !(w > 0)) return null;
  const cm3 = litres * 1000;
  const plasterG = cm3 / (1 / PLASTER_SOLID_DENSITY + w);
  return {
    plasterKg: plasterG / 1000,
    waterKg: plasterG * w / 1000,
    waterL: plasterG * w / 1000,          // 1 кг воды = 1 л
    slurryDensity: (plasterG * (1 + w)) / cm3,
  };
}
