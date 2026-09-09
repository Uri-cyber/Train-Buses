import * as THREE from 'three';
import { OUTLINE_LAYER } from './post.js';
import { Builder, stdMat, glowMat, setInstance, rng, paint, _m4 as M4, _q as Q, _v as V, _s as S } from './builder.js';
import { labelTexture } from './labels.js';
import { C, smoothstep } from './palette.js';
import { TRACK } from './rails.js';
import { tripProgress, tripsForDay } from './timetable.js';

/**
 * Rolling stock and its motion. Three families: modern Israel Railways
 * (blue/red loco with double-deck coaches), the heritage steam train of the
 * Valley Railway, and freight (potash hoppers, container flats). Every
 * vehicle type is one InstancedMesh (plus one for its lit parts), so thirty
 * trains cost a handful of draw calls.
 *
 * Vehicles are toys: about 250x wider than life and squat in length, so they
 * read from the air. Every line is double track with left-hand running (the
 * Israel Railways convention); a headway rule keeps followers off the train
 * ahead. In local space +z is forward and y = 0 is the railhead.
 */

const W = 0.62;                    // body width (before SCALE)
const cols = C.container;
export const SCALE = 1.5;          // vehicles are built at unit scale, then blown up
const ZS = 0.65;                   // ...and squashed along the track so they stay stubby

const CATALOGUE = {
  irLoco: { len: 2.2, build(b, g) {
    b.box(0, 0.33, 0, W, 0.40, 2.2, C.irBlue, { jitter: 0.02 });
    b.box(0, 0.24, 0, W + 0.01, 0.07, 2.21, C.irRed);                       // waist stripe
    for (const s of [-1, 1]) {
      b.box(0, 0.36, s * 0.98, W + 0.01, 0.34, 0.26, C.irWhite);           // cab ends
      g.box(0, 0.42, s * 1.108, 0.46, 0.14, 0.01, 0x1a2430);               // windscreen
      g.box(0.18, 0.20, s * 1.108, 0.14, 0.10, 0.01, s > 0 ? 0xfff3d0 : 0xff2a1a);   // lamps
      g.box(-0.18, 0.20, s * 1.108, 0.14, 0.10, 0.01, s > 0 ? 0xfff3d0 : 0xff2a1a);
      b.box(0, 0.12, s * 0.72, 0.52, 0.12, 0.62, 0x2a2e33);                // bogies
    }
    b.box(0, 0.55, 0, W - 0.08, 0.05, 1.9, C.irGrey);                       // roof
    b.box(0, 0.60, -0.3, 0.3, 0.06, 0.5, 0x3b4148);                         // roof gear
    b.box(0, 0.10, 0, 0.52, 0.06, 2.1, 0x2a2e33);                           // frame
  } },
  irCoach: { len: 2.3, build(b, g) {
    b.box(0, 0.22, 0, W, 0.22, 2.3, C.irBlue, { jitter: 0.02 });
    b.box(0, 0.335, 0, W + 0.01, 0.03, 2.31, C.irRed);
    b.box(0, 0.50, 0, W, 0.30, 2.3, C.irWhite, { jitter: 0.02 });
    b.box(0, 0.665, 0, W - 0.06, 0.03, 2.2, C.irGrey);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const z = -0.93 + i * 0.31;
        g.box(s * (W / 2 + 0.004), 0.55, z, 0.01, 0.13, 0.22, C.windowLit, { jitter: 0.08 });   // upper deck
        g.box(s * (W / 2 + 0.004), 0.25, z, 0.01, 0.10, 0.22, C.windowLit, { jitter: 0.08 });   // lower deck
      }
      b.box(0, 0.10, s * 0.78, 0.52, 0.10, 0.5, 0x2a2e33);
    }
    b.box(0, 0.10, 0, 0.5, 0.05, 2.2, 0x2a2e33);
  } },
  steamLoco: { len: 1.8, build(b, g) {
    b.box(0, 0.16, 0, W, 0.10, 1.8, C.steamBlack);                           // frames
    b.cyl(0, 0.44, 0.15, 0.20, 1.15, C.steamBlack, 14, { rotX: Math.PI / 2 });   // boiler
    b.cyl(0, 0.44, 0.74, 0.21, 0.08, 0x3a3e44, 14, { rotX: Math.PI / 2 });      // smokebox
    b.cyl(0, 0.74, 0.62, 0.06, 0.28, C.steamBlack, 10);                      // chimney
    b.cyl(0, 0.68, 0.25, 0.09, 0.10, C.brass, 10);                           // dome
    b.box(0, 0.44, -0.55, W, 0.50, 0.55, C.steamGreen, { jitter: 0.03 });   // cab
    b.box(0, 0.72, -0.55, W + 0.04, 0.05, 0.6, C.steamBlack);               // cab roof
    g.box(0, 0.50, -0.27, 0.36, 0.14, 0.01, 0x2b2410);                       // cab window
    g.box(0, 0.50, 0.90, 0.16, 0.12, 0.01, 0xfff0c0);                        // headlamp
    b.box(0, 0.20, 0.88, W, 0.10, 0.04, C.irRed);                            // buffer beam
    for (const s of [-1, 1]) for (const z of [-0.15, 0.2, 0.55]) b.cyl(s * 0.27, 0.13, z, 0.13, 0.05, 0xb3402e, 12, { rotZ: Math.PI / 2 });
    b.box(0, 0.08, 0, 0.3, 0.05, 1.5, 0x1d1f22);
  } },
  steamTender: { len: 1.2, build(b) {
    b.box(0, 0.16, 0, W, 0.10, 1.2, C.steamBlack);
    b.box(0, 0.42, 0, W - 0.02, 0.42, 1.15, C.steamGreen, { jitter: 0.03 });
    b.box(0, 0.62, -0.05, W - 0.14, 0.08, 0.8, 0x141414, { jitter: 0.25 });  // coal
    for (const s of [-1, 1]) for (const z of [-0.35, 0.35]) b.cyl(s * 0.27, 0.12, z, 0.10, 0.05, 0x2a2e33, 10, { rotZ: Math.PI / 2 });
  } },
  woodCoach: { len: 1.9, build(b, g) {
    b.box(0, 0.16, 0, W - 0.04, 0.08, 1.9, C.steamBlack);
    b.box(0, 0.42, 0, W, 0.44, 1.85, C.woodCoach, { jitter: 0.04 });
    b.box(0, 0.56, 0, W + 0.01, 0.10, 1.86, 0xe8dcc0);                       // cream band
    b.box(0, 0.68, 0, W - 0.04, 0.05, 1.8, 0x3a3230);                        // roof
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) g.box(s * (W / 2 + 0.004), 0.47, -0.7 + i * 0.35, 0.01, 0.14, 0.2, 0xffe2a0, { jitter: 0.08 });
      for (const z of [-0.6, 0.6]) b.box(0, 0.10, z, 0.5, 0.10, 0.4, 0x2a2e33);
    }
  } },
  hopper: { len: 1.6, build(b) {
    b.box(0, 0.42, 0, W, 0.42, 1.55, C.potash, { jitter: 0.04 });
    b.box(0, 0.64, 0, W - 0.06, 0.04, 1.5, 0x6f7578);
    b.box(0, 0.63, 0, W - 0.16, 0.05, 1.3, 0xd9d6cf, { jitter: 0.15 });      // potash load
    for (const s of [-1, 1]) b.box(0, 0.22, s * 0.62, W, 0.3, 0.32, C.potash, { rotX: s * 0.5 });
    b.box(0, 0.12, 0, 0.5, 0.06, 1.5, 0x2a2e33);
    for (const z of [-0.55, 0.55]) b.box(0, 0.10, z, 0.5, 0.10, 0.4, 0x2a2e33);
  } },
  flat: { len: 1.8, build(b) {
    b.box(0, 0.20, 0, W, 0.08, 1.8, 0x5a5f66);
    for (const z of [-0.65, 0.65]) b.box(0, 0.10, z, 0.5, 0.10, 0.4, 0x2a2e33);
    b.box(0, 0.45, 0, W - 0.06, 0.42, 1.45, cols[Math.floor(b.rng() * cols.length)], { jitter: 0.03 });
    b.box(0, 0.45, 0, W - 0.05, 0.36, 0.05, 0xf0f0ea);                       // door end mark
  } },
};

