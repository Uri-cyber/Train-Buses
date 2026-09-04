import * as THREE from 'three';
import { makePathLookup, polylineLength } from './geo.js';
import { C } from './palette.js';
import { Builder, stdMat, glowMat, setInstance, rng } from './builder.js';

/**
 * Roads from Natural Earth (major highways and roads inside the map) laid on
 * the terrain, with road traffic: mostly white cars (this is Israel), green
 * Egged and blue Dan buses, a few lorries. Vehicles shuttle along their road
 * piece; the TRAFFIC button freezes them.
 */
const ROAD = { half: 0.19, lift: 0.028, step: 0.35 };

export function createTraffic(world, terrain, mask) {
  const group = new THREE.Group();
  group.name = 'traffic';
  const R = rng(4242);

  // keep roads on the core map (Israel, West Bank, Gaza); the neighbours' roads sink with them
  const pieces = [];
  for (const road of world.roads) {
    const runs = []; let cur = [];
    for (const p of road.pts) {
      if (mask.nearIsrael(p[0], p[1], 3)) cur.push(p);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    for (const r of runs) if (r.length >= 2 && polylineLength(r) > 1.5) pieces.push({ type: road.type, pts: r });
  }

  // ribbons
  const positions = [], colors = [], normals = [];
  const cRoad = new THREE.Color(C.asphalt), cLine = new THREE.Color(C.roadLine);
  const lookups = [];
  for (const piece of pieces) {
    const lk = makePathLookup(piece.pts);
    const n = Math.max(2, Math.ceil(lk.length / ROAD.step) + 1);
    const samples = [];
    for (let i = 0; i < n; i++) {
      const p = lk.at((lk.length * i) / (n - 1));
      samples.push({ ...p, y: terrain.heightAt(p.x, p.z) + ROAD.lift });
    }
    // light smoothing of the profile
    for (let k = 0; k < 2; k++) for (let i = 1; i < n - 1; i++) samples[i].y = (samples[i - 1].y + samples[i].y * 2 + samples[i + 1].y) / 4;
    const half = piece.type === 'Major Highway' ? ROAD.half * 1.4 : ROAD.half;
    const strip = (hw, off, col, dy) => {
      for (let i = 0; i + 1 < n; i++) {
        const a = samples[i], b = samples[i + 1];
        const na = [-a.tz, a.tx], nb = [-b.tz, b.tx];
        const q = [
          [a.x + na[0] * (off - hw), a.y + dy, a.z + na[1] * (off - hw)], [a.x + na[0] * (off + hw), a.y + dy, a.z + na[1] * (off + hw)],
          [b.x + nb[0] * (off + hw), b.y + dy, b.z + nb[1] * (off + hw)], [b.x + nb[0] * (off - hw), b.y + dy, b.z + nb[1] * (off - hw)],
        ];
        for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) { positions.push(...v); normals.push(0, 1, 0); colors.push(col.r, col.g, col.b); }
      }
    };
    strip(half, 0, cRoad, 0);
    strip(0.02, 0, cLine, 0.004);
    lookups.push({ lk, samples, n, half });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const roads = new THREE.Mesh(geo, stdMat({ roughness: 0.95 }));
  roads.receiveShadow = true; roads.name = 'roads';
  group.add(roads);

  // vehicles: instanced, three shapes
  const kinds = [
    { name: 'car', share: 0.72, len: 0.5, build(b, g) {
      b.box(0, 0.09, 0, 0.26, 0.10, 0.5, C.carWhite, { jitter: 0.02 });
      b.box(0, 0.17, 0.02, 0.22, 0.08, 0.26, C.carWhite);
      g.box(0, 0.17, 0.02, 0.225, 0.06, 0.20, 0x263241);
      g.box(0, 0.09, 0.253, 0.18, 0.03, 0.01, 0xfff3d0); g.box(0, 0.09, -0.253, 0.18, 0.03, 0.01, 0xff2a1a);
    } },
    { name: 'egged', share: 0.14, len: 0.9, build(b, g) {
      b.box(0, 0.17, 0, 0.3, 0.30, 0.9, C.eggedGreen, { jitter: 0.02 });
      b.box(0, 0.26, 0, 0.31, 0.10, 0.91, C.carWhite);
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) g.box(s * 0.156, 0.22, -0.32 + i * 0.16, 0.01, 0.08, 0.1, 0xdde6ff);
      g.box(0, 0.10, 0.453, 0.2, 0.04, 0.01, 0xfff3d0);
    } },
    { name: 'dan', share: 0.07, len: 0.9, build(b, g) {
      b.box(0, 0.17, 0, 0.3, 0.30, 0.9, C.danBlue, { jitter: 0.02 });
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) g.box(s * 0.156, 0.22, -0.32 + i * 0.16, 0.01, 0.08, 0.1, 0xdde6ff);
      g.box(0, 0.10, 0.453, 0.2, 0.04, 0.01, 0xfff3d0);
    } },
    { name: 'lorry', share: 0.07, len: 0.8, build(b, g) {
      b.box(0, 0.14, 0.28, 0.28, 0.22, 0.24, C.carWhite);
      b.box(0, 0.22, -0.14, 0.3, 0.34, 0.5, 0xd9d3c6, { jitter: 0.03 });
      g.box(0, 0.10, 0.403, 0.2, 0.04, 0.01, 0xfff3d0);
    } },
  ];
  const density = 0.012;                             // vehicles per km of road
  const totalKm = lookups.reduce((s, l) => s + l.lk.length, 0);
  const vehicles = [];
  for (const l of lookups) {
    const n = Math.max(1, Math.round(l.lk.length * density));
    for (let i = 0; i < n; i++) {
      let r = R(), kind = kinds[0];
      for (const k of kinds) { if (r < k.share) { kind = k; break; } r -= k.share; }
      vehicles.push({ road: l, kind, d: R() * l.lk.length, dir: R() < 0.5 ? 1 : -1, v: 0.05 + R() * 0.05, lane: R() < 0.5 ? -1 : 1 });
    }
  }
  const types = {};
  for (const k of kinds) {
    const n = vehicles.filter((v) => v.kind === k).length;
    if (!n) continue;
    const b = new Builder(k.name.length * 13), g = new Builder(3);
    k.build(b, g);
    const solid = new THREE.InstancedMesh(b.build(), stdMat({ roughness: 0.55, metalness: 0.1 }), n);
    solid.instanceMatrix.setUsage(THREE.DynamicDrawUsage); solid.castShadow = true; solid.name = `traffic-${k.name}`;
    group.add(solid);
    const gg = g.build();
    const glow = gg ? new THREE.InstancedMesh(gg, glowMat(), n) : null;
    if (glow) { glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(glow); }
    types[k.name] = { solid, glow, next: 0 };
  }
  for (const v of vehicles) v.idx = types[v.kind.name].next++;

  const _c = new THREE.Color();
  const place = (v) => {
    const p = v.road.lk.at(v.d);
    const off = v.lane * v.dir * (v.road.half * 0.5);
    const x = p.x - p.tz * off, z = p.z + p.tx * off;
    const y = terrain.heightAt(x, z) + ROAD.lift + 0.01;
    const rot = Math.atan2(p.tx * v.dir, p.tz * v.dir);
    const ty = types[v.kind.name];
    setInstance(ty.solid, v.idx, x, y, z, rot);
    if (ty.glow) setInstance(ty.glow, v.idx, x, y, z, rot);
  };
  vehicles.forEach(place);
  Object.values(types).forEach((t) => { t.solid.instanceMatrix.needsUpdate = true; if (t.glow) t.glow.instanceMatrix.needsUpdate = true; });

  return {
    group, roads, vehicles, count: vehicles.length, roadKm: totalKm,
    update(dt, moving, night, lightsOn) {
      if (moving) {
        for (const v of vehicles) {
          v.d += v.dir * v.v * dt;
          if (v.d > v.road.lk.length) { v.d = v.road.lk.length; v.dir = -1; }
          if (v.d < 0) { v.d = 0; v.dir = 1; }
          place(v);
        }
        Object.values(types).forEach((t) => { t.solid.instanceMatrix.needsUpdate = true; if (t.glow) t.glow.instanceMatrix.needsUpdate = true; });
      }
      const on = lightsOn ? 1 : Math.max(0.1, Math.min(1, (night - 0.35) * 2.2));
      _c.setScalar(on);
      Object.values(types).forEach((t) => { if (t.glow) t.glow.material.color.copy(_c); });
    },
  };
}
