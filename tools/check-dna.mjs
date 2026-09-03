// Проверка ДНК и отмены:
//   node --import ./tools/node-three.mjs tools/check-dna.mjs
//
// ДНК — это ссылка, которую отдают другому человеку, и автосохранение, которое
// возвращает работу себе. Поле, не уехавшее в неё, теряется молча: у получателя
// та же форма, но другие деньги, другой обжиг и другие замечания. Заметить это
// почти невозможно — числа-то правдоподобные.
//
// Отсюда три требования, и все три здесь проверяются:
//
//   1. **Рецепт доезжает целиком.** Каждое поле, которое человек правит,
//      обязано пережить «свернуть в ссылку → развернуть».
//   2. **Что уезжает в ссылку, то откатывается.** Список отмены и список ДНК
//      обязаны совпадать: иначе отмена вернёт форму, но оставит чужой этап
//      обжига. Такое уже случалось с прилепами.
//   3. **Старые ссылки открываются.** Выпущенные ДНК прежних версий обязаны
//      читаться — и не «примерно», а тем же изделием.
import { state, encodeDNA, applyDNA, withDNA, lastDNANotes } from '../js/core/state.js';
import { KEYS as HISTORY_KEYS } from '../js/core/history.js';
import { sanitizePart } from '../js/core/parts.js';
import { computeProduction } from '../js/core/math.js';

const problems = [];
const P = t => problems.push(t);
const j = v => JSON.stringify(v);

/* Рецепт, в котором ни одно поле не осталось умолчанием: иначе «доехало»
   и «совпало с умолчанием» неразличимы. */
const RICH = {
  name: 'Аудит ДНК',
  points: [{t: 0, r: 0.4}, {t: 0.5, r: 0.9}, {t: 1, r: 0.5}],
  H: 305, D: 145, segments: 96, rings: 0.9, hollow: true, wall: 7,
  footH: 9, footK: 71, allow: 27, mat: 'pg-75', firing: 'glaze',
  seed: 777, glazeId: 'celadon', glazeOwn: true,
  glaze: {al: 0.42, si: 5.1, ca: 0.55},
  pr: {printer: 2, nozzle: 3.2, lh: 1.4, feed: 1500, cart: 40, flow: 95, tau: 6},
  parts: [sanitizePart({kind: 'handle', az: 45}), sanitizePart({kind: 'spout', az: 200})],
  lid: {on: true, type: 'over', h: 33, wall: 6, seatH: 9, gap: 1.5,
        knobH: 12, knobD: 28, over: 8, pattern: false},
  pattern: {layers: [
    {id: 'brick', n: 15, depth: 1.8, twist: 0, m: 7, phase: 30, from: 0.2, to: 0.8, edge: 0.05, mute: false},
    {id: 'wave', n: 12, depth: 0.9, twist: 0, m: 3, phase: 0, from: 0, to: 1, edge: 0.08, mute: true}]},
  kiln: {id: 'own', kwh: 7.5, own: {w: 500, d: 500, h: 700, kw: 9}},
  plaster: {id: 'usg-1', wr: 68},
};

const before = {};
for (const [k, v] of Object.entries(RICH)) { state[k] = JSON.parse(j(v)); before[k] = JSON.parse(j(v)); }
const dna = encodeDNA();

/* ---------- рецепт доезжает целиком ---------- */
{
  /* Сбиваем состояние заведомо чужими числами: если поле не читается из ДНК,
     останется этот мусор, а не похожее на правду умолчание. */
  Object.assign(state, {
    name: 'сбито', H: 120, D: 90, segments: 24, rings: 0, hollow: false, wall: 3,
    footH: 0, footK: 30, allow: 5, mat: 'gzhel-red', firing: 'raw', seed: 1,
    glazeId: 'clear-gloss', glazeOwn: false, glaze: {al: 0.3, si: 3.6, ca: 0.7},
    pr: {printer: 0, nozzle: 4, lh: 2.4, feed: 1800, cart: 20, flow: 100, tau: 8},
    parts: [], lid: {on: false}, pattern: {layers: []},
    kiln: {id: 'studio-60', kwh: 6}, plaster: {id: 'gvvs-16', wr: 70},
    points: [{t: 0, r: 0.5}, {t: 1, r: 0.5}],
  });
  if (!applyDNA(dna)) P('своя же ДНК не применилась');
  for (const k of Object.keys(RICH)) {
    if (k === 'pattern' || k === 'lid') continue;         // их сверяем ниже, по смыслу
    if (j(state[k]) !== j(before[k]))
      P(`«${k}» не пережил ссылку: было ${j(before[k])}, стало ${j(state[k])}`);
  }
  /* Узор и крышка проходят через очистку, которая дописывает умолчания, —
     сверяем поля, которые человек задал, а не всю запись целиком. */
  const L = state.pattern.layers;
  if (L.length !== 2) P(`слоёв узора после ссылки ${L.length} вместо двух`);
  else {
    for (const f of ['id', 'n', 'depth', 'm', 'phase', 'from', 'to', 'edge', 'mute'])
      if (j(L[0][f]) !== j(before.pattern.layers[0][f]))
        P(`узор: «${f}» не пережил ссылку (${j(before.pattern.layers[0][f])} → ${j(L[0][f])})`);
    if (!L[1].mute) P('выключенный слой вернулся включённым');
  }
  for (const f of ['on', 'type', 'h', 'wall', 'seatH', 'gap', 'knobH', 'knobD', 'over', 'pattern'])
    if (j(state.lid[f]) !== j(before.lid[f]))
      P(`крышка: «${f}» не пережила ссылку (${j(before.lid[f])} → ${j(state.lid[f])})`);
}

