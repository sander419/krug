// Проверка пакета производства:
//   node tools/check-zip.mjs
//
// ZIP собирается своими руками, без библиотеки: у КРУГа нет сборщика и ни
// одного внешнего запроса. Цена этому — байты, которые надо разложить самому,
// и ошибка в них не видна: браузер скачает файл, а распаковщик скажет «архив
// повреждён» уже у мастера. Поэтому архив читается обратно и сверяется:
// сигнатуры, размеры, CRC каждого файла и центральный каталог.
import { makeZip, crc32 } from '../js/core/zip.js';

const problems = [];
const P = t => problems.push(t);
const enc = new TextEncoder();

const files = [
  {name: 'model.stl', data: new Uint8Array(1024).fill(7)},
  {name: 'recipe.json', data: '{"имя":"Ваза","масса":838}'},
  {name: 'mould/ware-1a.stl', data: 'solid test\nendsolid test\n'},
  {name: 'README.txt', data: 'КРУГ — пакет производства\nРазмеры сырые.\n'},
];

const blob = await makeZip(files).arrayBuffer();
const bytes = new Uint8Array(blob);
const dv = new DataView(blob);
const u16 = o => dv.getUint16(o, true);
const u32 = o => dv.getUint32(o, true);

/* ---------- конец центрального каталога ---------- */
let end = -1;
for (let i = bytes.length - 22; i >= 0; i--) if (u32(i) === 0x06054b50) { end = i; break; }
if (end < 0) P('в архиве нет записи «конец центрального каталога» — файл не откроется');
else {
  if (u16(end + 8) !== files.length) P(`в каталоге ${u16(end + 8)} записей вместо ${files.length}`);
  if (u16(end + 10) !== files.length) P('число записей на диске и всего не совпадает');
}

/* ---------- локальные записи и CRC ---------- */
{
  let off = 0, seen = 0;
  const dec = new TextDecoder();
  for (const f of files) {
    if (u32(off) !== 0x04034b50) { P(`запись «${f.name}»: нет сигнатуры локального заголовка`); break; }
    const flags = u16(off + 6);
    if (!(flags & 0x0800)) P(`запись «${f.name}»: не помечена UTF-8 — кириллица в имени станет мусором`);
    if (u16(off + 8) !== 0) P(`запись «${f.name}»: метод сжатия не «store»`);
    const nameLen = u16(off + 26), extraLen = u16(off + 28);
    const name = dec.decode(bytes.slice(off + 30, off + 30 + nameLen));
    if (name !== f.name) P(`имя в архиве «${name}» вместо «${f.name}»`);
    const size = u32(off + 22);
    const body = bytes.slice(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + size);
    const want = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
    if (size !== want.length) P(`«${f.name}»: размер ${size} вместо ${want.length}`);
    if (u32(off + 14) !== crc32(want)) P(`«${f.name}»: CRC не сходится — распаковщик отвергнет файл`);
    if (String(body) !== String(want)) P(`«${f.name}»: содержимое в архиве не то, что клали`);
    off += 30 + nameLen + extraLen + size;
    seen++;
  }
  if (seen !== files.length) P(`прочитано ${seen} записей из ${files.length}`);

  /* Смещение каталога обязано указывать ровно за последний файл: по нему
     распаковщик и находит оглавление. */
  if (end >= 0 && u32(end + 16) !== off) P(`смещение каталога ${u32(end + 16)} не совпадает с концом данных ${off}`);
}

/* ---------- центральный каталог ---------- */
if (end >= 0) {
  let off = u32(end + 16), n = 0;
  while (off < end && u32(off) === 0x02014b50) {
    const nameLen = u16(off + 28), extraLen = u16(off + 30), commLen = u16(off + 32);
    off += 46 + nameLen + extraLen + commLen;
    n++;
  }
  if (n !== files.length) P(`в каталоге читается ${n} записей вместо ${files.length}`);
  if (off !== end) P('каталог не кончается там, где начинается его конец');
}

/* ---------- вырожденные случаи ---------- */
if ((await makeZip([]).arrayBuffer()).byteLength !== 22) P('пустой архив должен состоять из одной записи конца');
if (crc32(enc.encode('123456789')) !== 0xCBF43926) P('CRC32 считается неверно (эталон «123456789»)');

console.log('Проверка пакета производства\n');
console.log(`  ${files.length} файла, ${bytes.length} байт · CRC и каталог сходятся`);

if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\nАрхив собирается по формату: распаковщик его прочитает.');
