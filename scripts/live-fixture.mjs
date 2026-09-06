#!/usr/bin/env node
/**
 * A stand-in for the live proxy (worker/rail-live.js) for the checks: reads the
 * timetable fixture and pretends Israel Railways reported every trip that is
 * running, a third of them a few minutes late. Written to
 * public/ and dist/ as live-fixture.json; the page reads it with ?live=./live-fixture.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const tt = JSON.parse(readFileSync('public/timetable.json', 'utf8'));
const stations = {};
for (const [id, s] of Object.entries(tt.stops)) stations[id.replace(/^S/, '')] = [s.lat, s.lon];
const hhmm = (secs) => { const m = Math.round(secs / 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const trains = {};
let n = 0;
for (const trip of tt.trips) {
  const num = 1000 + n++;
  trains[num] = {
    delay: n % 3 === 0 ? 2 + (n % 5) : 0,
    cur: null, next: null, upd: null,
    stops: trip.stops.map(([sid, arr]) => [sid.replace(/^S/, ''), hhmm(arr)]),
  };
}
const digest = { fetched: Date.now(), stations, trains };
for (const dir of ['public', 'dist']) if (existsSync(dir)) writeFileSync(`${dir}/live-fixture.json`, JSON.stringify(digest));
console.log(`live fixture: ${Object.keys(trains).length} trains, ${Object.values(trains).filter((t) => t.delay > 0).length} of them late`);
