import * as THREE from 'three';
import { makePathLookup } from './geo.js';
import { C, mixHex } from './palette.js';
import { paint, stdMat, setInstance } from './builder.js';

/**
 * The permanent way, draped on the terrain. Every graph edge is drawn once:
 * a ballast bed, two rails and instanced concrete sleepers. The vertical
 * profile is smoothed so lines run through hills (tunnel portals appear at
 * the mouths) and over valleys (piers appear under the deck). Trains read the
 * same profile back, so they sit exactly on the rails.
 *
 * Sizes are exaggerated ~300x so the track reads from the air.
 */
export const TRACK = {
  gauge: 0.175, ballastHalf: 0.40, railW: 0.06, railH: 0.05,
  sleeperEvery: 0.55, lift: 0.035, step: 0.25, smoothKm: 2.6,
  bridgeAbove: 0.16, tunnelBelow: 0.16,
};

export function createRails(network, terrain) {
  const group = new THREE.Group();
  group.name = 'rails';

  /* ------------------------------------------------------ node heights */
  const groundSmooth = (x, z) => {
    let s = 0, n = 0;
    for (let dx = -0.6; dx <= 0.6; dx += 0.6) for (let dz = -0.6; dz <= 0.6; dz += 0.6) { s += terrain.heightAt(x + dx, z + dz); n++; }
    return s / n;
  };
  const nodeH = network.nodes.map(([x, z]) => groundSmooth(x, z));

  /* ----------------------------------------------------- edge profiles */
  const W = Math.round(TRACK.smoothKm / TRACK.step);
  const profiles = network.edges.map((e) => {
    const lk = makePathLookup(e.pts);
    const n = Math.max(2, Math.ceil(lk.length / TRACK.step) + 1);
    const d = new Float32Array(n), raw = new Float32Array(n), h = new Float32Array(n);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const di = (lk.length * i) / (n - 1);
      const p = lk.at(di);
      d[i] = di; raw[i] = terrain.heightAt(p.x, p.z); pts.push(p);
    }
    // moving average keeps the gradient gentle
    for (let i = 0; i < n; i++) {
      let s = 0, k = 0;
      for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) { s += raw[j]; k++; }
      h[i] = s / k;
    }
    // pin the ends to the shared node heights so neighbouring edges meet
    const pin = Math.min(n - 1, Math.round(2.0 / TRACK.step));
    for (let i = 0; i <= pin; i++) { const t = i / pin; h[i] = nodeH[e.a] * (1 - t) + h[i] * t; }
    for (let i = 0; i <= pin; i++) { const t = i / pin; h[n - 1 - i] = nodeH[e.b] * (1 - t) + h[n - 1 - i] * t; }
    if (n === 2) { h[0] = nodeH[e.a]; h[1] = nodeH[e.b]; }
    return { edge: e, lk, d, raw, h, pts, length: lk.length };
  });

  /* --------------------------------------------------------- geometry */
  const positions = [], colors = [], normals = [];
  const cBallast = new THREE.Color(C.ballast), cBallastGen = new THREE.Color(mixHex(C.ballast, 0xd8c39c, 0.35));
  const cRail = new THREE.Color(C.rail), cDeck = new THREE.Color(C.concrete);
  const pushQuadStrip = (pts, ys, half, offset, col) => {
    // two triangles per segment between consecutive samples
    const L = [], R = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const nx = -p.tz, nz = p.tx;
      L.push([p.x + nx * (offset - half), ys[i], p.z + nz * (offset - half)]);
      R.push([p.x + nx * (offset + half), ys[i], p.z + nz * (offset + half)]);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const v of [L[i], R[i], R[i + 1], L[i], R[i + 1], L[i + 1]]) {
        positions.push(v[0], v[1], v[2]); normals.push(0, 1, 0); colors.push(col.r, col.g, col.b);
      }
    }
  };

  const sleepers = [], piers = [], portals = [];
  for (const pr of profiles) {
    const { edge: e, pts, h, raw, d } = pr;
    const ys = Array.from(h, (v) => v + TRACK.lift);
    const cb = e.real ? cBallast : cBallastGen;
    pushQuadStrip(pts, ys, TRACK.ballastHalf, 0, cb);
    const yr = ys.map((v) => v + TRACK.railH);
    pushQuadStrip(pts, yr, TRACK.railW / 2, -TRACK.gauge, cRail);
    pushQuadStrip(pts, yr, TRACK.railW / 2, TRACK.gauge, cRail);

    // sleepers, bridges and tunnel mouths along the edge
    let acc = 0, wasTunnel = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const above = h[i] - raw[i];
      const tunnel = above < -TRACK.tunnelBelow;
      const bridge = above > TRACK.bridgeAbove;
      if (i > 0) acc += d[i] - d[i - 1];
      if (acc >= TRACK.sleeperEvery && !tunnel) { sleepers.push([p.x, ys[i] + 0.012, p.z, Math.atan2(p.tx, p.tz)]); acc = 0; }
      if (bridge && i % 2 === 0) piers.push([p.x, raw[i], p.z, Math.atan2(p.tx, p.tz), above + TRACK.lift]);
      if (bridge) pushQuadStrip([pts[Math.max(0, i - 1)], p], [ys[Math.max(0, i - 1)] - 0.02, ys[i] - 0.02], TRACK.ballastHalf + 0.12, 0, cDeck);
      if (tunnel !== wasTunnel) portals.push([p.x, ys[i], p.z, Math.atan2(p.tx, p.tz)]);
      wasTunnel = tunnel;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const track = new THREE.Mesh(geo, stdMat({ roughness: 0.9 }));
  track.receiveShadow = true; track.castShadow = false;
  track.name = 'track';
  group.add(track);

  // sleepers: one instanced box
  const sleeperGeo = paint(new THREE.BoxGeometry(TRACK.gauge * 2 + 0.26, 0.02, 0.11).toNonIndexed(), C.sleeper, 0.08);
  const sleeperMesh = new THREE.InstancedMesh(sleeperGeo, stdMat({ roughness: 0.95 }), sleepers.length);
  sleepers.forEach(([x, y, z, rot], i) => setInstance(sleeperMesh, i, x, y, z, rot));
  sleeperMesh.instanceMatrix.needsUpdate = true;
  sleeperMesh.receiveShadow = true;
  sleeperMesh.name = 'sleepers';
  group.add(sleeperMesh);

  // piers under bridges (box from the ground to the deck, scaled per instance)
  const pierGeo = paint(new THREE.BoxGeometry(0.26, 1, 0.9).translate(0, 0.5, 0).toNonIndexed(), C.concrete, 0.06);
  const pierMesh = new THREE.InstancedMesh(pierGeo, stdMat(), Math.max(1, piers.length));
  piers.forEach(([x, y, z, rot, hgt], i) => setInstance(pierMesh, i, x, y - 0.05, z, rot, 1, hgt + 0.02, 1));
  pierMesh.count = piers.length;
  pierMesh.instanceMatrix.needsUpdate = true;
  pierMesh.castShadow = true;
  pierMesh.name = 'piers';
  group.add(pierMesh);

  // tunnel portals: a stone arch face across the track
  const portalGeo = paint(new THREE.BoxGeometry(2.2, 0.95, 0.35).translate(0, 0.42, 0).toNonIndexed(), C.stoneDark, 0.08);
  const portalMesh = new THREE.InstancedMesh(portalGeo, stdMat(), Math.max(1, portals.length));
  portals.forEach(([x, y, z, rot], i) => setInstance(portalMesh, i, x, y - 0.04, z, rot));
  portalMesh.count = portals.length;
  portalMesh.instanceMatrix.needsUpdate = true;
  portalMesh.castShadow = true;
  portalMesh.name = 'portals';
  group.add(portalMesh);

  /* --------------------------------------------------- route profiles */
  const routes = network.routes.map((r) => {
    const lookup = makePathLookup(r.pts);
    const D = [], H = [];
    let base = 0;
    for (const { e, dir } of r.edges) {
      const pr = profiles[e];
      const n = pr.d.length;
      for (let k = 0; k < n; k++) {
        const i = dir === 1 ? k : n - 1 - k;
        const dd = dir === 1 ? pr.d[i] : pr.length - pr.d[i];
        if (D.length && dd + base <= D[D.length - 1] + 1e-6) continue;
        D.push(base + dd); H.push(pr.h[i]);
      }
      base += pr.length;
    }
    const heightAt = (dist) => {
      dist = Math.max(0, Math.min(D[D.length - 1], dist));
      let lo = 0, hi = D.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (D[mid] <= dist) lo = mid; else hi = mid; }
      const t = (dist - D[lo]) / ((D[hi] - D[lo]) || 1);
      return H[lo] + (H[hi] - H[lo]) * t + TRACK.lift;
    };
    return { ...r, lookup, heightAt, length: lookup.length };
  });

  return { group, routes, profiles, stats: { sleepers: sleepers.length, piers: piers.length, portals: portals.length, trackVerts: positions.length / 3 } };
}
