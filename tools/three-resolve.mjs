// Резолвер для Node: bare-спецификатор `three` ведёт в vendor, как в браузерном importmap.
// Нужен, чтобы ядро (математика, геометрия, оснастка) проверялось из командной строки,
// а не только в браузере. Подключается через tools/node-three.mjs.
import { pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = {
  'three': resolvePath(root, 'vendor/three/three.module.js'),
};

export function resolve(specifier, context, next) {
  if (MAP[specifier]) return {url: pathToFileURL(MAP[specifier]).href, shortCircuit: true};
  if (specifier.startsWith('three/addons/')) {
    const rest = specifier.slice('three/addons/'.length);
    return {url: pathToFileURL(resolvePath(root, 'vendor/three/addons', rest)).href, shortCircuit: true};
  }
  return next(specifier, context);
}
