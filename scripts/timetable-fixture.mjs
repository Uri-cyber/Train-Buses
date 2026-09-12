#!/usr/bin/env node
/**
 * A stand-in for the real timetable when the GTFS feed cannot be reached (the
 * checks, and any machine without internet): trains every 20 to 40 minutes
 * along each passenger route in data/network.json, 05:30 to 23:30, every day,
 * at 80 km/h with a minute at each stop. Written to public/ and dist/ so both
 * the dev server and the preview serve it at /timetable.json.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const net = JSON.parse(readFileSync('data/network.json', 'utf8'));
const stations = JSON.parse(readFileSync('data/stations.json', 'utf8')).stations;
const byId = Object.fromEntries(stations.map((s) => [s.id, s]));
const stops = {};
for (const s of stations) stops['S' + s.id] = { he: s.he, lat: s.lat, lon: s.lon };

const trips = [];
const SPEED = 80 / 3600;                 // km per second
for (const r of net.routes) {
  if (r.kind !== 'passenger') continue;
  const every = 20 * 60 + (r.len % 20) * 60;
  for (const dir of [1, -1]) {
    const seq = dir === 1 ? r.stops : r.stops.slice().reverse();
    for (let t0 = 5.5 * 3600; t0 <= 23.5 * 3600; t0 += every) {
      const list = [];
      let t = t0 + (dir === 1 ? 0 : 7 * 60);
      for (let i = 0; i < seq.length; i++) {
        if (i > 0) t += Math.abs(seq[i].d - seq[i - 1].d) / SPEED;
        const arr = Math.round(t), dep = Math.round(t + (i === 0 || i === seq.length - 1 ? 0 : 60));
        list.push(['S' + seq[i].id, arr, dep]);
        t = dep;
      }
      trips.push({ id: `${r.id}-${dir}-${Math.round(t0 / 60)}`, service: 'daily', route: r.he, head: byId[seq[seq.length - 1].id]?.he || '', stops: list });
    }
  }
}
const timetable = {
  fetched: Date.now(), source: 'fixture: synthetic trains on the bundled routes',
  stops, services: { daily: { days: [1, 1, 1, 1, 1, 1, 1], from: '20200101', to: '20991231', add: [], drop: [] } }, trips,
};
for (const dir of ['public', 'dist']) {
  if (dir === 'dist' && !existsSync('dist')) continue;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/timetable-fixture.json`, JSON.stringify(timetable));
}
console.log(`timetable fixture: ${trips.length} trips over ${net.routes.filter((r) => r.kind === 'passenger').length} routes`);
