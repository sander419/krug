// file: js/three/glazeMaterial.js
// Глазурь на модели. Считает не шейдер: толщину плёнки даёт core/glazeCoat.js,
// сюда она приходит атрибутом вершины aCoat. Шейдер только превращает толщину
// в цвет и блеск — поэтому вид и вердикт панели говорят об одном и том же.
//
// Почему не отдельный ShaderMaterial: своё освещение пришлось бы писать заново
// и потерять IBL от RoomEnvironment, а без честных отражений глянец не читается.
// MeshPhysicalMaterial с onBeforeCompile оставляет всю модель освещения three
// на месте и подменяет ровно два места — цвет и шероховатость.
import * as THREE from 'three';

/* Шум: хеш по позиции в мире. Дёшево и не требует текстур — их в проекте нет
   принципиально, всё живёт в vendor/ без единого внешнего файла. */
const GLSL_NOISE = /* glsl */`
  float gHash(vec3 p){
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float gNoise(vec3 x){
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(gHash(i + vec3(0,0,0)), gHash(i + vec3(1,0,0)), f.x),
                   mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x),
                   mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  /* сетка цека: расстояние до границы ячейки со случайным центром */
  float gCell(vec3 p){
    vec3 i = floor(p), f = fract(p);
    float d1 = 9.0, d2 = 9.0;
    for(int x = -1; x <= 1; x++)
    for(int y = -1; y <= 1; y++)
    for(int z = -1; z <= 1; z++){
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = vec3(gHash(i + g), gHash(i + g + 11.0), gHash(i + g + 27.0));
      float d = length(g + o - f);
      if(d < d1){ d2 = d1; d1 = d; } else if(d < d2){ d2 = d; }
    }
    return d2 - d1;
  }
`;

export function createGlazeMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.25, metalness: 0.0,
    clearcoat: 0.6, clearcoatRoughness: 0.12,
    side: THREE.DoubleSide,
  });

  const u = {
    uGlaze:  {value: new THREE.Color(0xf3ece0)},
    uBreak:  {value: new THREE.Color(0xb4643c)},
    uBody:   {value: new THREE.Color(0xb4643c)},
    uOpacityG: {value: 0.1},
    uGloss:  {value: 0.9},
    uBreakK: {value: 0.3},
    uSpeck:  {value: 0.0},
    uCrystal:{value: 0.0},
    uCrackle:{value: 0.0},
    uGrain:  {value: 0.35},        // размер зерна шума в мм⁻¹
  };
  mat.userData.u = u;

  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute float aCoat;
        varying float vCoat;
        varying vec3 vLocalPos;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vCoat = aCoat;
        vLocalPos = position;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        uniform vec3 uGlaze, uBreak, uBody;
        uniform float uOpacityG, uGloss, uBreakK, uSpeck, uCrystal, uCrackle, uGrain;
        varying float vCoat;
        varying vec3 vLocalPos;
        ${GLSL_NOISE}
      `)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float t = vCoat;
        vec3 p = vLocalPos * uGrain;

        /* цвет плёнки набирает силу с толщиной — закон Бугера, поэтому целадон
           зеленеет в канавке, а на гладкой стенке почти бесцветен. Кроющая
           способность входит в квадрате: иначе прозрачная глазурь на середине
           шкалы уже закрывает черепок, чего в жизни не бывает */
        float hide = 1.0 - exp(-t * mix(0.08, 2.8, uOpacityG * uOpacityG));
        vec3 col = mix(uBody, uGlaze, clamp(hide, 0.0, 1.0));
        /* прозрачная плёнка черепок не закрывает, но подкрашивает — как стекло
           поверх глины. Оттого целадон и зеленеет там, где слой глубже */
        float tint = (1.0 - uOpacityG) * clamp(t * 0.42, 0.0, 0.62);
        col = mix(col, clamp(col * uGlaze * 1.9, 0.0, 1.0), tint);

        /* пробой: на ребре плёнка сходит на нет и открывает черепок */
        float brk = smoothstep(0.62, 0.10, t) * uBreakK;
        col = mix(col, uBreak, clamp(brk, 0.0, 1.0));

        /* крап: железо и шамот выходят точками там, где слой тонкий */
        if(uSpeck > 0.001){
          float s = smoothstep(0.60, 0.84, gNoise(p * 1.6));
          col = mix(col, uBreak, s * uSpeck * (1.2 - clamp(t, 0.0, 1.0)) * 0.9);
        }
        /* кристаллы: крупные цветы в текучем расплаве */
        if(uCrystal > 0.001){
          // цветы виллемита крупные: сантиметры, а не крупинки
          float c = smoothstep(0.56, 0.74, gNoise(p * 0.22)) * smoothstep(0.35, 0.85, t);
          col = mix(col, uBreak, c * uCrystal);
        }
        /* цек: сетка волосяных трещин по плёнке */
        float crack = 0.0;
        if(uCrackle > 0.001){
          // ячейка цека — сантиметр, линия волосяная: иначе сетка читается шумом
          crack = 1.0 - smoothstep(0.012, 0.055, gCell(p * 0.55));
          col = mix(col, col * 0.45, crack * uCrackle);
        }

        diffuseColor.rgb *= col;

        /* блеск живёт там, где есть стекло: сухой поясок и пробитое ребро матовые */
        float wet = clamp(t * 1.4, 0.0, 1.0);
        float gRough = mix(0.85, mix(0.55, 0.03, uGloss), wet);
        gRough = mix(gRough, 0.9, crack * uCrackle * 0.5);
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        roughnessFactor = gRough;
      `);
  };
  mat.customProgramCacheKey = () => 'krug-glaze';
  return mat;
}

/** Перенести параметры выбранной глазури и цвет черепка в униформы. */
export function applyGlazeLook(mat, glaze, bodyColorHex) {
  const u = mat.userData.u;
  if (!u) return;
  const look = glaze.look;
  u.uGlaze.value.setHex(glaze.color);
  u.uBody.value.setHex(bodyColorHex);
  u.uBreak.value.setHex(glaze.breakColor ?? bodyColorHex);
  u.uOpacityG.value = look.opacity;
  u.uGloss.value = look.gloss;
  u.uBreakK.value = look.breakEdge;
  u.uSpeck.value = look.speck || 0;
  u.uCrystal.value = look.crystal || 0;
  u.uCrackle.value = look.crackle || 0;
  mat.clearcoat = 0.25 + 0.7 * look.gloss;
  mat.clearcoatRoughness = 0.05 + 0.35 * (1 - look.gloss);
  mat.needsUpdate = false;      // униформы меняются на лету, перекомпиляция не нужна
}
