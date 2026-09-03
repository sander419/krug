// Проверка самих проверок: node tools/check-checks.mjs
//
// Проверка врёт двумя способами, и оба однажды случились здесь.
//
//   1. **Находит и молчит.** У проверки геометрии не было отчёта: ошибки
//      копились в массив, но не печатались и не роняли процесс. `check-all`
//      видел ноль на выходе и рисовал ✓ — и так эта проверка молчала обо всём,
//      что находила, включая два образца, которые вообще не проверялись.
//   2. **Её никто не запускает.** Файл проверки, не вписанный в `check-all`,
//      не существует: команда «все проверки одной строкой» его не позовёт,
//      а руками по одному их никто не гоняет.
//
// Здесь ловятся оба случая. Это не мутационное тестирование и не замена
// зубам, которые проверяются поломкой кода руками, — это минимум, ниже
// которого проверка перестаёт быть проверкой.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const problems = [];
const P = t => problems.push(t);

/* Файлы, которые не проверки, а инструменты: резолверы, снимок телефона,
   общий контракт реестров и сам запускатель. */
const NOT_CHECKS = new Set(['check-all.mjs', 'check-checks.mjs']);

const files = readdirSync(here).filter(f => f.startsWith('check-') && f.endsWith('.mjs'));
const listed = readFileSync(join(here, 'check-all.mjs'), 'utf8');

let counted = 0;
for (const f of files) {
  if (NOT_CHECKS.has(f)) continue;
  const raw = readFileSync(join(here, f), 'utf8');
  /* Закомментированный отчёт — это отсутствующий отчёт. Первая версия этой
     проверки принимала «// process.exit(1)» за отчёт: зуб не сработал.
     Поэтому строки-комментарии выбрасываются перед разбором. */
  const src = raw.split(/\r?\n/)
    .filter(l => !/^\s*\/\//.test(l)).join('\n');
  counted++;

  /* Проверка обязана собирать находки — иначе она печатает отчёт о ничём. */
  const collects = /problems\.push|const P\s*=/.test(src);
  if (!collects) { P(`${f}: не собирает находки — что она проверяет?`); continue; }

  /* И обязана о них говорить: печатать и падать. Молчаливая проверка хуже
     отсутствующей — она создаёт уверенность там, где её нет. */
  if (!/process\.exit\(1\)/.test(src))
    P(`${f}: находит, но не роняет процесс — check-all посчитает её пройденной`);
  if (!/ОШИБКИ|✗/.test(src))
    P(`${f}: не печатает найденное — узнать, что именно сломано, будет неоткуда`);
  if (!/problems\.length/.test(src))
    P(`${f}: отчёт не смотрит на список находок`);

  /* Помощник, которого нет. Вызов необъявленной функции валит скрипт
     ReferenceError'ом — но только в той ветке, где находка. Снаружи это
     выглядит как «проверка молчит»: ошибок нет, потому что до них не дошло.
     Так однажды и было: блок звал P(), которого в этом файле не существует. */
  const usesP = /(?<![\w.])P\(/.test(src);
  const hasP = /(?:const|let|var|function)\s+P[\s(=]/.test(src);
  if (usesP && !hasP)
    P(`${f}: зовёт помощник P(), которого в файле нет — упадёт с ReferenceError вместо отчёта`);

  /* Проверка, которую не запускает check-all, не запускается никогда. */
  if (!listed.includes(f)) P(`${f}: не вписана в check-all — её никто не позовёт`);
}

/* И наоборот: строка в check-all, за которой нет файла, — это ✓ из воздуха. */
for (const m of listed.matchAll(/'(check-[\w-]+\.mjs)'/g)) {
  const name = m[1];
  if (!files.includes(name)) P(`check-all зовёт «${name}», которого нет`);
}

if (counted < 20) P(`проверок нашлось всего ${counted} — похоже, искали не там`);

console.log('\nПроверка проверок');
console.log(`  файлов проверок: ${counted}, все вписаны в check-all`);
if (problems.length) {
  console.log('\nОШИБКИ:');
  for (const t of problems) console.log('  ✗ ' + t);
  process.exit(1);
}
console.log('\nКаждая проверка собирает находки, печатает их и роняет процесс.');
