// file: js/config/data.js
// Доменные справочники. Никакой логики — только данные.

export const PRESETS = [
  { ico:'☕', name:'Чашка',   pts:[{t:0,r:.80},{t:.06,r:.86},{t:.35,r:.90},{t:.7,r:.95},{t:1,r:1}] },
  { ico:'🏺', name:'Ваза',    pts:[{t:0,r:.55},{t:.12,r:.82},{t:.35,r:1},{t:.6,r:.84},{t:.78,r:.5},{t:.9,r:.44},{t:1,r:.52}] },
  { ico:'🥣', name:'Миска',   pts:[{t:0,r:.38},{t:.15,r:.72},{t:.5,r:.96},{t:.8,r:1},{t:1,r:.98}] },
  { ico:'🍽️', name:'Тарелка', pts:[{t:0,r:.5},{t:.2,r:.78},{t:.45,r:.96},{t:.75,r:1},{t:1,r:.92}] },
  { ico:'⚱️', name:'Кувшин',  pts:[{t:0,r:.58},{t:.14,r:.85},{t:.42,r:1},{t:.68,r:.62},{t:.85,r:.44},{t:1,r:.55}] },
  { ico:'🫙', name:'Банка',   pts:[{t:0,r:.74},{t:.1,r:.9},{t:.45,r:1},{t:.78,r:.9},{t:.92,r:.7},{t:1,r:.72}] },
];

// shrink — полная усадка обжига, %; density — плотность сырой массы, г/см³;
// cte — коэффициент теплового расширения черепка, ×10⁻⁶/°C
export const CLAYS = [
  {name:'Красная глина',    raw:0xb4643c, bisque:0xc9825b, glaze:0xa9c4b1, shrink:11, density:1.9, cte:6.8},
  {name:'Шамотистая глина', raw:0x9c8570, bisque:0xb3a08c, glaze:0x6f8fae, shrink:12, density:2.0, cte:5.6},
  {name:'Фарфор',           raw:0xe6ddd0, bisque:0xf0e9dd, glaze:0xdfe6ea, shrink:14, density:1.9, cte:6.2},
  {name:'Тёмная масса',     raw:0x4a3830, bisque:0x5a463c, glaze:0x3a5a8c, shrink:11, density:2.0, cte:5.8},
];

// bed — рабочая камера [ширина, глубина, высота], мм
export const PRINTERS = [
  {name:'3D PotterBot Micro 10', nozzle:3.0, lh:1.6, feed:1200, cart:48, bed:[152,152,254],  note:'Поршневой экструдер (ram) · жёсткая глина · сопла 1–10 мм'},
  {name:'Delta WASP 40100 LDM',  nozzle:4.0, lh:2.4, feed:1800, cart:20, bed:[400,400,1000], note:'Шнек + пневмоподача · влажная паста · непрерывная подача'},
  {name:'Vormvrij Lutum 4M',     nozzle:0.8, lh:0.4, feed:900,  cart:25, bed:[300,300,400],  note:'Стальной шнек V10 · шамот до 25% · разрешение 0.2 мм'},
];

export const STAGES = ['Комок глины','Центровка','Вскрытие','Вытяжка стенок','Формовка профиля','Подрезка ножки','Готовое изделие'];
