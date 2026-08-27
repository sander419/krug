// Общая проверка соглашения о данных: est / unknown / na.
// Реестры разные, а правило одно — поэтому и проверка одна на всех.

export function checkContract(entry, fields, label, problems) {
  const lists = ['est', 'unknown', 'na'];
  for (const l of lists)
    if (!Array.isArray(entry[l])) problems.push(`${label}: поле ${l} должно быть массивом`);

  const seen = new Map();
  for (const l of lists)
    for (const f of entry[l] || []) {
      if (seen.has(f)) problems.push(`${label}: поле «${f}» помечено дважды — ${seen.get(f)} и ${l}`);
      seen.set(f, l);
      if (!fields.includes(f)) problems.push(`${label}: помечено несуществующее поле «${f}»`);
    }

  // пустое поле обязано быть объяснено, заполненное — не должно числиться пропущенным
  for (const f of fields) {
    const empty = entry[f] === null || entry[f] === undefined;
    const mark = seen.get(f);
    if (empty && !mark)
      problems.push(`${label}: поле «${f}» пустое и не объяснено — добавьте в unknown или na`);
    if (!empty && (mark === 'unknown' || mark === 'na'))
      problems.push(`${label}: поле «${f}» заполнено, но помечено как ${mark}`);
  }
}
