import * as THREE from 'three';
import { OUTLINE_LAYER } from './post.js';
import { Builder, stdMat, glowMat, setInstance, rng, paint } from './builder.js';
import { labelTexture } from './labels.js';
import { C } from './palette.js';
import { TRACK } from './rails.js';

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
export const SCALE = 2.2;          // vehicles are built at unit scale, then blown up
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

export function createTrains(rails, terrain, stationsById = null) {
  const group = new THREE.Group();
  group.name = 'trains';
  const R = rng(99);

  // plan the trains: more on long routes, alternating directions
  const plans = [];
  for (const route of rails.routes) {
    const consist = route.kind === 'heritage' ? 'heritage'
      : route.kind === 'freight' ? (route.id === 'phosphate' ? 'freightHopper' : 'freightFlat') : 'passenger';
    const n = Math.max(1, Math.min(4, 1 + Math.floor(route.length / 50)));
    const nCars = consist === 'passenger' ? (route.length < 40 ? 3 : route.length < 120 ? 4 : 5)
      : consist === 'heritage' ? 4 : 6;
    for (let k = 0; k < n; k++) {
      const cars = CONSISTS[consist].slice(0, nCars);
      const dir = k % 2 === 0 ? 1 : -1;
      plans.push({ id: `${route.id}#${k}`, route, consist, cars, dir, start: ((k + 0.5) / n + (R() - 0.5) * 0.1) * route.length });
    }
  }

  // instanced meshes per vehicle type
  const counts = {};
  for (const p of plans) for (const t of p.cars) counts[t] = (counts[t] || 0) + 1;
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
      glow.name = `train-${name}-glow`;
      group.add(glow);
    }
    types[name] = { solid, glow, next: 0, len: spec.len * SCALE * ZS };
  }

  const trains = plans.map((p) => {
    const cars = p.cars.map((t) => ({ type: t, idx: types[t].next++, len: types[t].len }));
    const total = cars.reduce((s, c) => s + c.len + GAP, 0);
    const kind = p.route.kind === 'heritage' ? 'heritage' : p.route.kind === 'freight' ? 'freight' : 'passenger';
    return {
      id: p.id, route: p.route, cars, total, kind, d: p.start, dir: p.dir, side: p.dir, v: 0, dwell: 0, stopIdx: -1,
      head: { x: 0, y: 0, z: 0, tx: 0, tz: 1 },      // world position of the front, travel tangent
    };
  });

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

  const place = (t) => {
    const lk = t.route.lookup;
    let back = 0;                                   // distance from the head, along the train
    for (const car of t.cars) {
      const dc = t.d - t.dir * (back + car.len / 2);
      const a = lane(lk.at(dc - t.dir * car.len * 0.34), t), b = lane(lk.at(dc + t.dir * car.len * 0.34), t);
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      const rot = Math.atan2(b.x - a.x, b.z - a.z);
      const y = t.route.heightAt(dc) + TRACK.railH;
      const ty = types[car.type];
      setInstance(ty.solid, car.idx, x, y, z, rot);
      if (ty.glow) setInstance(ty.glow, car.idx, x, y, z, rot);
      back += car.len + GAP;
    }
    const h = lk.at(t.d), hp = lane(h, t);
    t.head.x = hp.x; t.head.z = hp.z; t.head.y = t.route.heightAt(t.d) + TRACK.railH;
    t.head.tx = h.tx * t.dir; t.head.tz = h.tz * t.dir;
  };
  for (const t of trains) place(t);

  // the closest a train may run to the one ahead, given both speeds
  const headwayLimit = (t) => {
    let limit = Infinity;
    const H = t.head;
    for (const o of trains) {
      if (o === t) continue;
      const dot = H.tx * o.head.tx + H.tz * o.head.tz;
      if (dot < 0.5) continue;                                   // not going our way
      const dx = o.head.x - H.x, dz = o.head.z - H.z;
      const ahead = dx * H.tx + dz * H.tz;
      const lateral = Math.abs(dx * H.tz - dz * H.tx);
      if (ahead <= 0 || ahead > o.total + 12 || lateral > 1.2) continue;
      const room = Math.max(0, ahead - o.total - 2);
      limit = Math.min(limit, o.v + Math.sqrt(2 * ACCEL * room));
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
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
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
  const beams = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }), trains.length);
  beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  beams.name = 'headlights'; beams.renderOrder = 5;
  group.add(beams);

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
  for (const t of trains) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, transparent: true, depthTest: false, sizeAttenuation: false }));
    sprite.scale.set(0.17, 0.05, 1);
    sprite.center.set(0.5, -0.4);
    sprite.renderOrder = 21;
    sprite.visible = false;
    group.add(sprite);
    t.plate = sprite; t.plateStop = undefined;
  }
  const refreshPlate = (t) => {
    const id = nextStopId(t);
    if (id === t.plateStop) return;
    t.plateStop = id;
    if (t.plate.material.map) t.plate.material.map.dispose();
    const he = id ? `${t.route.he}  ⟵  ${stationName(id, 'he')}` : t.route.he;
    const en = id ? `${t.route.en}  ·  next: ${stationName(id, 'en')}` : t.route.en;
    t.plate.material.map = labelTexture(he, en, { w: 900, h: 160, plate: t.kind === 'heritage' ? 'rgba(70, 40, 20, 0.92)' : t.kind === 'freight' ? 'rgba(40, 46, 52, 0.92)' : 'rgba(17, 45, 96, 0.92)', border: t.kind === 'heritage' ? '#d4a83a' : '#d0342c' });
    t.plate.material.needsUpdate = true;
  };

  const _c = new THREE.Color();
  const _f = new THREE.Vector3();
  return {
    group, trains, types, SCALE, smoke, beams,
    /**
     * @param speedLever 0..1  @param night 0..1  @param lightsOn force lights
     * @param focus      world point the viewer looks at (plates show near it)
     * @param followedId id of the train the tour is riding, whose plate always shows
     * @param viewDist   camera distance to the focus (km): plates hide when you are far out
     */
    update(dt, speedLever, night, lightsOn, focus = null, followedId = null, viewDist = 0) {
      const factor = 0.15 + speedLever * 2.2;
      for (const t of trains) {
        const vmax = SPEEDS[t.kind] * factor;
        // slide over to the other track after turning round
        const ds = Math.max(-0.5 * dt, Math.min(0.5 * dt, t.dir - t.side));
        t.side += ds;
        if (t.dwell > 0) { t.dwell -= dt; t.v = 0; }
        else {
          const target = nextStop(t);
          const remaining = Math.abs(target - t.d);
          let allowed = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, remaining - 0.02)));
          allowed = Math.min(allowed, headwayLimit(t));
          t.v = t.v < allowed ? Math.min(allowed, t.v + ACCEL * dt) : allowed;
          const step = Math.min(t.v * dt, remaining);
          t.d += t.dir * step;
          if (remaining - step < 0.03) {
            // arrived: dwell, and turn round at the ends of the line
            const atEnd = t.d <= t.total * 0.55 + 0.05 || t.d >= t.route.length - t.total * 0.55 - 0.05;
            t.dwell = atEnd ? 5 : 2.5;
            if (atEnd) t.dir = t.d <= t.route.length / 2 ? 1 : -1;
          }
        }
        // keep the whole train on the line when it turns round at a terminus
        t.d = Math.max(t.total * 0.55, Math.min(t.route.length - t.total * 0.55, t.d));
        place(t);
      }
      for (const ty of Object.values(types)) {
        ty.solid.instanceMatrix.needsUpdate = true;
        if (ty.glow) ty.glow.instanceMatrix.needsUpdate = true;
      }
      const on = lightsOn ? 1 : Math.max(0.12, Math.min(1, (night - 0.35) * 2.2));
      _c.setScalar(on);
      for (const m of glowMats) m.color.copy(_c);

      // smoke
      for (const t of trains) {
        const spec = SMOKE[t.kind];
        if (!spec) continue;
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
      const beamsOn = lightsOn || night > 0.5;
      const beamScale = beamsOn ? 1 : 0;
      for (let i = 0; i < trains.length; i++) {
        const t = trains[i];
        const rot = Math.atan2(t.head.tx, t.head.tz);
        setInstance(beams, i, t.head.x, t.head.y + 0.22 * SCALE, t.head.z, rot, beamScale, beamScale, beamScale);
        const plate = t.plate;
        let o = 0;
        if (t.id === followedId) o = nearView;
        else if (focus) { const d = _f.set(t.head.x, t.head.y, t.head.z).distanceTo(focus); o = Math.max(0, Math.min(1, (28 - d) / 10)) * nearView; }
        if (o > 0.02) {
          refreshPlate(t);
          plate.position.set(t.head.x, t.head.y + 0.9 * SCALE, t.head.z);
          plate.material.opacity = o; plate.visible = true;
        } else plate.visible = false;
      }
      beams.instanceMatrix.needsUpdate = true;
    },
    nearestTo(point) {
      let best = null, bd = Infinity;
      for (const t of trains) {
        const d = Math.hypot(t.head.x - point.x, t.head.z - point.z);
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    },
    byId(id) { return trains.find((t) => t.id === id) || null; },
  };
}
