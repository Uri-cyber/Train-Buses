import * as THREE from 'three';
import { HOME } from './camera.js';

/**
 * The auto tour. When nobody touches the mouse the camera rides alongside a
 * train for a while, then glides to another one, all day long. Any pointer
 * or wheel input on the map hands the camera over at once; after a quiet
 * spell the tour picks up again. The TOUR button on the desk (key 6) turns
 * it off altogether.
 */
const FOLLOW_S = 30;      // seconds riding with one train
const RESUME_S = 45;      // seconds of quiet before the tour resumes
const BACK = 14, UP = 6, SWAY = 8;   // chase camera: km behind, above and beside the train

export function createTour({ cam, getTrains, terrain, state, hint }) {
  let mode = 'user';      // user | flight | follow
  let followId = null, followT = 0, phase = 0, legs = 0;
  let lastInput = performance.now();
  const visited = [];
  const _pos = new THREE.Vector3(), _target = new THREE.Vector3();

  const chasePoint = (t) => {
    const T = t.head, len = t.total;
    const mx = T.x - T.tx * len * 0.5, mz = T.z - T.tz * len * 0.5;       // middle of the train
    const my = Math.max(T.y, terrain.heightAt(mx, mz)) + 0.6;
    const lx = T.tz, lz = -T.tx;                                         // beside the line
    const sway = Math.sin(phase) * SWAY;
    _target.set(mx, my, mz);
    _pos.set(mx - T.tx * BACK + lx * sway, my + UP, mz - T.tz * BACK + lz * sway);
    return { pos: _pos, target: _target };
  };

  const pickNext = () => {
    const trains = getTrains();
    const from = cam.controls.target;
    let best = null, bd = Infinity;
    const current = trains.find((t) => t.id === followId);
    for (const t of trains) {
      if (t.id === followId || t.dwell > 0 || t.v < 0.05) continue;
      let cost = Math.hypot(t.head.x - from.x, t.head.z - from.z);
      if (current && t.kind === current.kind) cost += 80;
      if (visited.includes(t.id)) cost += 200;
      if (cost < bd) { bd = cost; best = t; }
    }
    return best || trains.find((t) => t.id !== followId) || trains[0] || null;
  };

  const showHint = (on) => { if (hint) hint.hidden = !on; };

  const startLeg = (dur) => {
    const t = pickNext();
    if (!t) { mode = 'user'; showHint(false); return; }
    followId = t.id;
    visited.push(t.id); if (visited.length > 5) visited.shift();
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
      if (!state.tour) { if (mode !== 'user') { mode = 'user'; showHint(false); } return; }
      if (mode === 'user') {
        if (performance.now() - lastInput > RESUME_S * 1000) startLeg();
        return;
      }
      if (mode === 'flight') {
        if (!cam.flying()) { mode = 'follow'; followT = 0; }
        return;
      }
      const t = getTrains().find((x) => x.id === followId);
      if (!t) { startLeg(); return; }
      followT += dt; phase += dt * 0.08;
      const { pos, target } = chasePoint(t);
      cam.chase(pos, target, dt);
      if (followT > FOLLOW_S) startLeg();
    },
  };
  return api;
}
