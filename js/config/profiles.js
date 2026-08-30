// file: js/config/profiles.js
// Кто перед инструментом: мастер или мастерская.
//
// Ядро одно. Профиль не меняет ни одной формулы — он решает, **какие задачи
// показать на входе** и **насколько подробно** говорить. Мастеру, который лепит
// свою вазу, незачем видеть усилие пресса и точку безубыточности; мастерской,
// которая считает тираж, они и есть работа.
//
// Профиль — настройка рабочего места, а не свойство изделия: в ДНК он не входит,
// и ссылка открывается в профиле того, кто по ней пришёл.
//
// `simple: true` включает простой вид: блоки и метрики с пометкой `data-adv`
// прячутся, пока человек не нажмёт «Расширенный режим». Ничего не удаляется —
// расширенный режим возвращает всё на место.

export const PROFILES = [
  {id: 'master', name: 'Я мастер', ico: 'circle-dot', simple: true,
   lead: 'Проектирую и создаю свои изделия.',
   about: 'Форма, материал, проверка, производство одного изделия и маленькой серии.',
   routes: ['wheel', 'print', 'parts', 'castmould', 'cost', 'prep'],
   home: 'wheel'},

  {id: 'studio', name: 'У меня мастерская', ico: 'factory', simple: false,
   lead: 'Производство, печи, материалы, формы и тиражи.',
   about: 'Проекты, оснастка, садка печи, тираж и себестоимость.',
   routes: ['prod', 'batch', 'mould', 'castmould', 'kiln'],
   home: 'prod'},

  {id: 'all', name: 'Показать всё', ico: 'sliders-horizontal', simple: false,
   lead: 'Не уверен — показать всё.',
   about: 'Все задачи и все вкладки, ничего не спрятано.',
   routes: ['wheel', 'print', 'parts', 'castmould', 'cost', 'prep',
            'prod', 'batch', 'mould', 'kiln', 'all'],
   home: 'all'},
];

export const DEFAULT_PROFILE = 'master';

export const profileById = id => PROFILES.find(p => p.id === id) || null;

/** Задачи профиля в порядке реестра задач. */
export function profileRoutes(profile, routes) {
  return routes.filter(r => profile.routes.includes(r.id));
}
