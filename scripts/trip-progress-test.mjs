#!/usr/bin/env node
/**
 * The trapezoid speed profile in src/timetable.js: starts at 0, ends at 1,
 * never runs backwards, and never strays far from a straight line.
 */
import { tripCurve, tripProgress } from '../src/timetable.js';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
for (const secs of [30, 120, 300, 900, 3000]) {
  const f = (u) => tripCurve(u, secs);
  check(Math.abs(f(0)) < 1e-9, `secs=${secs}: f(0) = ${f(0)}`);
  check(Math.abs(f(1) - 1) < 1e-9, `secs=${secs}: f(1) = ${f(1)}`);
  let prev = -1, mono = true, close = true;
  for (let k = 0; k <= 200; k++) {
    const u = k / 200, v = f(u);
    if (v < prev - 1e-12) mono = false;
    if (Math.abs(v - u) >= 0.25) close = false;
    prev = v;
  }
  check(mono, `secs=${secs}: f is not monotone`);
  check(close, `secs=${secs}: |f(u) - u| reaches 0.25`);
}
// phases along a two-hop trip
const stops = [['a', 0, 0], ['b', 600, 660], ['c', 1200, 1200]];
const phases = new Set();
for (let T = -30; T <= 1220; T += 5) { const p = tripProgress(stops, T); if (p) phases.add(p.phase); }
for (const ph of ['accel', 'cruise', 'brake', 'stop']) check(phases.has(ph), `phase ${ph} never appears`);
check(tripProgress(stops, 620).toDep === 40, 'toDep while standing at b');

if (failures.length) { failures.forEach((f) => console.log('FAIL  ' + f)); process.exit(1); }
console.log('PASS  trip profile: f(0)=0, f(1)=1, monotone, |f-u| < 0.25, all four phases');
