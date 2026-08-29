// file: js/three/dome.js
// Купол окружения: сфера наизнанку с вертикальным градиентом. Дешевле карты
// окружения (файлов у проекта нет принципиально) и честнее CSS-подложки —
// градиент попадает и в снимок, и во встраиваемую витрину, а не только на экран.
//
// Туман на купол не действует: иначе дальняя стенка размывается сама в себя
// и горизонт исчезает.
import * as THREE from 'three';

const VERT = /* glsl */`
  varying float vY;
  void main(){
    vec4 world = modelMatrix * vec4(position, 1.0);
    vY = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uSky, uGround;
  uniform float uSpan;
  varying float vY;
  void main(){
    float t = smoothstep(-uSpan * 0.35, uSpan * 0.75, vY);
    gl_FragColor = vec4(mix(uGround, uSky, t), 1.0);
    #include <colorspace_fragment>
  }
`;

export function createDome(radius = 3000) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSky: {value: new THREE.Color(0x2b211a)},
      uGround: {value: new THREE.Color(0x120e0b)},
      uSpan: {value: radius},
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    // купол не участвует в глубине вовсе: иначе дальняя плоскость камеры режет
    // его полигоны и за моделью появляются чёрные многоугольники
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.renderOrder = -1000;      // рисуется первым, ни с чем не спорит по глубине
  mesh.frustumCulled = false;
  mesh.userData.mat = mat;
  return mesh;
}

export function setDomeColors(mesh, sky, ground) {
  const u = mesh.userData.mat.uniforms;
  u.uSky.value.setHex(sky);
  u.uGround.value.setHex(ground);
}
