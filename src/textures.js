import * as THREE from 'three';

/**
 * Procedural textures, drawn at start-up. Nothing is loaded from disk or the
 * network. Deterministic value noise keeps them identical between runs.
 */

export function noise2(seed = 1) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const n = (1 - v) * ((1 - u) * grad(perm[a], x, y) + u * grad(perm[b], x - 1, y))
      + v * ((1 - u) * grad(perm[a + 1], x, y - 1) + u * grad(perm[b + 1], x - 1, y - 1));
    return n * 0.5 + 0.5;
  };
}

export function fbm(n, x, y, oct = 4, lac = 2.05, gain = 0.5) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * n(x * f, y * f); norm += a; a *= gain; f *= lac; }
  return sum / norm;
}

function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')];
}

function finish(cv, { repeat = [1, 1], srgb = false, aniso = 4, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tangent-space normal map from a height function sampled on a tiling grid. */
export function normalFromHeight(getH, size, strength) {
  const [cv, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = getH((x - 1 + size) % size, y), r = getH((x + 1) % size, y);
      const u = getH(x, (y - 1 + size) % size), d = getH(x, (y + 1) % size);
      const nx = (l - r) * strength, ny = (u - d) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(cv);
}

/** Tiling ground relief: gentle hummocks with finer grain, used across the whole terrain. */
export function groundNormal(size = 512) {
  const n = noise2(17);
  const hs = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // sum of tiling sines keeps the edge seamless; noise adds character
      let h = Math.sin(u * 6.28 * 3 + Math.cos(v * 6.28 * 2) * 1.5) * 0.35 + Math.sin(v * 6.28 * 5 + u * 3) * 0.25;
      h += (fbm(n, u * 9, v * 9, 3) - 0.5) * 1.4;
      hs[y * size + x] = h;
    }
  }
  return normalFromHeight((x, y) => hs[y * size + x], size, 1.1);
}

/** Tiling sea ripples. */
export function waterNormal(size = 512) {
  const n = noise2(41);
  const hs = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let h = Math.sin((u * 5 + v * 2) * 6.28 + fbm(n, u * 3, v * 3, 2) * 4.0) * 0.18
        + Math.sin((u * 2 - v * 6) * 6.28 + fbm(n, u * 4 + 3, v * 4, 2) * 5.0) * 0.14
        + (fbm(n, u * 7, v * 7, 4) - 0.5) * 1.5;
      hs[y * size + x] = h;
    }
  }
  return normalFromHeight((x, y) => hs[y * size + x], size, 1.4);
}

/** Soft radial disc with alpha, for the sun glow, clouds and lamp halos. */
export function radialSprite(size = 128, inner = 0.15, outer = 1.0, gamma = 1.6) {
  const [cv, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      let a = 1 - Math.max(0, Math.min(1, (r - inner) / (outer - inner)));
      a = Math.pow(a, gamma);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(cv, { wrap: false, srgb: true });
}

/** A puffy cloud silhouette: several overlapping soft discs, noisy edge. */
export function cloudSprite(size = 256, seed = 3) {
  const n = noise2(seed);
  const [cv, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const puffs = [[0.5, 0.55, 0.30], [0.32, 0.6, 0.22], [0.68, 0.58, 0.24], [0.42, 0.42, 0.20], [0.6, 0.42, 0.18]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      let a = 0;
      for (const [cx, cy, r] of puffs) {
        const d = Math.hypot(u - cx, (v - cy) * 1.25) / r;
        a = Math.max(a, 1 - d);
      }
      a += (fbm(n, u * 6, v * 6, 3) - 0.5) * 0.35;
      a = Math.max(0, Math.min(1, a * 1.6));
      // flat, slightly darker underside
      const shade = 0.82 + 0.18 * Math.max(0, Math.min(1, (0.75 - v) * 2));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * shade; img.data[i + 3] = Math.pow(a, 1.4) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(cv, { wrap: false, srgb: true });
}
