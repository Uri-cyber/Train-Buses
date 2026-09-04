import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();

/**
 * Collects axis-aligned boxes and merges them into a single BufferGeometry
 * with baked vertex colours. One builder -> one draw call.
 */
export class VoxelBuilder {
  constructor() { this.parts = []; this.count = 0; }

  /** box centred on (x,y,z) with size (w,h,d) */
  box(x, y, z, w, h, d, color, opts = {}) {
    if (w <= 0 || h <= 0 || d <= 0) return this;
    const g = new THREE.BoxGeometry(w, h, d);
    if (opts.rotY) g.rotateY(opts.rotY);
    if (opts.rotX) g.rotateX(opts.rotX);
    if (opts.rotZ) g.rotateZ(opts.rotZ);
    g.translate(x, y, z);
    this.push(g, color, opts.jitter);
    return this;
  }

  /** box specified by its min corner and size (handy for stacking) */
  boxAt(x, y, z, w, h, d, color, opts) {
    return this.box(x + w / 2, y + h / 2, z + d / 2, w, h, d, color, opts);
  }

  cyl(x, y, z, r, h, color, seg = 8, opts = {}) {
    const g = new THREE.CylinderGeometry(r, opts.rBottom ?? r, h, seg);
    if (opts.rotX) g.rotateX(opts.rotX);
    if (opts.rotZ) g.rotateZ(opts.rotZ);
    g.translate(x, y, z);
    this.push(g, color, opts.jitter);
    return this;
  }

  /** wedge / ramp: a box with the +Y face shrunk along X, used for roofs */
  roof(x, y, z, w, h, d, color) {
    const g = new THREE.CylinderGeometry(0.0001, w / 2, h, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale(1, 1, d / w);
    g.translate(x, y + h / 2, z);
    this.push(g, color);
    return this;
  }

  /** gabled roof running along Z */
  gable(x, y, z, w, h, d, color) {
    const g = new THREE.CylinderGeometry(0.0001, w / 2, h, 3, 1, false, Math.PI / 6);
    g.scale(1, 1, 1);
    const s = new THREE.BufferGeometry();
    // simpler: prism via extruded triangle
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
    const eg = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    eg.translate(x, y, z - d / 2);
    this.push(eg, color);
    void g; void s;
    return this;
  }

  /** normalise indexing so heterogeneous primitives can be merged, then paint */
  push(g, color, jitter) {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    this.paint(flat, color, jitter);
    this.parts.push(flat); this.count++;
    return this;
  }

  paint(g, color, jitter = 0.05) {
    _c.set(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
      arr[i * 3] = _c.r * k; arr[i * 3 + 1] = _c.g * k; arr[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  build() {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts.length = 0;
    merged.computeVertexNormals();
    return merged;
  }

  /** merged Mesh, shadow-ready */
  mesh(material) {
    const g = this.build();
    if (!g) return new THREE.Group();
    const m = new THREE.Mesh(g, material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

export function standardMat(extra = {}) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.88, metalness: 0.02, ...extra,
  });
}

/** unlit material used for window panes so they can glow at night */
export function emissiveMat() {
  return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
}
