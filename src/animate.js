import * as THREE from 'three';
import { LOOP, ZONES } from './layout.js';
import { updateSun } from './scene.js';
import { updateDesk } from './controls.js';

/** Places a vehicle on a path at distance d, facing along the tangent. */
export function placeOnPath(obj, path, d, yOffset = 0) {
  const p = path.at(d);
  obj.position.set(p.x, yOffset, p.z);
  obj.rotation.y = Math.atan2(p.tx, p.tz);
}

/** Simple looping road route made of waypoints. */
export class Route {
  constructor(points, closed = true) {
    this.pts = points; this.closed = closed;
    this.segLen = [];
    let L = 0;
    for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.segLen.push(l); L += l;
    }
    this.length = L;
  }
  at(d) {
    d = ((d % this.length) + this.length) % this.length;
    for (let i = 0; i < this.segLen.length; i++) {
      if (d <= this.segLen[i]) {
        const a = this.pts[i], b = this.pts[(i + 1) % this.pts.length];
        const t = d / this.segLen[i];
        const ux = (b[0] - a[0]) / this.segLen[i], uz = (b[1] - a[1]) / this.segLen[i];
        return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: ux, tz: uz };
      }
      d -= this.segLen[i];
    }
    const a = this.pts[0];
    return { x: a[0], z: a[1], tx: 1, tz: 0 };
  }
}

/** Short beep synthesised on the fly, so the project stays asset-free. */
export function whistle() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    whistle.ctx = whistle.ctx || new Ctx();
    const ctx = whistle.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    gain.connect(ctx.destination);
    for (const [f, g] of [[880, 1], [1320, 0.6], [1760, 0.3]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f, now);
      o.frequency.linearRampToValueAtTime(f * 0.94, now + 0.9);
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og); og.connect(gain);
      o.start(now); o.stop(now + 0.95);
    }
  } catch { /* audio is a nice-to-have */ }
}

const _c = new THREE.Color();

/**
 * The main loop. `w` is the world bag assembled in main.js.
 */
export function createLoop(w) {
  const { renderer, scene, camera, state, desk, lights, water, world } = w;
  const clock = new THREE.Clock();
  let trainD = 0, tickAcc = 0, frames = 0, fpsT = 0;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // ---- desk drives the state
    state.speed = desk.levers[0].value;
    if (state.autoSun) {
      state.hour = (state.hour + dt * 0.55) % 24;
      desk.levers[1].value = state.hour / 24;
    } else {
      state.hour = desk.levers[1].value * 24;
    }
    updateDesk(desk, state, dt);

    // ---- sun / sky
    const sky = updateSun(lights, scene, state.hour);
    const dark = 1 - sky.day;
    lights.lamp.intensity = (state.lights ? 1 : dark) * 0.85 * (state.lights ? 1 : dark);

    // Emissive panes carry their own colour in the vertex data, so the shared
    // material only has to ride from ~black (off) to white (fully lit).
    const glow = Math.max(state.lights ? 0.9 : 0, Math.min(1, (dark - 0.35) * 2.0));
    const g = 0.05 + glow * 0.95;
    for (const m of world.windowMats) m.color.setRGB(g, g, g);

    // ---- trains
    const v = 0.05 + state.speed * 0.65;
    trainD += v * dt;
    let d = trainD;
    for (const car of world.train.cars) {
      placeOnPath(car, world.track, d, 0);
      d -= car.userData.len ?? 0.16;
    }
    // second train running the other way, offset round the loop
    let d2 = -trainD * 0.62 + world.track.length * 0.5;
    for (const car of world.freight.cars) {
      placeOnPath(car, world.track, d2, 0);
      car.rotation.y += Math.PI;
      d2 += car.userData.len ?? 0.11;
    }

    // ---- turntable
    if (state.turntable) world.turntableDeck.rotation.y += dt * 0.5;

    // ---- ships and cranes
    world.ships.forEach((s, i) => {
      s.userData.d = (s.userData.d + dt * s.userData.v) % s.userData.route.length;
      const p = s.userData.route.at(s.userData.d);
      s.position.set(p.x, 0.019 + Math.sin(t * 1.3 + i) * 0.002, p.z);
      s.rotation.y = Math.atan2(p.tx, p.tz);
      s.rotation.z = Math.sin(t * 0.9 + i * 2) * 0.02;
    });
    world.cranes.forEach((c, i) => {
      c.userData.jib.rotation.y = Math.sin(t * 0.35 + i * 1.7) * 0.5;
    });

    // ---- road traffic
    if (state.traffic) {
      world.cars.forEach((c) => {
        c.userData.d = (c.userData.d + dt * c.userData.v) % c.userData.route.length;
      });
    }
    world.cars.forEach((c) => {
      const p = c.userData.route.at(c.userData.d);
      c.position.set(p.x, 0.013, p.z);
      c.rotation.y = Math.atan2(p.tx, p.tz);
      c.visible = true;
    });

    // ---- water
    tickAcc += dt;
    if (tickAcc > 1 / 30) { water.update(t); tickAcc = 0; }

    // ---- smoke puffs from the loco chimney
    world.smoke.update(dt, world.train.cars[0], v);

    renderer.render(scene, camera);
    frames++; fpsT += dt;
    if (fpsT > 1) { w.fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
    w.rafId = requestAnimationFrame(frame);
  }
  return { start: () => { clock.start(); frame(); } };
}

/** Cheap instanced smoke: a ring of puffs recycled as the loco moves. */
export function createSmoke(scene) {
  const N = 26;
  const geo = new THREE.SphereGeometry(0.0045, 6, 5);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd6d2ca, transparent: true, opacity: 0.34, roughness: 1, depthWrite: false,
  });
  const inst = new THREE.InstancedMesh(geo, mat, N);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.frustumCulled = false;
  scene.add(inst);
  const puffs = Array.from({ length: N }, () => ({ life: 0, x: 0, y: -9, z: 0, vy: 0 }));
  let cursor = 0, acc = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  return {
    update(dt, loco, speed) {
      acc += dt;
      const rate = 0.10 / Math.max(0.15, speed);
      if (loco && acc > rate) {
        acc = 0;
        const p = puffs[cursor % N]; cursor++;
        const off = new THREE.Vector3(0, 0.075, -0.052).applyEuler(loco.rotation);
        p.x = loco.position.x + off.x; p.y = loco.position.y + off.y; p.z = loco.position.z + off.z;
        p.vy = 0.055 + Math.random() * 0.03; p.life = 1;
        p.dx = (Math.random() - 0.5) * 0.02; p.dz = (Math.random() - 0.5) * 0.02;
      }
      for (let i = 0; i < N; i++) {
        const p = puffs[i];
        if (p.life > 0) {
          p.life -= dt * 0.45;
          p.y += p.vy * dt; p.x += (p.dx || 0) * dt; p.z += (p.dz || 0) * dt;
        }
        const sc = p.life > 0 ? 0.45 + (1 - p.life) * 1.5 : 0.0001;
        s.set(sc, sc, sc);
        m.compose(new THREE.Vector3(p.x, p.life > 0 ? p.y : -9, p.z), q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      mat.opacity = 0.32;
    },
  };
}

export { ZONES, LOOP };