const CONSISTS = {
  passenger: ['irLoco', 'irCoach', 'irCoach', 'irCoach', 'irCoach'],
  heritage: ['steamLoco', 'steamTender', 'woodCoach', 'woodCoach', 'woodCoach'],
  freightHopper: ['irLoco', 'hopper', 'hopper', 'hopper', 'hopper', 'hopper'],
  freightFlat: ['irLoco', 'flat', 'flat', 'flat', 'flat', 'flat'],
};
const SPEEDS = { passenger: 0.42, heritage: 0.22, freight: 0.30 };  // km per second at lever = 0.5
const ACCEL = 0.22;
const GAP = 0.08 * SCALE;          // coupling gap between cars
const MOVING_V = 0.02;             // below this a train is standing (km/s)
let elapsed = 0;                   // seconds since start, for the coach sway
const _e = new THREE.Euler();
const wrapPi = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createTrains(rails, terrain, stationsById = null, { schedule = null } = {}) {
  const group = new THREE.Group();
  group.name = 'trains';
  const R = rng(99);
  const scheduled = !!schedule;

  /* ---------------------------------------------------- what runs */
  // toy mode: a made-up service, more trains on long routes, alternating directions
  const plans = [];
  if (!scheduled) {
    for (const route of rails.routes) {
      const consist = route.kind === 'heritage' ? 'heritage'
        : route.kind === 'freight' ? (route.id === 'phosphate' ? 'freightHopper' : 'freightFlat') : 'passenger';
      const n = Math.max(1, Math.min(4, 1 + Math.floor(route.length / 50)));
      const nCars = consist === 'passenger' ? (route.length < 40 ? 3 : 4)
        : consist === 'heritage' ? 4 : 5;
      for (let k = 0; k < n; k++) {
        const cars = CONSISTS[consist].slice(0, nCars);
        const dir = k % 2 === 0 ? 1 : -1;
        plans.push({ id: `${route.id}#${k}`, route, consist, cars, dir, start: ((k + 0.5) / n + (R() - 0.5) * 0.1) * route.length });
      }
    }
  }

  // timetable mode: every trip of the day, on a route computed through its calling points
  const sched = scheduled ? prepareSchedule(schedule, rails, stationsById) : null;
  const SLOT_CARS = CONSISTS.passenger.slice(0, 4);

  // instanced meshes per vehicle type; in timetable mode a pool of slots big
  // enough for the busiest moment of the day
  const counts = {};
  if (scheduled) { for (const t of SLOT_CARS) counts[t] = (counts[t] || 0) + sched.slots; }
  else for (const p of plans) for (const t of p.cars) counts[t] = (counts[t] || 0) + 1;
  const types = {};
  for (const [name, spec] of Object.entries(CATALOGUE)) {
    const n = counts[name] || 0;
    if (!n) continue;
    const b = new Builder(name.length * 31), g = new Builder(7);
    spec.build(b, g);
    const solidGeo = b.build(), glowGeo = g.build();
    solidGeo.scale(SCALE, SCALE, SCALE * ZS); if (glowGeo) glowGeo.scale(SCALE, SCALE, SCALE * ZS);
    const solid = new THREE.InstancedMesh(solidGeo, stdMat({ roughness: 0.6, metalness: 0.08 }), n);
    solid.layers.enable(OUTLINE_LAYER);
    solid.castShadow = true; solid.receiveShadow = true; solid.name = `train-${name}`;
    solid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(solid);
    let glow = null;
    if (glowGeo) {
      glow = new THREE.InstancedMesh(glowGeo, glowMat(), n);
      glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // per-car window level: coaches light up one by one at dusk, the last one carries a red tail
      glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      glow.instanceColor.setUsage(THREE.DynamicDrawUsage);
      glow.name = `train-${name}-glow`;
      group.add(glow);
    }
    const free = [];
    for (let i = n - 1; i >= 0; i--) free.push(i);
    types[name] = { solid, glow, next: 0, free, len: spec.len * SCALE * ZS };
  }
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const ty of Object.values(types)) for (let i = 0; i < ty.solid.count; i++) { ty.solid.setMatrixAt(i, ZERO); if (ty.glow) ty.glow.setMatrixAt(i, ZERO); }

  let trains;
  const maxSlots = scheduled ? sched.slots : plans.length;
  if (scheduled) {
    const freeSlots = [];
    for (let i = maxSlots - 1; i >= 0; i--) freeSlots.push(i);
    trains = sched.runs.map((run) => ({
      id: run.id, route: run.route, cars: null, total: run.total, kind: 'passenger', d: run.stopD[0], dir: 1, side: 1, v: 0, dwell: 0,
      head: { x: 0, y: 0, z: 0, tx: 0, tz: 1 }, active: false, slot: -1, sched: run, freeSlots,
    }));
  } else {
    const placed = [];                               // sampled body points of trains placed so far
    const bodyPoints = (route, d, dir, total) => {
      const pts = [];
      for (let back = 0; back <= total; back += 1.2) { const p = route.lookup.at(d - dir * back); pts.push([p.x, p.z]); }
      return pts;
    };
    const clear = (pts) => pts.every(([x, z]) => placed.every(([px, pz]) => Math.hypot(px - x, pz - z) > 3.2));
    trains = plans.map((p, slot) => {
      const cars = p.cars.map((t) => ({ type: t, idx: types[t].free.pop(), len: types[t].len, onAt: 0.30 + R() * 0.45, level: R() < 0.08 ? 0.15 : 0.75 + R() * 0.35 }));
      const total = cars.reduce((s, c) => s + c.len + GAP, 0);
      const kind = p.route.kind === 'heritage' ? 'heritage' : p.route.kind === 'freight' ? 'freight' : 'passenger';
      // start somewhere that overlaps no train already placed (shared corridors, junctions)
      const lo = total * 0.55, hi = p.route.length - total * 0.55;
      let d = Math.max(lo, Math.min(hi, p.start)), pts = bodyPoints(p.route, d, p.dir, total);
      for (let k = 1; k <= 40 && !clear(pts); k++) {
        d = lo + ((p.start - lo + k * 7.3) % Math.max(1, hi - lo));
        pts = bodyPoints(p.route, d, p.dir, total);
      }
      placed.push(...pts);
      return {
        id: p.id, route: p.route, cars, total, kind, d, dir: p.dir, side: p.dir, v: 0, dwell: 0, stopIdx: -1, blockedT: 0, graceT: 0,
        head: { x: 0, y: 0, z: 0, tx: 0, tz: 1 },    // world position of the front, travel tangent
        active: true, slot,
      };
    });
  }

  const glowMats = Object.values(types).filter((t) => t.glow).map((t) => t.glow.material);

  /* ------------------------------------------------------------- motion */
  // next stop ahead of the train head in its direction of travel; stops the
  // train is already standing across are skipped
  const nextStop = (t) => {
    const stops = t.route.stops;
    const skip = Math.max(0.3, t.total * 0.4);
    if (t.dir === 1) { for (const s of stops) if (s.d > t.d + skip) return s.d; return t.route.length; }
    for (let i = stops.length - 1; i >= 0; i--) if (stops[i].d < t.d - skip) return stops[i].d;
    return 0;
  };

  // left-hand running: the lane sits left of the direction of travel
  const lane = (p, t) => {
    const off = t.side * TRACK.laneOffset;
    return { x: p.x + p.tz * off, z: p.z - p.tx * off };
  };
  const yawAt = (lk, d, dir) => { const p = lk.at(d); return Math.atan2(p.tx * dir, p.tz * dir); };
  // every car is placed about its own centre (position = the lane sample, which the
  // rails check reads); pitch follows the grade and roll leans into the bend. Both are
  // eased over about a third of a second: the heightfield has flat facets and the route
  // is a polyline, so the raw values step from frame to frame and a train built out of
  // them shivers. A real lean lasts seconds and comes through the easing untouched.
  let frameDt = 0;
  const place = (t) => {
    const k = frameDt > 0 ? 1 - Math.exp(-frameDt * 3) : 1;
    const lk = t.route.lookup;
    let back = 0;                                   // distance from the head, along the train
    let carIndex = 0;
    for (const car of t.cars) {
      const dc = t.d - t.dir * (back + car.len / 2);
      const a = lane(lk.at(dc - t.dir * car.len * 0.34), t), b = lane(lk.at(dc + t.dir * car.len * 0.34), t);
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      const rot = Math.atan2(b.x - a.x, b.z - a.z);
      const y = t.route.heightAt(dc) + TRACK.railH;
      // nose up on a climb: local +z points at sample b, a positive X rotation drops the nose
      const ha = t.route.heightAt(dc - t.dir * car.len * 0.34), hb = t.route.heightAt(dc + t.dir * car.len * 0.34);
      const pitchRaw = -Math.atan2(hb - ha, car.len * 0.68);
      // lean into the bend: yaw change over the car, scaled by speed (a left turn is a positive
      // yaw change; +y leans to -x under a positive Z roll, so negate). Kept to about two
      // degrees: any more and a train reads as shivering rather than leaning.
      const turn = wrapPi(yawAt(lk, dc + t.dir * car.len * 0.6, t.dir) - yawAt(lk, dc - t.dir * car.len * 0.6, t.dir));
      const rollRaw = clamp(-turn * t.v * 1.1, -0.04, 0.04);
      // a car that has just appeared, or was reused by another train, starts where it is
      car.pitch = car.pitch === undefined || Math.abs(pitchRaw - car.pitch) > 0.08 ? pitchRaw : car.pitch + (pitchRaw - car.pitch) * k;
      car.roll = car.roll === undefined || Math.abs(rollRaw - car.roll) > 0.08 ? rollRaw : car.roll + (rollRaw - car.roll) * k;
      Q.setFromEuler(_e.set(car.pitch, rot, car.roll, 'YXZ'));
      M4.compose(V.set(x, y, z), Q, S.set(1, 1, 1));
      const ty = types[car.type];
      ty.solid.setMatrixAt(car.idx, M4);
      if (ty.glow) ty.glow.setMatrixAt(car.idx, M4);
      back += car.len + GAP;
      carIndex++;
    }
    const h = lk.at(t.d), hp = lane(h, t);
    t.head.x = hp.x; t.head.z = hp.z; t.head.y = t.route.heightAt(t.d) + TRACK.railH;
    t.head.tx = h.tx * t.dir; t.head.tz = h.tz * t.dir;
  };
  for (const t of trains) if (t.active) place(t);

  // the closest a train may run to the one ahead, given both speeds; and a
  // stop before any train crossing the line ahead (junctions, station throats)
  const BODY = 0.62 * SCALE;                          // body width, km
  const crossing = (t, o) => {
    // does any part of o lie in the box just ahead of t's head? Trains running
    // parallel on the other track are not in the way, only trains at an angle
    // or genuinely on our line
    const H = t.head;
    const dot = Math.abs(H.tx * o.head.tx + H.tz * o.head.tz);
    const tol = dot > 0.6 ? 0.55 : BODY + 0.4;
    const n = Math.max(2, Math.ceil(o.total / 1.5));
    let nearest = Infinity;
    for (let i = 0; i <= n; i++) {
      const back = (o.total * i) / n;
      const px = o.head.x - o.head.tx * back, pz = o.head.z - o.head.tz * back;
      const dx = px - H.x, dz = pz - H.z;
      const ahead = dx * H.tx + dz * H.tz;
      const lateral = Math.abs(dx * H.tz - dz * H.tx);
      if (ahead > -0.3 && ahead < 5.0 && lateral < tol) nearest = Math.min(nearest, ahead);
    }
    return nearest;
  };
  const headwayLimit = (t) => {
    let limit = Infinity;
    const H = t.head;
    t.heldBy = null;
    for (const o of trains) {
      if (o === t) continue;
      const dot = H.tx * o.head.tx + H.tz * o.head.tz;
      const dx = o.head.x - H.x, dz = o.head.z - H.z;
      const ahead = dx * H.tx + dz * H.tz;
      const lateral = Math.abs(dx * H.tz - dz * H.tx);
      if (dot >= 0.5 && lateral <= 1.2 && ahead > -1.0 && ahead <= o.total + 12) {
        // same lane, same way
        if (ahead <= o.total + 2) {
          // overlapping (trains start that way, or met at a junction): the one behind, or on a
          // tie the higher id, drops back until the gap opens
          if (ahead > 1.0 || t.id > o.id) { const l = Math.max(0, o.v * 0.4 - 0.05); if (l < limit) { limit = l; t.heldBy = `overlap ${o.id} ahead=${ahead.toFixed(1)} lat=${lateral.toFixed(2)}`; } }
          continue;
        }
        // keep a gap that closes only as fast as braking allows
        const room = ahead - o.total - 2;
        const l = o.v + Math.sqrt(2 * ACCEL * room);
        if (l < limit) { limit = l; t.heldBy = `follow ${o.id} ahead=${ahead.toFixed(1)}`; }
        continue;
      }
      if (Math.hypot(dx, dz) > o.total + 6) continue;
      // anything else in our path: wait for it to clear. If we block each other,
      // whoever is further into the junction goes first
      const near = crossing(t, o);
      if (near === Infinity) continue;
      const theirs = crossing(o, t);
      if (theirs !== Infinity && (near < theirs || (near === theirs && t.id < o.id))) continue;
      const l = Math.sqrt(2 * ACCEL * Math.max(0, near - 1.4));
      if (l < limit) { limit = l; t.heldBy = `cross ${o.id} near=${near.toFixed(1)} dot=${dot.toFixed(2)} lat=${lateral.toFixed(2)} ov=${o.v.toFixed(2)}`; }
    }
    return limit;
  };

  /* ------------------------------------------------------ dressing */
  // smoke: a ring of toon puffs fed from the chimneys and exhausts
  const PUFFS = 240, PUFF_LIFE = 3.2;
  const puffGeo = paint(new THREE.IcosahedronGeometry(1, 1).toNonIndexed(), 0xffffff, 0);
  const smoke = new THREE.InstancedMesh(puffGeo, stdMat(), PUFFS);
  smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  smoke.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS * 3).fill(1), 3);
  smoke.instanceColor.setUsage(THREE.DynamicDrawUsage);
  smoke.castShadow = false; smoke.name = 'smoke';
  smoke.layers.enable(OUTLINE_LAYER);
  group.add(smoke);
  const puffs = Array.from({ length: PUFFS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: PUFF_LIFE, big: 1 }));
  let puffNext = 0;
  for (let i = 0; i < PUFFS; i++) smoke.setMatrixAt(i, ZERO);
  const SMOKE = {
    heritage: { rate: 7, colour: [0.96, 0.96, 0.96], at: [0, 0.74 * SCALE + 0.16 * SCALE, 0.62 * SCALE * ZS], big: 1.0 },
    freight: { rate: 3, colour: [0.48, 0.5, 0.53], at: [0, 0.63 * SCALE, -0.3 * SCALE * ZS], big: 0.7 },
  };
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3();
  const emit = (t, spec) => {
    const car = t.cars[0], ty = types[car.type];
    ty.solid.getMatrixAt(car.idx, _m);
    _v.set(spec.at[0], spec.at[1], spec.at[2] * (t.dir === 1 ? 1 : -1)).applyMatrix4(_m);
    const p = puffs[puffNext];
    p.x = _v.x + (Math.random() - 0.5) * 0.1; p.y = _v.y; p.z = _v.z + (Math.random() - 0.5) * 0.1;
    p.vx = -t.head.tx * t.v * 0.35 + (Math.random() - 0.5) * 0.08; p.vz = -t.head.tz * t.v * 0.35 + (Math.random() - 0.5) * 0.08;
    p.vy = 0.28 + Math.random() * 0.1; p.age = 0; p.big = spec.big;
    smoke.instanceColor.setXYZ(puffNext, spec.colour[0], spec.colour[1], spec.colour[2]);
    puffNext = (puffNext + 1) % PUFFS;
  };
  const smokeAcc = new Map();

  // headlights: an additive cone ahead of every train, on at night
  const beamGeo = new THREE.ConeGeometry(0.55 * SCALE, 2.2 * SCALE, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 1.1 * SCALE);
  const beams = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }), Math.max(1, maxSlots));
  for (let i = 0; i < beams.count; i++) beams.setMatrixAt(i, ZERO);
  beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  beams.name = 'headlights'; beams.renderOrder = 5;
  group.add(beams);
  // the pool of light each headlight throws on the track ahead: a flat disc that
  // stretches with speed. Additive and faint, so from above it never reads as paint.
  const poolGeo = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.10, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }), Math.max(1, maxSlots));
  for (let i = 0; i < pools.count; i++) pools.setMatrixAt(i, ZERO);
  pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pools.name = 'headlight pools'; pools.renderOrder = 4; pools.castShadow = false; pools.receiveShadow = false;
  group.add(pools);

  // name plates: route and next stop, floating over the front of the train
  const stationName = (id, key) => (stationsById && stationsById[id] ? stationsById[id][key] : '');
  const nextStopId = (t) => {
    const stops = t.route.stops;
    if (!stops.length) return null;
    const skip = Math.max(0.3, t.total * 0.4);
    if (t.dir === 1) { for (const s of stops) if (s.d > t.d + skip) return s.id; return stops[stops.length - 1].id; }
    for (let i = stops.length - 1; i >= 0; i--) if (stops[i].d < t.d - skip) return stops[i].id;
    return stops[0].id;
  };
  const ensurePlate = (t) => {
    if (t.plate) return;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, transparent: true, depthTest: false, sizeAttenuation: false, fog: false }));
    sprite.scale.set(0.17, 0.05, 1);
    sprite.center.set(0.5, -0.4);
    sprite.renderOrder = 21;
    sprite.visible = false;
    group.add(sprite);
    t.plate = sprite; t.plateStop = undefined;
  };
  for (const t of trains) if (t.active) ensurePlate(t);
  const refreshPlate = (t) => {
    ensurePlate(t);
    const id = nextStopId(t);
    if (id === t.plateStop) return;
    t.plateStop = id;
    if (t.plate.material.map) t.plate.material.map.dispose();
    const he = id ? `${t.route.he}  ⟵  ${stationName(id, 'he')}` : t.route.he;
    const en = id ? `${t.route.en}  ·  next: ${stationName(id, 'en')}` : t.route.en;
    t.plate.material.map = labelTexture(he, en, { w: 900, h: 160, plate: t.kind === 'heritage' ? 'rgba(70, 40, 20, 0.92)' : t.kind === 'freight' ? 'rgba(40, 46, 52, 0.92)' : 'rgba(17, 45, 96, 0.92)', border: t.kind === 'heritage' ? '#d4a83a' : '#d0342c' });
    t.plate.material.needsUpdate = true;
  };

  /* --------------------------------------------- timetable running */
  const activate = (t) => {
    if (t.active) return true;
    if (!t.freeSlots.length) return false;
    t.slot = t.freeSlots.pop();
    t.cars = SLOT_CARS.map((name) => ({ type: name, idx: types[name].free.pop(), len: types[name].len, onAt: 0.30 + R() * 0.45, level: R() < 0.08 ? 0.15 : 0.75 + R() * 0.35 }));
    t.active = true;
    activatedThisFrame = true;
    return true;
  };
  const deactivate = (t) => {
    if (!t.active) return;
    for (const car of t.cars) {
      car.pitch = undefined; car.roll = undefined;      // the next train to use this car starts level
      const ty = types[car.type];
      ty.solid.setMatrixAt(car.idx, ZERO);
      if (ty.glow) { ty.glow.setMatrixAt(car.idx, ZERO); ty.glow.instanceColor.setXYZ(car.idx, 1, 1, 1); ty.glow.instanceColor.needsUpdate = true; }
      ty.free.push(car.idx);
    }
    beams.setMatrixAt(t.slot, ZERO);
    pools.setMatrixAt(t.slot, ZERO);
    t.freeSlots.push(t.slot); t.slot = -1; t.cars = null; t.active = false; t.v = 0;
    if (t.plate) t.plate.visible = false;
  };
  let replay = false, activeNow = 0, dayKey = null, activatedThisFrame = false, lastT = null;
  const runScheduled = (dt, clock) => {
    frameDt = dt;
    // the day's trips are chosen once per Israeli calendar day
    if (clock.ymd !== dayKey) { dayKey = clock.ymd; sched.selectDay(clock.ymd, clock.weekday); }
    // quiet hours (Shabbat, the small hours): replay a weekday morning so the screen is never empty
    let T = clock.T;
    const live = sched.countActive(T);
    replay = live < 3 && sched.hasReplay;
    if (replay) T = sched.replayTime(T);
    const dT = lastT === null ? 0 : Math.abs(T - lastT) > 600 ? 0 : T - lastT;   // ignore the wrap at midnight
    lastT = T;
    activeNow = 0;
    for (const t of trains) {
      const run = t.sched;
      if (!(replay ? run.wk : run.today)) { deactivate(t); continue; }
      const prog = tripProgress(run.stops, T - (replay ? 0 : run.offset + (run.delay || 0)));
      if (!prog) { deactivate(t); continue; }
      if (!activate(t)) continue;
      activeNow++;
      // a live train sits on the leg it was last reported on; the fraction along that leg
      // still comes from the timetable, because no public feed gives a position between stations
      const seg = run.liveSeg >= 0 && run.liveSeg < run.stopD.length - 1 && !replay
        ? Math.max(run.liveSeg, Math.min(run.liveSeg + 1, prog.i)) : prog.i;
      const d0 = run.stopD[seg], d1 = run.stopD[Math.min(seg + 1, run.stopD.length - 1)];
      const target = Math.max(t.total * 0.55, Math.min(t.route.length - t.total * 0.55, d0 + (d1 - d0) * prog.f));
      // speed comes from how far the timetable clock moved, not from how long the frame took:
      // a slow frame or a throttled tab would otherwise read as a train doing 500 km/h
      const raw = dT > 0 ? Math.abs(target - t.d) / dT : 0;
      t.v = raw > 3 ? 0 : t.v * 0.8 + raw * 0.2;
      t.phase = prog.phase; t.toDep = prog.toDep;
      t.d = target;
      t.dwell = prog.stopped ? 1 : 0;
      place(t);
    }
  };

  let lastNight = -1, lastOn = null;
  for (const m of glowMats) m.color.setScalar(1);
  const _f = new THREE.Vector3();
  return {
    group, trains, types, SCALE, smoke, beams, pools, scheduled,
    get replay() { return replay; },
    get activeCount() { return scheduled ? activeNow : trains.length; },
    get source() { return scheduled ? sched.source : 'toy'; },
    /** live delays from Israel Railways (see live.js): how many of today's runs were matched */
    get live() { return scheduled ? sched.live : null; },
    applyLive(digest) { if (scheduled) sched.applyLive(digest); },
    /**
     * @param speedLever 0..1  @param night 0..1  @param lightsOn force lights
     * @param focus      world point the viewer looks at (plates show near it)
     * @param followedId id of the train the tour is riding, whose plate always shows
     * @param viewDist   camera distance to the focus (km): plates hide when you are far out
     * @param clock      { T: seconds after Israel midnight, ymd, weekday } for the timetable
     */
    update(dt, speedLever, night, lightsOn, focus = null, followedId = null, viewDist = 0, clock = null) {
      elapsed += dt;
      frameDt = dt;
      activatedThisFrame = false;
      if (scheduled) runScheduled(dt, clock || { T: 12 * 3600, ymd: '20260101', weekday: 4 });
      else {
        const factor = 0.15 + speedLever * 2.2;
        for (const t of trains) {
          const vmax = SPEEDS[t.kind] * factor;
          // slide over to the other track after turning round, and only then set off
          const ds = Math.max(-0.7 * dt, Math.min(0.7 * dt, t.dir - t.side));
          t.side += ds;
          if (t.dwell > 0 || Math.abs(t.dir - t.side) > 0.02) { t.dwell = Math.max(0, t.dwell - dt); t.v = 0; }
          else {
            const target = nextStop(t);
            const remaining = Math.abs(target - t.d);
            let allowed = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, remaining - 0.02)));
            // other trains may hold us; but a train held for long is in a knot of trains all
            // waiting for each other, so it gets a few seconds of right of way to untie it
            if (t.graceT > 0) t.graceT -= dt;
            else {
              const held = headwayLimit(t);
              if (held < allowed) {
                allowed = held;
                if (held < 0.03) { t.blockedT += dt; if (t.blockedT > 9) { t.blockedT = 0; t.graceT = 12; } }
                else t.blockedT = Math.max(0, t.blockedT - dt);
              } else t.blockedT = Math.max(0, t.blockedT - dt);
            }
            t.v = t.v < allowed ? Math.min(allowed, t.v + ACCEL * dt) : allowed;
            const step = Math.min(t.v * dt, remaining);
            t.d += t.dir * step;
            if (remaining - step < 0.03) {
              // arrived: dwell, and turn round at the ends of the line
              const atEnd = t.d <= t.total * 0.55 + 0.05 || t.d >= t.route.length - t.total * 0.55 - 0.05;
              t.dwell = atEnd ? 4 : 1.5;
              if (atEnd) t.dir = t.d <= t.route.length / 2 ? 1 : -1;
            }
          }
          // keep the whole train on the line when it turns round at a terminus
          t.d = Math.max(t.total * 0.55, Math.min(t.route.length - t.total * 0.55, t.d));
          place(t);
        }
      }
      for (const ty of Object.values(types)) {
        ty.solid.instanceMatrix.needsUpdate = true;
        if (ty.glow) ty.glow.instanceMatrix.needsUpdate = true;
      }
      // windows: each coach comes up at its own moment of dusk, the last coach's panes read red.
      // The buffers are rewritten only when dusk has moved, the switch flipped, or a train appeared
      if (Math.abs(night - lastNight) > 0.01 || lightsOn !== lastOn || activatedThisFrame) {
        lastNight = night; lastOn = lightsOn;
        for (const t of trains) {
          if (!t.active) continue;
          const last = t.cars.length - 1;
          for (let i = 0; i <= last; i++) {
            const car = t.cars[i], ty = types[car.type];
            if (!ty.glow) continue;
            const c = Math.max(0.12, lightsOn ? 1 : car.level * smoothstep(car.onAt - 0.08, car.onAt + 0.08, night));
            if (i === last) ty.glow.instanceColor.setXYZ(car.idx, Math.min(1.4, c * 1.25), c * 0.55, c * 0.55);
            else ty.glow.instanceColor.setXYZ(car.idx, c, c, c);
            ty.glow.instanceColor.needsUpdate = true;
          }
        }
      }

      // smoke
      for (const t of trains) {
        const spec = SMOKE[t.kind];
        if (!spec || !t.active) continue;
        const acc = (smokeAcc.get(t) || 0) + dt * spec.rate * (0.25 + t.v * 1.6);
        let n = Math.floor(acc); smokeAcc.set(t, acc - n);
        while (n-- > 0) emit(t, spec);
      }
      for (let i = 0; i < PUFFS; i++) {
        const p = puffs[i];
        if (p.age >= PUFF_LIFE) continue;
        p.age += dt;
        if (p.age >= PUFF_LIFE) { smoke.setMatrixAt(i, ZERO); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const k = p.age / PUFF_LIFE;
        const sc = (0.12 + k * 0.55) * p.big * (1 - Math.max(0, (k - 0.8) / 0.2));   // grow, then shrink away
        setInstance(smoke, i, p.x, p.y, p.z, 0, sc, sc, sc);
      }
      smoke.instanceMatrix.needsUpdate = true; smoke.instanceColor.needsUpdate = true;

      // headlights and plates
      const nearView = Math.max(0, Math.min(1, (160 - viewDist) / 60));
      // with no train being ridden, only the three nearest plates show, so they do not pile
      // up over Tel Aviv where a dozen trains sit within a plate's width of each other
      let cut = Infinity;
      if (focus && !followedId && nearView > 0) {
        const ds = [];
        for (const t of trains) if (t.active) ds.push(_f.set(t.head.x, t.head.y, t.head.z).distanceTo(focus));
        ds.sort((a, b) => a - b);
        cut = ds.length > 3 ? ds[2] : Infinity;
      }
      const beamScale = lightsOn ? 1 : smoothstep(0.38, 0.72, night);   // headlights fade up, never snap
      for (const t of trains) {
        if (!t.active) continue;
        const rot = Math.atan2(t.head.tx, t.head.tz);
        const fast = Math.max(0, Math.min(1, t.v / 0.35));
        setInstance(beams, t.slot, t.head.x, t.head.y + 0.22 * SCALE, t.head.z, rot, beamScale, beamScale, beamScale * (1 + 0.35 * fast));
        setInstance(pools, t.slot, t.head.x + t.head.tx * 1.6 * SCALE, t.head.y + 0.03, t.head.z + t.head.tz * 1.6 * SCALE,
          rot, 0.9 * SCALE * beamScale, 1, 2.0 * SCALE * (1 + 0.5 * fast) * beamScale);
        let o = 0;
        if (t.id === followedId) o = 1;                       // the ridden train is always legible
        else if (focus && !followedId) {                      // one plate at a time while the tour rides
          const d = _f.set(t.head.x, t.head.y, t.head.z).distanceTo(focus);
          if (d <= cut) o = Math.max(0, Math.min(1, (14 - d) / 6)) * nearView;
        }
        t.plateO = (t.plateO || 0) + (o - (t.plateO || 0)) * Math.min(1, dt * 5);   // plates fade, never pop
        if (t.plateO > 0.02) {
          refreshPlate(t);
          t.plate.position.set(t.head.x, t.head.y + 0.9 * SCALE, t.head.z);
          t.plate.material.opacity = t.plateO; t.plate.visible = true;
        } else if (t.plate) t.plate.visible = false;
      }
      beams.instanceMatrix.needsUpdate = true;
      pools.instanceMatrix.needsUpdate = true;
    },
    nearestTo(point) {
      let best = null, bd = Infinity;
      for (const t of trains) {
        if (!t.active) continue;
        const d = Math.hypot(t.head.x - point.x, t.head.z - point.z);
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    },
    byId(id) { return trains.find((t) => t.id === id) || null; },
  };
}

