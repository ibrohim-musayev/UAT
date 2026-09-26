import * as THREE from 'three';

export const globalUniforms = { uTime: { value: 0 } };

export function systemUniforms() {
  return {
    uScan: { value: -1e4 },
    uScanAxis: { value: new THREE.Vector3(1, 0, 0) },
    uActive: { value: 0 },
    uChecked: { value: 0 },
    uFlash: { value: 0 },
  };
}

/**
 * Клон материала с инъекцией «инспекционного» слоя:
 * голографическая сетка, сканирующая полоса и зелёная отметка «проверено».
 */
export function inspectable(base, U) {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, globalUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
uniform float uScan, uActive, uChecked, uFlash, uTime;
uniform vec3 uScanAxis;`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  vec3 cyan = vec3(0.22, 0.78, 1.0);
  vec3 green = vec3(0.12, 1.0, 0.48);
  float d = dot(vWPos, uScanAxis) - uScan;
  float band = exp(-d * d * 2.2);
  float ahead = smoothstep(-0.25, 0.25, d);
  vec3 gp = vWPos * 1.5;
  vec3 gg = abs(fract(gp - 0.5) - 0.5) / max(fwidth(gp), vec3(1e-4));
  float line = 1.0 - min(min(min(gg.x, gg.y), gg.z), 1.0);
  float a = uActive;
  outgoingLight = mix(outgoingLight, outgoingLight * 0.42 + cyan * 0.035, a * 0.75 * ahead);
  outgoingLight += a * ahead * cyan * line * 0.3;
  outgoingLight += a * (1.0 - ahead) * green * (0.035 + line * 0.22);
  outgoingLight += a * band * cyan * 2.0;
  outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.84, 1.0, 0.9) + green * 0.015, uChecked);
  outgoingLight += green * uFlash * 1.1;
}
#include <opaque_fragment>`
      );
  };
  m.customProgramCacheKey = () => 'inspectable-v1';
  return m;
}
