#!/usr/bin/env node
/**
 * The real Israel Railways timetable, from the Ministry of Transport's GTFS
 * feed (every bus and train in the country, a few hundred megabytes). Streams
 * the files out of the zip with `unzip -p`, keeps only the trains, and writes
 * a compact timetable the page can run the fleet from:
 *
 *   node scripts/fetch-gtfs.mjs [gtfs.zip] [out.json]
 *
 * Without a zip argument the feed is downloaded first (needs curl). Output:
 *   { fetched, source, stops: { id: { he, lat, lon } },
 *     services: { id: { days: [sun..sat as 0/1], from: 'YYYYMMDD', to: 'YYYYMMDD', add: [], drop: [] } },
 *     trips: [ { id, service, route, head, stops: [ [stopId, arrSec, depSec], ... ] } ] }
 * Times are seconds after midnight of the service day; trips after midnight run past 86400.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FEED = 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip';
const zip = process.argv[2] || 'gtfs.zip';
const out = process.argv[3] || 'data/timetable.json';

if (!existsSync(zip)) {
  console.log(`downloading ${FEED} …`);
  execFileSync('curl', ['-L', '--fail', '--retry', '3', '-o', zip, FEED], { stdio: 'inherit' });
}

// a tiny CSV reader: quoted fields, BOM, CRLF
const splitCsv = (line) => {
  const cells = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
};
async function readTable(name, onRow) {
  const p = spawn('unzip', ['-p', zip, name]);
  const rl = createInterface({ input: p.stdout, crlfDelay: Infinity });
  let header = null, n = 0;
  for await (const raw of rl) {
    const line = raw.replace(/^﻿/, '').replace(/\r$/, '');
    if (!line) continue;
    const cells = splitCsv(line);
    if (!header) { header = cells.map((h) => h.trim()); continue; }
    const row = {}; header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    onRow(row); n++;
  }
  return n;
}
const secs = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };

// 1. which agency is Israel Railways
const agencies = {};
await readTable('agency.txt', (r) => { agencies[r.agency_id] = r.agency_name; });
const railAgency = Object.keys(agencies).find((id) => /רכבת ישראל|Israel Railways/i.test(agencies[id]));
console.log('agencies:', Object.keys(agencies).length, 'rail agency:', railAgency, agencies[railAgency]);

// 2. rail routes and trips
const routes = {};
await readTable('routes.txt', (r) => { if (r.agency_id === railAgency || r.route_type === '2') routes[r.route_id] = { name: r.route_long_name || r.route_short_name, short: r.route_short_name }; });
const trips = {};
await readTable('trips.txt', (r) => { if (routes[r.route_id]) trips[r.trip_id] = { id: r.trip_id, service: r.service_id, route: r.route_id, head: r.trip_headsign || '', dir: r.direction_id, stops: [] }; });
console.log('rail routes:', Object.keys(routes).length, 'rail trips:', Object.keys(trips).length);

// 3. stop times: the big one, streamed
const rows = await readTable('stop_times.txt', (r) => {
  const t = trips[r.trip_id]; if (!t) return;
  t.stops.push([+r.stop_sequence, r.stop_id, secs(r.arrival_time), secs(r.departure_time)]);
});
console.log('stop_times rows:', rows);
const usedStops = new Set();
for (const t of Object.values(trips)) {
  t.stops.sort((a, b) => a[0] - b[0]);
  t.stops = t.stops.map(([, id, a, d]) => [id, a, d]);
  for (const s of t.stops) usedStops.add(s[0]);
}

// 4. stops and services
const stops = {};
await readTable('stops.txt', (r) => { if (usedStops.has(r.stop_id)) stops[r.stop_id] = { he: r.stop_name, lat: +r.stop_lat, lon: +r.stop_lon }; });
const services = {};
await readTable('calendar.txt', (r) => {
  services[r.service_id] = { days: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => +r[d]), from: r.start_date, to: r.end_date, add: [], drop: [] };
});
try {
  await readTable('calendar_dates.txt', (r) => {
    const s = services[r.service_id] || (services[r.service_id] = { days: [0, 0, 0, 0, 0, 0, 0], from: '00000000', to: '99999999', add: [], drop: [] });
    (r.exception_type === '1' ? s.add : s.drop).push(r.date);
  });
} catch { /* optional file */ }
const usedServices = new Set(Object.values(trips).map((t) => t.service));
for (const id of Object.keys(services)) if (!usedServices.has(id)) delete services[id];

const list = Object.values(trips).filter((t) => t.stops.length >= 2).map((t) => ({ id: t.id, service: t.service, route: routes[t.route]?.name || '', head: t.head, stops: t.stops }));
const result = { fetched: Date.now(), source: 'Israel Ministry of Transport GTFS, Israel Railways trips', stops, services, trips: list };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result));
console.log(`wrote ${out}: ${list.length} trips, ${Object.keys(stops).length} stops, ${Object.keys(services).length} services, ${(JSON.stringify(result).length / 1024).toFixed(0)} KB`);
