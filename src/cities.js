import * as THREE from 'three';
import { Builder, stdMat, glowMat, setInstance, rng } from './builder.js';
import { C, smooth } from './palette.js';

/**
 * Towns and cities as instanced building blocks around the real places and
 * every station: white Bauhaus-style blocks with rounded balconies on the
 * coast, Jerusalem stone with flat roofs inland, glass towers in Tel Aviv
 * and Haifa, and a solar water heater on almost every roof, because this is
 * Israel. Windows glow after dark.
 */
const BIG = { 'Tel Aviv': 11, Haifa: 7.5, Jerusalem: 7.5, Beersheba: 5, Nazareth: 3, Ramla: 2.5 };

export function createCities(world, network, terrain, occupancy) {
  const group = new THREE.Group();
  group.name = 'cities';
  const R = rng(31337);
  const P = terrain.P;

  // centres: real places, then every station that has no place within 4 km
  const centres = [];
  for (const p of world.places) {
    if (p.adm0 !== 'Israel') continue;
    centres.push({ x: p.x, z: p.z, r: BIG[p.name_en] ?? 2.5, name: p.name_en, pop: p.pop });
  }
  for (const s of network.stations) {
    if (centres.some((c) => Math.hypot(c.x - s.x, c.z - s.z) < 4)) continue;
    const big = /tel-aviv|haifa|jerusalem|beersheba|netanya|ashdod|ashkelon|herzliya|modiin|petah|rishon|holon|bat-yam|ramat|lod|akko|nahariya|hadera|kfar-saba/.test(s.id);
    centres.push({ x: s.x, z: s.z, r: big ? 3.2 : 1.9, name: s.en });
  }

  const kinds = { bauhaus: [], stone: [], tower: [], house: [] };
  const heaters = [];
  let placed = 0;
  for (const c of centres) {
    const [lon, lat] = P.toLonLat(c.x, c.z);
    const jerusalem = lat < 32.0 && lon > 35.05 && lat > 31.6;
    const density = c.r > 6 ? 1.0 : 0.85;
    const n = Math.round(c.r * c.r * (c.r > 6 ? 40 : 30) * density);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = c.r * Math.sqrt(R());
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!occupancy.onCoreLand(x, z)) continue;
      const fromCentre = d / c.r;
      let kind;
      const r = R();
      if (c.r > 6 && fromCentre < 0.4 && r < 0.3) kind = 'tower';
      else if (jerusalem) kind = r < 0.85 ? 'stone' : 'house';
      else kind = r < (fromCentre < 0.6 ? 0.88 : 0.68) ? 'bauhaus' : 'house';
      const w = kind === 'tower' ? 0.28 + R() * 0.16 : kind === 'house' ? 0.22 + R() * 0.1 : 0.3 + R() * 0.2;
      const dep = kind === 'tower' ? w : kind === 'house' ? 0.22 + R() * 0.1 : 0.28 + R() * 0.2;
      const h = kind === 'tower' ? 0.9 + R() * 1.7 : kind === 'house' ? 0.16 + R() * 0.08 : 0.3 + R() * 0.45 * (1 - fromCentre * 0.5);
      const rad = Math.max(w, dep) * 0.75;
      if (occupancy.blocked(x, z, rad)) continue;
      const y = terrain.heightAt(x, z);
      const rot = R() * Math.PI * 2;
      kinds[kind].push([x, y, z, rot, w, h, dep]);
      occupancy.add(x, z, rad, 'building');
      placed++;
      if (kind !== 'tower' && R() < 0.75) {
        // solar water heater on the roof, tilted to the south
        heaters.push([x + (R() - 0.5) * w * 0.4, y + h, z + (R() - 0.5) * dep * 0.4, rot]);
      }
    }
  }

  const GEOM = {
    bauhaus: (b, g) => {
      b.box(0, 0.5, 0, 1, 1, 1, C.stucco, { jitter: 0.03 });
      b.box(0.35, 0.5, 0.52, 0.5, 0.9, 0.08, 0xe7e2d6);                       // balcony band
      b.box(0, 1.02, 0, 0.9, 0.04, 0.9, C.roofFlat);
      for (let f = 0; f < 3; f++) g.box(-0.02, 0.2 + f * 0.3, 0.505, 0.5, 0.08, 0.01, C.windowLit, { jitter: 0.1 });
      for (let f = 0; f < 3; f++) g.box(0.505, 0.2 + f * 0.3, 0, 0.01, 0.08, 0.55, C.windowLit, { jitter: 0.1 });
    },
    stone: (b, g) => {
      b.box(0, 0.5, 0, 1, 1, 1, C.stoneWall, { jitter: 0.05 });
      b.box(0, 1.02, 0, 1.04, 0.04, 1.04, C.stoneDark);
      for (let f = 0; f < 3; f++) g.box(0, 0.22 + f * 0.3, 0.505, 0.55, 0.09, 0.01, C.windowLit, { jitter: 0.1 });
      for (let f = 0; f < 3; f++) g.box(0.505, 0.22 + f * 0.3, 0, 0.01, 0.09, 0.55, C.windowLit, { jitter: 0.1 });
    },
    tower: (b, g) => {
      b.box(0, 0.5, 0, 1, 1, 1, 0x8aa9c4, { jitter: 0.03 });
      b.box(0, 1.01, 0, 0.7, 0.03, 0.7, 0x55606b);
      for (let f = 0; f < 9; f++) { g.box(0, 0.06 + f * 0.105, 0.505, 0.8, 0.045, 0.01, 0xdce9ff, { jitter: 0.15 }); g.box(0.505, 0.06 + f * 0.105, 0, 0.01, 0.045, 0.8, 0xdce9ff, { jitter: 0.15 }); }
    },
    house: (b, g) => {
      b.box(0, 0.4, 0, 1, 0.8, 1, C.stucco, { jitter: 0.04 });
      b.gable(0, 0.8, 0, 1.1, 0.3, 1.1, C.roofTile);
      g.box(0, 0.4, 0.505, 0.4, 0.15, 0.01, C.windowLit);
    },
  };

  const glowMats = [];
  let count = 0;
  for (const [kind, list] of Object.entries(kinds)) {
    if (!list.length) continue;
    const b = new Builder(kind.length * 29), g = new Builder(5);
    GEOM[kind](b, g);
    const solid = new THREE.InstancedMesh(b.build(), stdMat({ roughness: 0.85 }), list.length);
    list.forEach((it, i) => setInstance(solid, i, it[0], it[1], it[2], it[3], it[4], it[5], it[6]));
    solid.instanceMatrix.needsUpdate = true;
    solid.castShadow = true; solid.receiveShadow = true; solid.name = `city-${kind}`;
    group.add(solid);
    const gg = g.build();
    if (gg) {
      const glow = new THREE.InstancedMesh(gg, glowMat(), list.length);
      list.forEach((it, i) => setInstance(glow, i, it[0], it[1], it[2], it[3], it[4], it[5], it[6]));
      glow.instanceMatrix.needsUpdate = true; glow.name = `city-${kind}-glow`;
      group.add(glow);
      glowMats.push(glow.material);
    }
    count += list.length;
  }
  // solar water heaters: a white tank on a dark tilted panel
  if (heaters.length) {
    const b = new Builder(9);
    b.box(0, 0.03, 0.02, 0.09, 0.02, 0.11, C.solar, { rotX: -0.5 });
    b.cyl(0, 0.075, -0.045, 0.028, 0.09, C.heater, 8, { rotZ: Math.PI / 2 });
    const mesh = new THREE.InstancedMesh(b.build(), stdMat({ roughness: 0.5 }), heaters.length);
    heaters.forEach((h, i) => setInstance(mesh, i, h[0], h[1], h[2], h[3]));
    mesh.instanceMatrix.needsUpdate = true; mesh.name = 'solar-heaters';
    group.add(mesh);
  }

  const _c = new THREE.Color();
  return {
    group, count, heaters: heaters.length, centres,
    update(night, lightsOn) {
      const on = lightsOn ? 1 : Math.max(0.02, Math.min(1, (night - 0.4) * 2.2));
      _c.setScalar(on);
      for (const m of glowMats) m.color.copy(_c);
    },
  };
}
