import * as THREE from 'three';
import { HOME } from './camera.js';

/**
 * The auto tour. When nobody touches the mouse the camera rides alongside a
 * train for a while, then glides to another one, all day long. Any pointer
 * or wheel input on the map hands the camera over at once; after a quiet
 * spell the tour picks up again. The TOUR button on the desk (key 6) turns
 * it off altogether.
 */
const RESUME_S = 20;      // seconds of quiet before the tour resumes
/**
 * The shot table. Each train is introduced with one of these: r = km from the
 * train, up = km above it, orbit = rad/s of drift once the camera has settled,
 * a0 = start angle from the heading (PI = straight behind), breathe = how much
 * the radius and height sway, lead = look ahead along the train (in train
 * lengths), fov = lens, hold = seconds riding with this train, fit = the
 * least distance in train lengths that keeps a whole train in frame from
 * this angle (measured: the near end of a long train is what crops first).
 */
const SHOTS = {
  ride:    { r: 6.5, up: 2.8, orbit: 0.11, a0: Math.PI + 0.6, breathe: 2.2, lead: 0.15, fov: 42, hold: 32, fit: 1.35 },
  reveal:  { r: 11,  up: 6,   orbit: 0.06, a0: Math.PI + 0.5, breathe: 1.0, lead: 0.1,  fov: 40, hold: 30, fit: 1.7 },
  lowride: { r: 5.5, up: 1.6, orbit: 0.08, a0: Math.PI + 0.7, breathe: 1.2, lead: 0.15, fov: 42, hold: 28, fit: 1.4 },
  wide:    { r: 18,  up: 9,   orbit: 0.04, a0: Math.PI + 1.2, breathe: 1.5, lead: 0,    fov: 36, hold: 34, fit: 2.35 },
};
const LANDMARK_KM = 12;   // a landmark this close to the train favours the wide shot
const MOVING = 0.004;     // km/s: below this a train counts as standing (real trains do 0.02 to 0.045)

const smoothstep = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

