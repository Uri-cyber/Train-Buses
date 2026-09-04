import * as THREE from 'three';
import { Builder, stdMat, setInstance, rng } from './builder.js';
import { C, smooth } from './palette.js';
import { noise2, fbm } from './textures.js';

/**
 * Trees by biome: pine and cypress on the northern hills and the Carmel,
 * orange groves in rows across the Sharon, olives in the Judean hills, date
 * palms along the coast and by the Dead Sea, acacias in the Arava and Negev.
 * Six InstancedMeshes in total. Sizes exaggerated so they read from the air.
 */
const TREES = {
  cypress: (b) => { b.cyl(0, 0.02, 0, 0.012, 0.04, 0x5a4630, 5); b.cone(0, 0.03, 0, 0.055, 0.34, 0x2f5a35, 7); },
  pine:    (b) => { b.cyl(0, 0.07, 0, 0.014, 0.14, 0x5a4630, 5); b.dome(0, 0.12, 0, 0.13, 0x3d6f40, 9, { scaleY: 0.55 }); b.dome(0, 0.15, 0, 0.09, 0x4a7d47, 8, { scaleY: 0.6 }); },
  olive:   (b) => { b.cyl(0, 0.03, 0, 0.012, 0.06, 0x6b5238, 5); b.sphere(0, 0.10, 0, 0.075, 0x8fa06a, 8, { scaleY: 0.8 }); },
  palm:    (b) => { b.cyl(0, 0.13, 0, 0.011, 0.26, 0x7a6144, 5, { rTop: 0.008 }); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.box(Math.cos(a) * 0.05, 0.27, Math.sin(a) * 0.05, 0.12, 0.012, 0.03, 0x4f8a3a, { rotY: -a, rotZ: -0.5 }); } },
  orange:  (b) => { b.cyl(0, 0.02, 0, 0.009, 0.04, 0x6b5238, 5); b.sphere(0, 0.075, 0, 0.055, 0x3f7f3a, 8); b.sphere(0.025, 0.09, 0.03, 0.008, 0xf0902a, 5); },
  acacia:  (b) => { b.cyl(0, 0.05, 0, 0.011, 0.10, 0x6b5238, 5); b.dome(0, 0.09, 0, 0.11, 0x9aa552, 8, { scaleY: 0.32 }); },
};

export function createVegetation(world, terrain, occupancy) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const R = rng(777);
  const n = noise2(51);
  const P = terrain.P;
  const lists = Object.fromEntries(Object.keys(TREES).map((k) => [k, []]));

  const { x0, x1, zN, zS } = terrain.bounds;
  const spacing = 0.9;
  for (let z = zN; z < zS; z += spacing) {
    for (let x = x0; x < x1; x += spacing) {
      const px = x + (R() - 0.5) * spacing, pz = z + (R() - 0.5) * spacing;
      if (!occupancy.onCoreLand(px, pz)) continue;
      const [lon, lat] = P.toLonLat(px, pz);
      const m = terrain.heightAt(px, pz) / 3 * 1000;                     // metres, real
      const coast = terrain.toOcean ? 0 : 0;
      const patch = fbm(n, lon * 20, lat * 20, 3);                      // clumping
      // biome weights
      const north = smooth((lat - 32.35) / 0.25), south = 1 - smooth((lat - 31.2) / 0.3);
      const east = smooth((lon - 35.32) / 0.12);
      const sharon = smooth((lat - 32.0) / 0.1) * (1 - smooth((lat - 32.55) / 0.1)) * (1 - smooth((lon - 35.0) / 0.08)) * (1 - east);
      const rift = Math.exp(-(((lon - 35.5) / 0.09) ** 2)) * (1 - north);
      let type = null, p = 0;
      const r = R();
      if (north && m > 150 && !east) { p = 0.55 * north * (0.4 + patch); type = r < 0.6 ? 'pine' : 'cypress'; }
      else if (sharon > 0.5 && patch > 0.45) { p = 0.9; type = 'orange'; }
      else if (!south && m > 250 && lon > 34.95 && lon < 35.35 && lat < 32.35) { p = 0.35 * (0.3 + patch); type = r < 0.7 ? 'olive' : 'cypress'; }
      else if (south && rift > 0.4 && lat > 30.4) { p = 0.35; type = r < 0.5 ? 'palm' : 'acacia'; }
      else if (south) { p = 0.05 * (0.5 + patch); type = 'acacia'; }
      else if (lat > 31.5 && (lon - 34.3) < 0.55 && m < 60) { p = 0.12; type = r < 0.6 ? 'palm' : 'cypress'; }
      else { p = 0.10 * patch; type = r < 0.5 ? 'cypress' : 'olive'; }
      if (lat < 29.75 && lon > 34.85) { p = 0.3; type = 'palm'; }        // Eilat
      if (!type || R() > p) continue;
      if (occupancy.blocked(px, pz, 0.15)) continue;
      const y = terrain.heightAt(px, pz);
      const scale = 0.8 + R() * 0.5;
      lists[type].push([px, y, pz, R() * Math.PI * 2, scale]);
      occupancy.add(px, pz, 0.12, 'tree');
    }
  }

  let total = 0;
  for (const [name, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const b = new Builder(name.length * 17);
    TREES[name](b);
    const mesh = new THREE.InstancedMesh(b.build(), stdMat({ roughness: 0.9 }), list.length);
    list.forEach((t, i) => setInstance(mesh, i, t[0], t[1], t[2], t[3], t[4], t[4], t[4]));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = `trees-${name}`;
    group.add(mesh);
    total += list.length;
  }
  return { group, total, counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])) };
}
