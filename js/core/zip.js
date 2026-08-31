// file: js/core/zip.js
// Минимальный писатель ZIP: пакет производства одним файлом.
//
// Мастеру нужно отдать в мастерскую не одну модель, а комплект: STL, чертёж,
// техкарту, рецепт. Восемь кнопок «скачать» — это восемь файлов в папке
// «Загрузки» вперемешку с чужими, и человек их потом ищет.
//
// Библиотеку ради этого не тянем: у КРУГа нет сборщика и ни одного внешнего
// запроса. Здесь ~90 строк на метод «store» — без сжатия. Архив выходит
// больше, чем мог бы, но открывается любым распаковщиком, а STL и SVG всё
// равно жмутся плохо: у первого сплошные числа, у второго текст, который
// человек читает глазами.
//
// Ни DOM, ни three: на входе имена и содержимое, на выходе Blob.

/* Таблица CRC32 строится один раз при первом обращении: 256 чисел, считать
   их на каждый файл незачем. */
let TABLE = null;
function table() {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    TABLE[i] = c >>> 0;
  }
  return TABLE;
}

export function crc32(bytes) {
  const t = table();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const enc = new TextEncoder();
const toBytes = data =>
  data instanceof Uint8Array ? data
  : data instanceof ArrayBuffer ? new Uint8Array(data)
  : enc.encode(String(data));

/* Дата и время в формате MS-DOS: ZIP старше UNIX-времени и хранит их так. */
function dosStamp(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return {time, date};
}

/**
 * Собрать ZIP без сжатия.
 * @param files [{name, data}] — data: строка, Uint8Array или ArrayBuffer
 * @returns Blob
 */
export function makeZip(files) {
  const {time, date} = dosStamp();
  const parts = [];       // куски архива по порядку
  const central = [];     // записи центрального каталога
  let offset = 0;

  for (const f of files) {
    if (!f || !f.name) continue;
    const name = enc.encode(f.name);
    const body = toBytes(f.data);
    const sum = crc32(body);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);      // сигнатура локальной записи
    lv.setUint16(4, 20, true);              // версия для распаковки
    lv.setUint16(6, 0x0800, true);          // флаг: имена в UTF-8
    lv.setUint16(8, 0, true);               // метод: store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, body.length, true);    // сжатый размер = исходному
    lv.setUint32(22, body.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);              // extra
    local.set(name, 30);

    parts.push(local, body);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);      // сигнатура записи каталога
    cv.setUint16(4, 20, true);              // версия создателя
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, sum, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, body.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);         // где лежит локальная запись
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + body.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);        // конец центрального каталога
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], {type: 'application/zip'});
}