/* ------------------------------------------ the timetable, on the network */
/**
 * Turns the timetable into runs the fleet can drive: each trip's stops are
 * matched to the nearest network station, a route is computed through them,
 * and the distance of every stop along it is noted. Trips sharing a calling
 * pattern share a route.
 */
function prepareSchedule({ timetable, router, P, makeRoute }, rails, stationsById) {
  const stations = Object.values(stationsById || {});
  const nearestStation = (lon, lat) => {
    const [x, z] = P.toXZ(lon, lat);
    let best = null, bd = 2.5;
    for (const s of stations) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s.id; } }
    return best;
  };
  const stopToStation = {};
  for (const [id, st] of Object.entries(timetable.stops)) stopToStation[id] = nearestStation(st.lon, st.lat);
  const routeCache = new Map();
  const runs = [];
  let unmatched = 0;
  for (const trip of timetable.trips) {
    const ids = [], keep = [];
    for (let i = 0; i < trip.stops.length; i++) {
      const sid = stopToStation[trip.stops[i][0]];
      if (!sid || sid === ids[ids.length - 1]) continue;
      ids.push(sid); keep.push(trip.stops[i]);
    }
    if (ids.length < 2) { unmatched++; continue; }
    const key = ids.join('>');
    let route = routeCache.get(key);
    if (route === undefined) {
      const r = router.routeThrough(ids);
      route = r ? makeRoute({ ...r, id: key, kind: 'passenger', he: trip.route || trip.head, en: trip.head }) : null;
      routeCache.set(key, route);
    }
    if (!route) { unmatched++; continue; }
    const stopD = route.stops.map((s) => s.d);
    const total = 4 * 2.3 * SCALE * ZS;              // four toy cars, near enough for placement
    runs.push({ id: trip.id, trip, route, stops: keep, stopD, total, service: trip.service, offset: 0, today: false, wk: false });
  }
  // the busiest minute of a weekday decides the pool size
  const weekdayRuns = runs.filter((r) => { const s = timetable.services[r.service]; return s && (s.days[0] || s.days[1] || s.days[2] || s.days[3]); });
  let peak = 0;
  for (let T = 0; T < 30 * 3600; T += 300) {
    let n = 0;
    for (const r of weekdayRuns) if (tripProgress(r.stops, T)) n++;
    peak = Math.max(peak, n);
  }
  const slots = Math.min(220, peak + 12);
  // a weekday to replay when nothing runs (Shabbat, the small hours)
  const replayDay = (() => {
    for (const r of weekdayRuns) {
      const svc = timetable.services[r.service];
      for (const [i, day] of [4, 3, 2, 1, 0].entries()) if (svc.days[day]) return { weekday: day, ymd: svc.from };
    }
    return null;
  })();
  if (replayDay) for (const r of runs) { const svc = timetable.services[r.service]; r.wk = !!(svc && svc.days[replayDay.weekday]); }
  const sched = {
    runs, slots, source: timetable.source, hasReplay: !!replayDay, unmatched, peak,
    selectDay(ymd, weekday) {
      const list = tripsForDay({ trips: runs.map((r) => r.trip), services: timetable.services }, ymd, weekday);
      const byTrip = new Map();
      for (const { trip, offset } of list) if (!byTrip.has(trip.id) || offset === 0) byTrip.set(trip.id, offset);
      for (const r of runs) { const off = byTrip.get(r.trip.id); r.today = off !== undefined; r.offset = off || 0; }
      if (sched.digest) sched.applyLive(sched.digest);        // a new day: match the live trains again
    },
    countActive(T) { let n = 0; for (const r of runs) if (r.today && tripProgress(r.stops, T - r.offset)) n++; return n; },
    /** the same minute of a weekday morning rush */
    replayTime(T) { return 8 * 3600 + (T % 3600); },
    live: null, digest: null,
    /**
     * Match Israel Railways' live trains to today's GTFS runs. The two feeds
     * share no ids, so a train is recognised by where and when it calls: the
     * network station nearest each API stop plus the scheduled arrival minute.
     * A matched run is shifted by its delay; a run whose train is not out
     * on the line yet keeps the timetable.
     */
    applyLive(digest) {
      if (!digest || !digest.trains) return;
      sched.digest = digest;
      const apiStation = {};
      for (const [id, ll] of Object.entries(digest.stations || {})) if (ll && ll[0]) apiStation[id] = nearestStation(ll[1], ll[0]);
      const keyed = new Map();                       // 'station@HH:MM' -> live train
      for (const [num, tr] of Object.entries(digest.trains)) {
        for (const [sid, hhmm] of tr.stops || []) {
          const st = apiStation[sid];
          if (st && hhmm) keyed.set(`${st}@${hhmm}`, { num, ...tr });
        }
      }
      const hhmm = (secs) => { const m = ((Math.round(secs / 60) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
      let matched = 0, delayed = 0, positioned = 0;
      for (const r of runs) {
        r.delay = 0; r.liveNum = null; r.liveSeg = -1;
        if (!r.today) continue;
        let hit = null, votes = 0;
        for (const [stopId, arr] of r.stops) {
          const st = stopToStation[stopId];
          const k = st && keyed.get(`${st}@${hhmm(arr + r.offset)}`);
          if (k) { if (!hit || k.num === hit.num) { hit = k; votes++; } }
        }
        if (!hit || votes < 2) continue;          // two calls agree: it is the same train
        matched++; r.liveNum = hit.num;
        if (hit.delay !== null) { positioned++; r.delay = hit.delay * 60; if (hit.delay > 0) delayed++; }
        // Israel Railways also reports the station the train has actually passed. That is a
        // real observation, not a guess from the timetable, so the train is put on that leg
        // of its route whatever the schedule says.
        r.liveSeg = -1;
        const cur = hit.cur != null ? apiStation[hit.cur] : null;
        if (cur != null) {
          for (let i = 0; i < r.stops.length; i++) {
            if (stopToStation[r.stops[i][0]] === cur) { r.liveSeg = i; break; }
          }
        }
      }
      sched.live = { fetched: digest.fetched, trains: Object.keys(digest.trains).length, matched, positioned, delayed };
    },
  };
  return sched;
}