/* ---------- что уезжает в ссылку, то откатывается ---------- */
/* Отмена хранит не весь state, а рецепт. Если поле ушло в ссылку, но забыто
   в списке отмены, откат вернёт форму и оставит чужой обжиг — и человек
   этого не заметит. */
{
  const inDNA = ['name', 'points', 'H', 'D', 'segments', 'rings', 'hollow', 'wall',
                 'footH', 'footK', 'allow', 'mat', 'firing', 'seed', 'pr', 'glaze',
                 'glazeId', 'glazeOwn', 'parts', 'lid', 'pattern', 'kiln', 'cast',
                 'cost', 'tune', 'plaster'];
  for (const k of inDNA)
    if (!HISTORY_KEYS.includes(k))
      P(`«${k}» уезжает в ссылку, но не откатывается отменой`);
  /* И обратно: в отмене не должно быть того, чего нет в рецепте, — иначе
     откатывается вид (этап «Кинотеатра», вращение круга), а это неожиданно. */
  for (const k of HISTORY_KEYS)
    if (!inDNA.includes(k) && k !== 'activePreset')
      P(`«${k}» откатывается отменой, но в рецепт не входит — вид откатывать не надо`);
}

/* ---------- старые ссылки открываются ---------- */
/* Каждая версия ДНК, которую мы когда-либо выпускали, обязана читаться. Числа
   сверяем те, что в ней были: «примерно та же ваза» здесь не годится. */
{
  const b64 = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const pts = [{t: 0, r: 0.45}, {t: 1, r: 0.6}];

  const v7 = b64({v: 7, name: 'Старая семь', mat: 'pg-75', pts, H: 240, D: 150, seg: 72,
                  ring: 0.4, hol: 1, wall: 6, fh: 5, fk: 60, al: 20, seed: 5,
                  pn: {id: 'weave', n: 14, depth: 2.5, twist: 60, m: 10}});
  if (!applyDNA(v7)) P('ссылка v7 не открылась');
  else {
    if (state.name !== 'Старая семь' || state.H !== 240) P('v7: имя или размеры прочитались не те');
    const l = state.pattern.layers[0] || {};
    if (l.id !== 'weave' || l.depth !== 2.5 || l.n !== 14 || l.twist !== 60)
      P(`v7: узор прочитался другим (${j(l)})`);
    if (state.firing !== 'raw') P('v7: обжиг взялся не по умолчанию');
  }

  const v6 = b64({v: 6, name: 'Старая шесть', mat: 'pg-75', pts, H: 200, D: 120, seg: 72,
                  ring: 0.3, hol: 1, wall: 5, fh: 4, fk: 60, al: 20, seed: 3,
                  pt: [{kind: 'handle', az: 90}]});
  if (!applyDNA(v6)) P('ссылка v6 не открылась');
  else {
    if (state.parts.length !== 1 || state.parts[0].kind !== 'handle') P('v6: прилеп не прочитался');
    if (state.pattern.layers.length) P('v6 узора не знала, а он появился');
  }

  const v5 = b64({v: 5, name: 'Старая пять', mat: 'pg-75', pts, H: 180, D: 130, seg: 72,
                  ring: 0.3, hol: 1, wall: 5, fh: 4, fk: 60, al: 20, seed: 2,
                  hd: {on: 1, out: 40}});
  if (!applyDNA(v5)) P('ссылка v5 не открылась');
  else if (state.parts.length !== 1) P('v5: одиночная ручка не превратилась в прилеп');

  /* Мусор не должен ронять приложение и не должен притворяться рецептом. */
  for (const junk of ['', 'не ДНК', b64({v: 99, pts}), b64({v: 8}), b64({v: 8, pts: [{t: 0, r: 1}]})])
    if (applyDNA(junk) !== false) P(`мусорная ДНК «${String(junk).slice(0, 12)}…» принята за рецепт`);
}