export function createTour({ cam, getTrains, getLandmarks, terrain, state, hint }) {
  let mode = 'user';      // user | flight | follow
  let followId = null, followT = 0, phase = 0, legs = 0, stuckT = 0;
  let shotName = 'ride', shot = SHOTS.ride, dir = 1, settleT = 0, settled = false;
  let lastInput = performance.now();
  const visited = [];
  const _pos = new THREE.Vector3(), _target = new THREE.Vector3();

  const chasePoint = (t) => {
    const T = t.head, len = t.total;
    const mx = T.x - T.tx * len * 0.5, mz = T.z - T.tz * len * 0.5;       // middle of the train
    const my = Math.max(T.y, terrain.heightAt(mx, mz)) + 0.6;
    // circle the train: start at the shot's angle, drift round, breathe in and out
    const heading = Math.atan2(T.tx, T.tz);
    const a = heading + shot.a0 * dir + phase * dir;
    // never closer than the whole train fits in frame: broadside it is the width of the
    // view that limits, from behind it is the near end running out of the bottom
    const c = cam.camera;
    const hfov = 2 * Math.atan(Math.tan(c.fov * Math.PI / 360) * c.aspect);
    const rMin = Math.min(26, Math.max(((len * 0.5 + 0.8) / Math.tan(hfov / 2)) * 0.9, len * shot.fit));
    const r = Math.max(shot.r + Math.sin(phase * 0.37) * shot.breathe, rMin);
    // look a little ahead of the train so there is room in front of it
    _target.set(mx + T.tx * len * shot.lead, my + shot.up * 0.25, mz + T.tz * len * shot.lead);
    _pos.set(mx + Math.sin(a) * r, my + shot.up + Math.sin(phase * 0.23) * 0.3 * shot.breathe, mz + Math.cos(a) * r);
    // the terrain floor: above camera.js's own clamp (+1.0) so it never pops
    _pos.y = Math.max(_pos.y, terrain.heightAt(_pos.x, _pos.z) + 1.2);
    return { pos: _pos, target: _target };
  };

  const pickNext = () => {
    const trains = getTrains();
    const from = cam.controls.target;
    let best = null, bd = Infinity;
    const current = trains.find((t) => t.id === followId);
    for (const t of trains) {
      if (t.id === followId || t.active === false || t.dwell > 0 || t.v < MOVING) continue;
      let cost = Math.hypot(t.head.x - from.x, t.head.z - from.z);
      if (current && t.kind === current.kind) cost += 80;
      if (visited.includes(t.id)) cost += 200;
      if (cost < bd) { bd = cost; best = t; }
    }
    return best || trains.find((t) => t.id !== followId && t.active !== false) || trains.find((t) => t.active !== false) || null;
  };

  const showHint = (on) => { if (hint) hint.hidden = !on; };

  /** choose the shot for a leg: never the same twice, wide when a landmark is near */
  const pickShot = (t) => {
    const names = Object.keys(SHOTS).filter((n) => n !== shotName);
    const lm = getLandmarks ? getLandmarks() : null;
    const nearLandmark = !!lm && lm.some((l) => Math.hypot(l.x - t.head.x, l.z - t.head.z) < LANDMARK_KM);
    const weights = names.map((n) => (n === 'wide' && nearLandmark ? 3 : 1));
    let pick = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < names.length; i++) { pick -= weights[i]; if (pick < 0) return names[i]; }
    return names[names.length - 1];
  };

  const startLeg = (dur) => {
    const t = pickNext();
    if (!t) { mode = 'user'; showHint(false); return; }
    followId = t.id;
    visited.push(t.id); if (visited.length > 5) visited.shift();
    shotName = pickShot(t); shot = SHOTS[shotName];
    phase = 0; settleT = 0; settled = false; dir = Math.random() < 0.5 ? 1 : -1;
    const dist = cam.camera.position.distanceTo(chasePoint(t).pos);
    mode = 'flight'; legs++;
    cam.flyToward(() => chasePoint(getTrains().find((x) => x.id === followId) || t), dur ?? Math.max(3, Math.min(8, 2.5 + dist / 60)));
    showHint(true);
  };

  const takeOver = () => {
    lastInput = performance.now();
    if (mode !== 'user') { mode = 'user'; cam.cancelFlight(); showHint(false); }
  };
  const el = cam.controls.domElement;
  el.addEventListener('pointerdown', takeOver);                       // bubble phase: desk clicks never get here
  el.addEventListener('wheel', takeOver, { passive: true });
  addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'r') takeOver(); });

  const api = {
    get active() { return !!state.tour; },
    get mode() { return mode; },
    get trainId() { return mode === 'user' ? null : followId; },
    get legs() { return legs; },
    get shot() { return shotName; },
    /** true once the camera has come to rest beside the train (the plate is readable) */
    get settled() { return settled; },
    /** the TOUR button */
    set(on) {
      state.tour = !!on;
      if (on) startLeg(); else { mode = 'user'; cam.cancelFlight(); showHint(false); }
    },
    /** open the page on the first leg: from high above the country down to a train */
    begin() {
      cam.camera.position.copy(HOME.target).add(new THREE.Vector3(-120, 620, 760));
      cam.controls.target.copy(HOME.target);
      if (state.tour) startLeg(5.0); else cam.intro();
    },
    update(dt) {
      if (!state.tour) { if (mode !== 'user') { mode = 'user'; showHint(false); } cam.setFov(46); return; }
      if (mode === 'user') {
        cam.setFov(46);
        if (performance.now() - lastInput > RESUME_S * 1000) startLeg();
        return;
      }
      if (mode === 'flight') {
        const f = cam.flight();
        cam.setFov(f ? 46 + 10 * Math.sin(f.t * Math.PI) : 46);   // the loft lens: wider at the top of the arc
        if (!cam.flying()) { mode = 'follow'; followT = 0; settleT = 0; }
        return;
      }
      const t = getTrains().find((x) => x.id === followId);
      if (!t || t.active === false) { startLeg(); return; }
      // a train that just stands there is no fun to watch: move on after a few seconds of it
      stuckT = t.v < MOVING ? stuckT + dt : 0;
      if (stuckT > 8) { stuckT = 0; startLeg(); return; }
      // settle: come to rest with the train composed and its plate readable, then start the drift
      followT += dt; settleT += dt;
      const settle = settleT < (t.v < MOVING ? 2 : 4);
      settled = !settle;
      const ramp = settle ? 0 : smoothstep(0, 3, settleT - 4);
      phase += dt * shot.orbit * ramp;
      cam.setFov(shot.fov);
      const { pos, target } = chasePoint(t);
      cam.chase(pos, target, dt, settle ? 3.0 : 1.8);
      if (followT > shot.hold) startLeg();
    },
  };
  return api;
}
