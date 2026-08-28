// file: tools/mobile-shot.mjs
// Снимок интерфейса в честной ширине телефона. Нужен потому, что проверять
// телефонную раскладку по десктопному окну нельзя: медиазапросы срабатывают
// не те, а «сломанной» выглядит вёрстка, которая на самом деле цела.
//
//   node tools/mobile-shot.mjs                       → out/mobile-390x844.png
//   node tools/mobile-shot.mjs --w 844 --h 390       → телефон боком
//   node tools/mobile-shot.mjs --url http://127.0.0.1:8466/ --out shot.png
//
// Перед запуском поднять сервер: python -m http.server 8466 --bind 127.0.0.1
// (конфиг «krug» в .claude/launch.json делает то же самое).
//
// Браузер ищется среди установленных на машине; свой ставить не нужно.
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const arg = (k, def) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const W = +arg('w', 390), H = +arg('h', 844);
const url = arg('url', 'http://127.0.0.1:8466/');
const out = arg('out', join('out', `mobile-${W}x${H}.png`));

/* chrome-headless-shell из playwright снимает WebGL надёжнее обычного Chrome;
   если его нет, годится любой Chrome или Edge. */
const CANDIDATES = [
  join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
  join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application'),
  'C:/Program Files/Google/Chrome/Application',
  'C:/Program Files (x86)/Microsoft/Edge/Application',
];
function findBrowser(){
  for(const dir of CANDIDATES){
    if(!dir || !existsSync(dir)) continue;
    for(const name of ['chrome-headless-shell.exe','chrome.exe','msedge.exe','headless_shell']){
      const hits = globSync(join(dir, '**', name).replace(/\\/g,'/'));
      if(hits.length) return hits[0];
    }
  }
  return null;
}
const bin = arg('bin', findBrowser());
if(!bin){
  console.error('Не найден Chrome / Edge / chrome-headless-shell. Указать вручную: --bin <путь к exe>');
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
const ud = mkdtempSync(join(tmpdir(), 'krug-shot-'));
const r = spawnSync(bin, [
  '--headless', '--disable-gpu', '--use-gl=swiftshader', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${ud}`, `--window-size=${W},${H}`,
  '--virtual-time-budget=9000', `--screenshot=${out}`, url,
], { encoding: 'utf8' });

if(!existsSync(out)){
  console.error('Снимок не записан. Сервер поднят? Ответ браузера:\n' + (r.stderr || '').slice(-600));
  process.exit(1);
}
console.log(`${out} — ${W}×${H}`);
