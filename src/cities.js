import * as THREE from 'three';
import { OUTLINE_LAYER } from './post.js';
import { Builder, stdMat, glowMat, setInstance, rng } from './builder.js';
import { C, smoothstep } from './palette.js';
import { radialSprite } from './textures.js';

/**
 * Towns and cities as instanced building blocks around the real places and
 * every station: white Bauhaus-style blocks with rounded balconies on the
 * coast, Jerusalem stone with flat roofs inland, glass towers in Tel Aviv
 * and Haifa, and a solar water heater on almost every roof, because this is
 * Israel. Windows come on one building at a time at dusk, a few stay dark,
 * the towers twinkle faintly, and the big cities sit under a sodium haze.
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

  const glows = [];                                 // { mesh, thr, base, tw } per kind
  let count = 0;
  for (const [kind, list] of Object.entries(kinds)) {
    if (!list.length) continue;
    const b = new Builder(kind.length * 29), g = new Builder(5);
    GEOM[kind](b, g);
    const solid = new THREE.InstancedMesh(b.build(), stdMat({ roughness: 0.85 }), list.length);
    solid.layers.enable(OUTLINE_LAYER);
    list.forEach((it, i) => setInstance(solid, i, it[0], it[1], it[2], it[3], it[4], it[5], it[6]));
    solid.instanceMatrix.needsUpdate = true;
    solid.castShadow = true; solid.receiveShadow = true; solid.name = `city-${kind}`;
    group.add(solid);
    const gg = g.build();
    if (gg) {
      const glow = new THREE.InstancedMesh(gg, glowMat(), list.length);
      list.forEach((it, i) => setInstance(glow, i, it[0], it[1], it[2], it[3], it[4], it[5], it[6]));
      glow.instanceMatrix.needsUpdate = true; glow.name = `city-${kind}-glow`;
      // each building switches on at its own point of dusk (thr on the 0..1 night scale); 7% never do
      const n = list.length;
      glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      const thr = new Float32Array(n), base = new Float32Array(n);
      for (let i = 0; i < n; i++) thr[i] = R() < 0.07 ? 9 : 0.30 + R() * 0.45;
      let tw = null;
      if (kind === 'tower') { tw = new Float32Array(n); for (let i = 0; i < n; i++) tw[i] = R() * Math.PI * 2; }
      group.add(glow);
      glows.push({ mesh: glow, thr, base, tw });
    }
    count += list.length;
  }
  // solar water heaters: a white tank on a dark tilted panel
  if (heaters.length) {
    const b = new Builder(9);
    b.box(0, 0.03, 0.02, 0.09, 0.02, 0.11, C.solar, { rotX: -0.5 });
    b.cyl(0, 0.075, -0.045, 0.028, 0.09, C.heater, 8, { rotZ: Math.PI / 2 });
    const mesh = new THREE.InstancedMesh(b.build(), stdMat({ roughness: 0.5 }), heaters.length);
    mesh.layers.enable(OUTLINE_LAYER);
    heaters.forEach((h, i) => setInstance(mesh, i, h[0], h[1], h[2], h[3]));
    mesh.instanceMatrix.needsUpdate = true; mesh.name = 'solar-heaters';
    group.add(mesh);
  }

  // sodium haze: a soft warm dome over each big city, seen from the country view at night
  const haze = [];
  const bigCities = centres.filter((c) => c.pop > 150000).sort((a, b) => b.pop - a.pop).slice(0, 8);
  if (bigCities.length) {
    const tex = radialSprite(128, 0.0, 1, 2.5);
    for (const c of bigCities) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: C.streetLamp, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, sizeAttenuation: true }));
      const size = 6 + 8 * Math.sqrt(c.pop / 450000);
      sp.scale.set(size, size, 1);
      sp.position.set(c.x, terrain.heightAt(c.x, c.z) + 0.4, c.z);
      sp.renderOrder = 4; sp.visible = false; sp.name = `haze-${c.name}`;
      group.add(sp);
      haze.push(sp);
    }
  }

  let lastNight = -1, lastOn = null;
  return {
    group, count, heaters: heaters.length, centres, glows, haze,
    update(night, lightsOn, time = 0) {
      // rewrite the window levels only when dusk has moved on (or the switch flipped)
      if (lightsOn !== lastOn || Math.abs(night - lastNight) > 0.01) {
        lastNight = night; lastOn = lightsOn;
        for (const g of glows) {
          const { thr, base } = g, col = g.mesh.instanceColor;
          for (let i = 0; i < thr.length; i++) {
            const on = Math.max(0.02, lightsOn ? 1 : smoothstep(thr[i], thr[i] + 0.08, night));
            base[i] = on;
            col.setXYZ(i, on, on, on);
          }
          col.needsUpdate = true;
        }
      }
      // the towers twinkle faintly once it is dark (a small buffer, refreshed each frame)
      if (night > 0.3 || lightsOn) {
        for (const g of glows) {
          if (!g.tw) continue;
          const col = g.mesh.instanceColor;
          for (let i = 0; i < g.tw.length; i++) { const v = g.base[i] * (0.85 + 0.15 * Math.sin(time * 1.7 + g.tw[i])); col.setXYZ(i, v, v, v); }
          col.needsUpdate = true;
        }
      }
      const o = 0.35 * smoothstep(0.45, 0.8, night);
      for (const sp of haze) { sp.material.opacity = o; sp.visible = o > 0.02; }
    },
  };
}
