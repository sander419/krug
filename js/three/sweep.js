// file: js/three/sweep.js
// Протяжка эллиптического сечения по кривой с переменной толщиной. TubeGeometry
// из three умеет только круг постоянного радиуса: у ручки сечение — лента
// (поперёк шире, по радиусу тоньше), у носика — конус от корня к срезу.
//
// Торцы закрываются: ручка обоими прилепами уходит в стенку, но выгрузка должна
// быть замкнутой — открытая труба в STL это дыра, на которой спотыкается слайсер.
import * as THREE from 'three';

/**
 * @param curve   THREE.Curve
 * @param sec     {rAt(t) -> полутолщина, ratio: ширина/толщина}
 * @param tubular число шагов вдоль кривой
 * @param radial  число сегментов сечения
 */
export function sweepGeometry(curve, sec, tubular = 56, radial = 14) {
  const frames = curve.computeFrenetFrames(tubular, false);
  const rows = tubular + 1, cols = radial + 1;
  const vCount = rows * cols + 2;                       // +2 центра торцов
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = [];

  const P = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  const v = new THREE.Vector3(), n = new THREE.Vector3();

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    N.copy(frames.normals[i]); B.copy(frames.binormals[i]);
    const r = sec.rAt(t), k = sec.ratio;
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      v.copy(P).addScaledVector(N, r * ca).addScaledVector(B, r * k * sa);
      // нормаль эллипса: полуоси меняются местами
      n.set(0, 0, 0).addScaledVector(N, k * ca).addScaledVector(B, sa).normalize();
      const o = (i * cols + j) * 3;
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z;
      uv[(i * cols + j) * 2] = t;
      uv[(i * cols + j) * 2 + 1] = j / radial;
    }
  }
  for (let i = 0; i < tubular; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j, b = a + cols, c = b + 1, d = a + 1;
      idx.push(a, b, d, b, c, d);
    }

  /* торцы: веер от центра сечения */
  const capCenter = (i, vi, dir) => {
    curve.getPointAt(i / tubular, P);
    const o = vi * 3;
    pos[o] = P.x; pos[o + 1] = P.y; pos[o + 2] = P.z;
    const tan = curve.getTangentAt(i / tubular).multiplyScalar(dir);
    nor[o] = tan.x; nor[o + 1] = tan.y; nor[o + 2] = tan.z;
  };
  const startC = rows * cols, endC = startC + 1;
  capCenter(0, startC, -1);
  capCenter(tubular, endC, 1);
  for (let j = 0; j < radial; j++) {
    idx.push(startC, j + 1, j);                               // низ
    const base = tubular * cols;
    idx.push(endC, base + j, base + j + 1);                    // верх
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1)
                              : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}