/* ---------- чужая ДНК не трогает текущую работу ---------- */
/* «Мои изделия» считают числа по каждой сохранённой работе тем же ядром,
   подменяя состояние на время расчёта. Не вернуть его назад — значит подменить
   человеку то, что у него сейчас на экране. */
{
  for (const [k, v] of Object.entries(RICH)) state[k] = JSON.parse(j(v));
  const snap = j(state);
  /* Чужая ДНК обязана быть именно чужой: если считать по своей же, подмена
     состояния и его возврат неразличимы — проверка станет слепой. */
  state.name = 'соседняя'; state.H = 150; state.wall = 4;
  const alien = encodeDNA();
  for (const [k, v] of Object.entries(RICH)) state[k] = JSON.parse(j(v));
  const other = withDNA(alien, s => computeProduction(s).massF);
  if (!(other > 0)) P('по чужой ДНК ничего не посчиталось');
  if (j(state) !== snap) P('после расчёта по чужой ДНК состояние не вернулось на место');
  /* И на битой ДНК — тоже: ранний выход не должен оставлять чужой рецепт. */
  if (withDNA('мусор', () => 1) !== null) P('битая ДНК притворилась рабочей');
  if (j(state) !== snap) P('битая ДНК оставила состояние сбитым');
}

/* ---------- повреждённая ссылка не чинится молча ---------- */
/* Ссылка приходит от другого человека или из старой переписки, и в ней бывает
   мусор: высота в километр, отрицательная стенка, неизвестная масса. Привести
   такое к пределам и промолчать — значит показать человеку **другое изделие**
   под тем же именем, и заметить он этого не сможет. */
{
  const b64 = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const pts = [{t: 0, r: 0.45}, {t: 1, r: 0.6}];

  applyDNA(b64({v: 8, pts, H: 220, D: 160, wall: 5, mat: 'gzhel-red'}));
  if (lastDNANotes().length) P(`цельная ссылка вызвала правки: ${lastDNANotes()[0]}`);

  const broken = b64({v: 8, pts, H: 99999, D: -5, wall: 0.1, mat: 'нет-такой',
                      gid: 'нет-такой', pt: new Array(20).fill({kind: 'handle', az: 0})});
  if (!applyDNA(broken)) P('битую ссылку не открыли вовсе — форма в ней всё-таки есть');
  const notes = lastDNANotes();
  for (const [what, re] of [['высоту', /высот/i], ['диаметр', /диаметр/i], ['стенку', /стенк/i],
                            ['массу', /масс/i], ['глазурь', /глазур/i], ['прилепы', /прилеп/i]])
    if (!notes.some(n => re.test(n))) P(`ссылка испортила ${what}, а инструмент об этом молчит`);
  for (const n of notes) {
    if (n.length < 20) P(`сообщение о правке «${n}» ничего не объясняет`);
    /* В сообщении обязано быть и то, что пришло, и то, что допустимо: иначе
       человек не поймёт, чинить ли ему ссылку или инструмент. */
    if (/допустимо/.test(n) && !/\d/.test(n)) P(`в сообщении «${n}» нет чисел`);
  }
  /* Числа при этом всё равно приведены к пределам: показывать заведомо
     невозможное изделие тоже нельзя. */
  if (!(state.H >= 50 && state.H <= 400)) P(`после битой ссылки высота ${state.H}`);
  if (!(state.wall >= 2 && state.wall <= 12)) P(`после битой ссылки стенка ${state.wall}`);
  if (state.parts.length > 8) P(`после битой ссылки прилепов ${state.parts.length}`);
  /* И список правок не тянется в следующую ссылку. */
  applyDNA(b64({v: 8, pts, H: 200, D: 150, wall: 5, mat: 'gzhel-red'}));
  if (lastDNANotes().length) P('правки от прошлой ссылки остались в списке');
}


console.log('\nПроверка ДНК и отмены');
console.log(`  полей рецепта: ${Object.keys(RICH).length + 3} · длина ссылки: ${dna.length} знаков`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const t of problems) console.log('  ✗ ' + t);
  process.exit(1);
}
console.log('\nРецепт доезжает целиком, откатывается целиком, старые ссылки открываются.');
