import * as THREE from 'three';
import { Builder, stdMat, glowMat } from './builder.js';
import { makeProjection } from './geo.js';

/**
 * Real buses. Every public bus in the country that reports its position to the Ministry of
 * Transport's SIRI feed, as re-published by Hasadna's Open Bus project and relayed through our
 * proxy (worker/rail-live.js, GET /buses). A snapshot a minute, about a minute behind the street.
 *
 * Each bus glides from where it was drawn to its newest reported position over the minute until
 * the next report, so the layer moves continuously instead of jumping once a minute. A bus that
 * stops reporting fades out; a new one fades in. One InstancedMesh for the bodies and one for the
 * lit windows, so thousands of buses cost two draw calls.
 */
const SIZE = 1.6;                 // against the fake street traffic, so a real bus stands out
const MAX = 12000;
const POLL_S = 60;

// Operator colours. Egged and Dan by their well-known colours, everyone else from a fixed set.
// operator_ref is the MOT agency id: 3 Egged, 5 Dan.
const OPERATOR = { 3: 0x1f8a4c, 5: 0x2a63b8 };
const OTHERS = [0xe0a24a, 0xc2493f, 0x7a5cc2, 0x2f9aa0, 0xd46a9a, 0x8a8f3a, 0x5a7fa8, 0xb86b3a];
const colourOf = (op) => OPERATOR[op] ?? OTHERS[Math.abs(op | 0) % OTHERS.length];

export function createBuses({ world, terrain, source }) {
  const P = makeProjection(world.proj);
  const group = new THREE.Group();
  group.name = 'real buses';

  const b = new Builder(91), g = new Builder(92);
  b.box(0, 0.17, 0, 0.3, 0.26, 0.9, 0xffffff, { jitter: 0.02 });          // body, tinted per operator
  b.box(0, 0.315, 0, 0.28, 0.03, 0.86, 0xf2f2ee);                          // roof
  b.box(0, 0.05, 0, 0.26, 0.04, 0.8, 0x2a2e33);                            // underbody
  for (const s of [-1, 1]) g.box(s * 0.152, 0.21, 0, 0.01, 0.08, 0.72, 0xdde6ff);   // window strips
  g.box(0, 0.21, 0.452, 0.24, 0.1, 0.01, 0x263241);                         // windscreen
  const bodyGeo = b.build(); bodyGeo.scale(SIZE, SIZE, SIZE);
  const glowGeo = g.build(); glowGeo.scale(SIZE, SIZE, SIZE);

  const body = new THREE.InstancedMesh(bodyGeo, stdMat(), MAX);
  body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
  const glow = new THREE.InstancedMesh(glowGeo, glowMat(), MAX);
  for (const m of [body, glow]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); }
  body.castShadow = false; body.receiveShadow = true;

  const fleet = new Map();                       // vehicle -> { x, z, rot, fx, fz, frot, tx, tz, trot, t, alive, fade, colour }
  const status = { state: 'idle', buses: 0, snapshot: null, at: 0, error: null };
  let timer = null, loadingAt = 0;

  async function fetchAll() {
    if (source.endsWith('.json')) return [await (await fetch(source)).json()];       // a fixture: one part
    const one = async (part) => {
      const r = await fetch(`${source}?part=${part}`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`buses ${r.status}`);
      return r.json();
    };
    const parts = [];
    for (let batch = 0; batch < 30; batch += 6) {                    // six parts at a time until one comes back short
      const got = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => one(batch + i).catch(() => null)));
      parts.push(...got.filter(Boolean));
      if (got.some((p) => !p || p.n < p.page)) break;
    }
    return parts;
  }

  async function poll() {
    loadingAt = performance.now();
    try {
      const parts = await fetchAll();
      if (!parts.length) throw new Error('no answer');
      const seen = new Set();
      const snap = parts[0];
      for (const p of parts) for (const [id, lat, lon, bearing, , op] of p.v) {
        if (seen.has(id)) continue;
        seen.add(id);
        const [x, z] = P.toXZ(lon, lat);
        const rot = Math.PI - (bearing * Math.PI) / 180;
        let bus = fleet.get(id);
        if (!bus) {
          bus = { x, z, rot, fx: x, fz: z, frot: rot, tx: x, tz: z, trot: rot, t: 1, fade: 0, alive: true, colour: new THREE.Color(colourOf(op ?? 0)) };
          fleet.set(id, bus);
        } else {
          // glide from where it is drawn now; a jump of more than 8 km is a new trip, not a drive
          const far = Math.hypot(x - bus.x, z - bus.z) > 8;
          bus.fx = far ? x : bus.x; bus.fz = far ? z : bus.z; bus.frot = far ? rot : bus.rot;
          bus.tx = x; bus.tz = z; bus.trot = rot; bus.t = far ? 1 : 0; bus.alive = true;
        }
      }
      for (const [id, bus] of fleet) if (!seen.has(id)) bus.alive = false;
      Object.assign(status, { state: 'ok', buses: seen.size, snapshot: snap.snapshot ?? null, at: snap.at ?? 0, error: null });
    } catch (e) {
      Object.assign(status, { state: 'error', error: String(e?.message || e) });
    }
  }

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
  const wrap = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

  return {
    group, status,
    get visible() { return group.visible; },
    set visible(on) {
      group.visible = on;
      if (on && !timer) { poll(); timer = setInterval(poll, POLL_S * 1000); }
      if (!on && timer) { clearInterval(timer); timer = null; }
    },
    update(dt, night) {
      if (!group.visible) return;
      let i = 0;
      const glide = dt / POLL_S;
      for (const [id, bus] of fleet) {
        bus.fade = Math.max(0, Math.min(1, bus.fade + (bus.alive ? dt : -dt) * 1.5));
        if (!bus.alive && bus.fade <= 0) { fleet.delete(id); continue; }
        if (bus.t < 1) {
          bus.t = Math.min(1, bus.t + glide);
          const k = bus.t;
          bus.x = bus.fx + (bus.tx - bus.fx) * k;
          bus.z = bus.fz + (bus.tz - bus.fz) * k;
          bus.rot = bus.frot + wrap(bus.trot - bus.frot) * Math.min(1, k * 4);    // turn early, then drive
        }
        if (i >= MAX) continue;
        const y = terrain.heightAt(bus.x, bus.z) + 0.02;
        const s = bus.fade;
        _m.compose(_p.set(bus.x, y, bus.z), _q.setFromAxisAngle(_y, bus.rot), _s.set(s, s, s));
        body.setMatrixAt(i, _m); glow.setMatrixAt(i, _m);
        body.setColorAt(i, bus.colour);
        i++;
      }
      body.count = glow.count = i;
      body.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      glow.material.color.setScalar(0.35 + 0.65 * night);                 // windows glow after dark
    },
  };
}
