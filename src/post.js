import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Tilt-shift: blur that grows with distance from a horizontal band of focus.
 * It is what makes aerial photographs of real places look like models; here
 * it is the "animated but real" look in one shader.
 */
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    direction: { value: new THREE.Vector2(1, 0) },
    focus: { value: 0.52 }, band: { value: 0.16 }, strength: { value: 2.0 }, below: { value: 0.8 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 resolution, direction;
    uniform float focus, band, strength, below;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - focus) - band;
      float amt = clamp(d / 0.35, 0.0, 1.0); amt = amt * amt * strength;
      if (vUv.y < focus) amt *= below;
      vec2 step = direction / resolution * amt;
      vec4 c = texture2D(tDiffuse, vUv) * 0.2270270270;
      c += texture2D(tDiffuse, vUv + step * 1.3846153846) * 0.3162162162;
      c += texture2D(tDiffuse, vUv - step * 1.3846153846) * 0.3162162162;
      c += texture2D(tDiffuse, vUv + step * 3.2307692308) * 0.0702702703;
      c += texture2D(tDiffuse, vUv - step * 3.2307692308) * 0.0702702703;
      gl_FragColor = c;
    }`,
};

const FinishShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.36 }, warmth: { value: 0.0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float amount, warmth;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float v = smoothstep(0.85, 0.35, dot(p, p) * 2.0);
      c.rgb *= mix(1.0 - amount, 1.0, v);
      c.rgb += vec3(0.03, 0.012, -0.02) * warmth;          // a little warmth at dusk
      gl_FragColor = c;
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const dpr = renderer.getPixelRatio();
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 12 });
  gtao.blendIntensity = 0.9;
  composer.addPass(gtao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.5, 0.94);
  composer.addPass(bloom);

  const tiltH = new ShaderPass(TiltShiftShader);
  const tiltV = new ShaderPass(TiltShiftShader);
  tiltV.uniforms.direction.value.set(0, 1);
  for (const p of [tiltH, tiltV]) p.uniforms.resolution.value.set(size.x * dpr, size.y * dpr);
  composer.addPass(tiltH); composer.addPass(tiltV);

  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  const api = {
    composer, gtao, bloom, tilt: [tiltH, tiltV], finish, quality: 'high',
    setQuality(q) {
      api.quality = q;
      gtao.enabled = q === 'high';
      bloom.enabled = q !== 'low';
      tiltH.enabled = tiltV.enabled = q !== 'low';
    },
    /** 0 = full day, 1 = deep night */
    setNight(t, dusk = 0) {
      bloom.strength = 0.16 + t * 0.55;
      bloom.threshold = 0.94 - t * 0.35;
      finish.uniforms.warmth.value = dusk;
    },
    /** tilt-shift gets stronger the further out you are */
    setZoom(dist) {
      const s = 0.6 + 1.6 * Math.min(1, dist / 350);
      tiltH.uniforms.strength.value = tiltV.uniforms.strength.value = s;
    },
    resize(w, h) {
      composer.setSize(w, h);
      gtao.setSize(w, h);
      for (const p of [tiltH, tiltV]) p.uniforms.resolution.value.set(w * dpr, h * dpr);
    },
    render() { composer.render(); },
  };
  return api;
}
