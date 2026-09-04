import * as THREE from 'three';
import { ZONES, BOARD } from './layout.js';

/**
 * Harbour water: a gently rippling plane with depth-tinted vertex colours and
 * a low-roughness surface so it catches the sun as a specular highlight.
 */
export function buildWater() {
  const H = ZONES.harbour;
  const w = (H.x1 + 0.06) - (H.x0 - 0.06);
  const d = ZONES.waterZ1 - BOARD.z0;
  const NX = 40, NZ = 14;
  const geo = new THREE.PlaneGeometry(w, d, NX, NZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const deep = new THREE.Color(0x1a4a60), shallow = new THREE.Color(0x2f8298), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) + d / 2) / d;             // 0 at back wall, 1 at the quay
    c.copy(deep).lerp(shallow, Math.pow(t, 0.7));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.14, metalness: 0.35,
    transparent: true, opacity: 0.94,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((H.x0 + H.x1) / 2, 0.019, (BOARD.z0 + ZONES.waterZ1) / 2);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;

  const base = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) base[i] = pos.getY(i);

  return {
    mesh,
    update(t) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = Math.sin(x * 14 + t * 1.7) * 0.0016
                + Math.sin(z * 21 - t * 2.3) * 0.0012
                + Math.sin((x + z) * 9 + t * 1.1) * 0.0010;
        pos.setY(i, base[i] + h);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}
