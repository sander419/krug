// Подключает резолвер three для Node: node --import ./tools/node-three.mjs <скрипт>
import { register } from 'node:module';
register('./three-resolve.mjs', import.meta.url);
