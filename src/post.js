import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** objects on this layer get a cartoon outline */
export const OUTLINE_LAYER = 2;

/**
 * Cartoon outlines. The outlined objects are drawn once more with a normal
 * material into a small buffer that also keeps depth; a Sobel over normals
 * and (linearised, log-buffer) depth finds silhouettes and creases, and the
 * lines are drawn over the colour image. Terrain, water and sky are not on
 * the layer, so the map stays clean and only the toys get inked.
 */
class EdgePass extends Pass {
  constructor(scene, camera, w, h) {
    super();
    this.scene = scene; this.camera = camera;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
    });
    this.normalMat = new THREE.MeshNormalMaterial({ blending: THREE.NoBlending });
    this.uniforms = {
      tDiffuse: { value: null }, tNormal: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture },
      resolution: { value: new THREE.Vector2(w, h) }, logDepthBufFC: { value: 1 },
      lineColor: { value: new THREE.Color(0.05, 0.05, 0.09) }, width: { value: 1.4 }, strength: { value: 0.9 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, tNormal, tDepth;
        uniform vec2 resolution; uniform float logDepthBufFC, width, strength; uniform vec3 lineColor;
        varying vec2 vUv;
        // view distance from the logarithmic depth buffer; empty pixels read as very far
        float dist(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          if (d > 0.99999) return 1.0e6;
          return exp2(d * 2.0 / logDepthBufFC) - 1.0;
        }
        void main() {
          vec2 px = width / resolution;
          vec4 n0 = texture2D(tNormal, vUv);
          float w0 = dist(vUv);
          float edge = 0.0;
          vec2 offs[4]; offs[0] = vec2(px.x, 0.0); offs[1] = vec2(-px.x, 0.0); offs[2] = vec2(0.0, px.y); offs[3] = vec2(0.0, -px.y);
          for (int i = 0; i < 4; i++) {
            vec4 n = texture2D(tNormal, vUv + offs[i]);
            float w = dist(vUv + offs[i]);
            float near = min(w0, w);
            // depth step relative to distance: silhouettes and steps
            float dd = abs(w0 - w) / max(near, 0.5);
            edge = max(edge, smoothstep(0.02, 0.06, dd));
            // creases where both pixels belong to an object
            if (n0.a > 0.5 && n.a > 0.5) {
              float dn = 1.0 - dot(normalize(n0.xyz * 2.0 - 1.0), normalize(n.xyz * 2.0 - 1.0));
              edge = max(edge, smoothstep(0.2, 0.45, dn));
            }
          }
          // fade the ink with distance so the far country does not turn into scribble
          float fade = 1.0 - smoothstep(90.0, 240.0, min(w0, 1.0e5));
          edge *= fade * strength;
          vec4 c = texture2D(tDiffuse, vUv);
          gl_FragColor = vec4(mix(c.rgb, lineColor, edge), c.a);
        }`,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this._clear = new THREE.Color(0, 0, 0);
  }
  setSize(w, h) { this.rt.setSize(w, h); this.uniforms.resolution.value.set(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    const { scene, camera } = this;
    // normals + depth of the outlined layer only
    const mask = camera.layers.mask;
    const override = scene.overrideMaterial, fog = scene.fog, bg = scene.background;
    camera.layers.set(OUTLINE_LAYER);
    scene.overrideMaterial = this.normalMat; scene.fog = null; scene.background = null;
    const oldClear = renderer.getClearColor(new THREE.Color()), oldAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(this._clear, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setClearColor(oldClear, oldAlpha);
    camera.layers.mask = mask;
    scene.overrideMaterial = override; scene.fog = fog; scene.background = bg;
    // ink the colour image
    this.uniforms.logDepthBufFC.value = 2.0 / (Math.log(camera.far + 1.0) / Math.LN2);
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }
  dispose() { this.rt.dispose(); this.material.dispose(); this.fsQuad.dispose(); }
}

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

  const edge = new EdgePass(scene, camera, size.x * dpr, size.y * dpr);
  composer.addPass(edge);

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
    composer, edge, bloom, tilt: [tiltH, tiltV], finish, quality: 'high',
    setQuality(q) {
      api.quality = q;
      edge.enabled = q === 'high';
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
      edge.setSize(w * dpr, h * dpr);
      for (const p of [tiltH, tiltV]) p.uniforms.resolution.value.set(w * dpr, h * dpr);
    },
    render() { composer.render(); },
  };
  return api;
}
