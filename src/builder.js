import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Collects simple primitives and merges them into one BufferGeometry with
 * baked (linear) vertex colours: one draw call per builder. Used for
 * stations, landmarks, trains and every other built thing.
 */
export class Builder {
  constructor(seed = 1) { this.parts = []; this.count = 0; this.rng = rng(seed); }

  push(g, color, jitter = 0.04) {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    paint(flat, color, jitter, this.rng);
    this.parts.push(flat); this.count++;
    return this;
  }
  /** box centred at (x, y, z) */
  box(x, y, z, w, h, d, color, o = {}) {
    if (w <= 0 || h <= 0 || d <= 0) return this;
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.rotZ) g.rotateZ(o.rotZ); if (o.rotX) g.rotateX(o.rotX); if (o.rotY) g.rotateY(o.rotY);
    g.translate(x, y, z);
    return this.push(g, color, o.jitter);
  }
  /** box by its base centre: sits on y0 and rises h */
  up(x, y0, z, w, h, d, color, o = {}) { return this.box(x, y0 + h / 2, z, w, h, d, color, o); }
  cyl(x, y, z, r, h, color, seg = 10, o = {}) {
    const g = new THREE.CylinderGeometry(o.rTop ?? r, o.rBottom ?? r, h, seg, 1, !!o.open);
    if (o.rotZ) g.rotateZ(o.rotZ); if (o.rotX) g.rotateX(o.rotX); if (o.rotY) g.rotateY(o.rotY);
    g.translate(x, y, z);
    return this.push(g, color, o.jitter);
  }
  cone(x, y0, z, r, h, color, seg = 8, o = {}) {
    const g = new THREE.ConeGeometry(r, h, seg);
    if (o.rotY) g.rotateY(o.rotY);
    g.translate(x, y0 + h / 2, z);
    return this.push(g, color, o.jitter);
  }
  sphere(x, y, z, r, color, seg = 10, o = {}) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(5, seg - 3));
    if (o.scaleY) g.scale(1, o.scaleY, 1);
    g.translate(x, y, z);
    return this.push(g, color, o.jitter);
  }
  /** upper half of a sphere, flat underneath */
  dome(x, y0, z, r, color, seg = 12, o = {}) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1), 0, Math.PI * 2, 0, Math.PI / 2);
    if (o.scaleY) g.scale(1, o.scaleY, 1);
    g.translate(x, y0, z);
    return this.push(g, color, o.jitter);
  }
  /** gable roof: triangular prism along z */
  gable(x, y0, z, w, h, d, color, o = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    if (o.rotY) g.rotateY(o.rotY);
    g.translate(x, y0, z);
    return this.push(g, color, o.jitter);
  }
  /** arbitrary geometry (already positioned) */
  add(g, color, jitter) { return this.push(g, color, jitter); }

  build() {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts.length = 0;
    merged.computeVertexNormals();
    return merged;
  }
  mesh(material = stdMat(), { shadow = true } = {}) {
    const g = this.build();
    if (!g) return new THREE.Group();
    const m = new THREE.Mesh(g, material);
    m.castShadow = shadow; m.receiveShadow = shadow;
    return m;
  }
}

const _c = new THREE.Color();
export function paint(g, color, jitter = 0.04, r = Math.random) {
  _c.setHex(color);                                 // sRGB hex -> linear, as the attribute expects
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = jitter ? 1 + (r() - 0.5) * jitter : 1;
    arr[i * 3] = _c.r * k; arr[i * 3 + 1] = _c.g * k; arr[i * 3 + 2] = _c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export const stdMat = (extra = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, ...extra });
/** unlit, for things that glow at night (window panes, lamps, LEDs) */
export const glowMat = (extra = {}) => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, ...extra });

/** deterministic RNG */
export function rng(seed = 1337) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** helper for instanced placement */
export const _m4 = new THREE.Matrix4();
export const _q = new THREE.Quaternion();
export const _v = new THREE.Vector3();
export const _s = new THREE.Vector3(1, 1, 1);
export function setInstance(inst, i, x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) {
  _q.setFromAxisAngle(_v.set(0, 1, 0), rotY);
  _s.set(sx, sy, sz);
  _m4.compose(_v.set(x, y, z), _q, _s);
  inst.setMatrixAt(i, _m4);
}
