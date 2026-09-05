#!/usr/bin/env node
/**
 * Automated clearance and integrity check.
 *
 * Part 1 (no browser): the network data itself. Stations sit on a line,
 * every route is connected end to end and lies on Israel's land.
 * Part 2 (headless Chromium against the preview): the live scene. Every
 * train car sits on its route and above the ground; no building, tree or
 * landmark stands on a rail or a road, or in the water.
 *
 *   npm run check              (part 1 only if no preview is running)
 */
import { readFileSync, existsSync } from 'node:fs';
import { makeMask, makeProjection, makePathLookup, nearestOnPolyline, dist } from '../src/geo.js';

const world = JSON.parse(readFileSync('data/world.json', 'utf8'));
const network = JSON.parse(readFileSync('data/network.json', 'utf8'));
const mask = makeMask(world);
const failures = [];
const fail = (rule, detail) => failures.push({ rule, detail });

/* ------------------------------------------------------------- part 1 */
const edgeLookups = network.edges.map((e) => ({ e, lk: makePathLookup(e.pts) }));

// stations on a line
for (const s of network.stations) {
  let best = Infinity;
  for (const e of network.edges) best = Math.min(best, nearestOnPolyline([s.x, s.z], e.pts).d);
  if (best > 0.3) fail('station off the line', `${s.id} is ${best.toFixed(2)} km from the nearest rail`);
  if (!mask.nearIsrael(s.x, s.z, 3) || !mask.isLand(s.x, s.z)) fail('station off the map', `${s.id} is not on Israel's land`);
}
// routes connected, stops ordered, polyline continuous
for (const r of network.routes) {
  for (let i = 0; i + 1 < r.edges.length; i++) {
    const a = network.edges[r.edges[i].e], b = network.edges[r.edges[i + 1].e];
    const endA = r.edges[i].dir === 1 ? a.b : a.a, startB = r.edges[i + 1].dir === 1 ? b.a : b.b;
    if (endA !== startB) fail('route not connected', `${r.id}: edge ${i} ends at node ${endA}, edge ${i + 1} starts at ${startB}`);
  }
  for (let i = 1; i < r.pts.length; i++) if (dist(r.pts[i - 1], r.pts[i]) > 8) fail('route jump', `${r.id}: ${dist(r.pts[i - 1], r.pts[i]).toFixed(2)} km gap at point ${i}`);
  for (let i = 1; i < r.stops.length; i++) if (r.stops[i].d < r.stops[i - 1].d) fail('stops out of order', `${r.id}: ${r.stops[i].id}`);
  if (r.stops.length < 2 && r.kind !== 'freight') fail('route without stops', r.id);
}
// rails on land, inside the core map
for (const { e, lk } of edgeLookups) {
  for (let d = 0; d <= lk.length; d += 1) {
    const p = lk.at(d);
    if (!mask.isLandNear(p.x, p.z, 3)) { fail('rail in the water', `edge ${e.line} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`); break; }
    if (!mask.nearIsrael(p.x, p.z, 3)) { fail('rail outside the map', `edge ${e.line} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`); break; }
  }
}
console.log(`part 1: ${network.stations.length} stations, ${network.edges.length} edges, ${network.routes.length} routes checked`);

/* ------------------------------------------------------------- part 2 */
const URL = process.argv[2] || process.env.URL || 'http://127.0.0.1:4173/';
let live = false;
try { const r = await fetch(URL); live = r.ok; } catch { live = false; }
if (!live) {
  console.log('part 2 skipped: no preview at ' + URL + ' (run `npm run preview` first)');
} else {
  const { chromium } = await import('playwright');
  const EXE = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p)); // undefined = Playwright's own Chromium
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__app, null, { timeout: 120000 });
  await page.evaluate(() => window.__app.tour.set(false));      // the auto tour would move the camera under us
  if (/[?&]osm=/.test(URL)) await page.waitForFunction(() => window.__app.liveStatus?.applied || window.__app.liveStatus?.failed || window.__app.liveStatus?.thin, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const report = await page.evaluate(() => {
    const a = window.__app;
    const out = { trains: 0, carsOff: [], carsUnder: [], onRail: [], onRoad: [], inWater: [], items: 0, stations: 0, stationsNoPlate: 0 };
    // trains sit on their route, above the ground
    const m = new a.THREE.Matrix4();
    const v = new a.THREE.Vector3();
    for (const t of a.trains.trains) {
      out.trains++;
      let back = 0;
      for (const car of t.cars) {
        const dc = t.d - t.dir * (back + car.len / 2);
        const p = t.route.lookup.at(dc);
        const ty = a.trains.types[car.type];
        ty.solid.getMatrixAt(car.idx, m);
        v.setFromMatrixPosition(m);
        // cars run on their own lane, laneOffset from the centreline
        const off = Math.abs(Math.hypot(v.x - p.x, v.z - p.z) - a.TRACK.laneOffset * Math.abs(t.side));
        if (off > 0.8) out.carsOff.push(`${t.route.id} ${car.type} ${off.toFixed(2)} km off the line`);
        // the car must sit on the rail profile (which itself may run through a cutting)
        const railY = t.route.heightAt(dc) + a.TRACK.railH;
        if (Math.abs(v.y - railY) > 0.08) out.carsUnder.push(`${t.route.id} ${car.type} ${(v.y - railY).toFixed(2)} km off the railhead`);
        back += car.len + 0.08 * a.trains.SCALE;
      }
    }
    // placed things keep off rails, roads and water
    for (const it of a.occupancy.items) {
      if (!['building', 'tree', 'landmark'].includes(it.kind)) continue;
      out.items++;
      // rails are registered with a buffer beyond the formation; the real corridor is corridorHalf each side
      const onRail = a.occupancy.hit(it.x, it.z, Math.max(0, it.r - (a.occupancy.railR - a.TRACK.corridorHalf)), (o) => o.kind === 'rail');
      if (onRail) out.onRail.push(`${it.kind} at (${it.x.toFixed(1)}, ${it.z.toFixed(1)})`);
      if (it.kind !== 'landmark') {
        const onRoad = a.occupancy.hit(it.x, it.z, Math.max(0, it.r - 0.02), (o) => o.kind === 'road');
        if (onRoad) out.onRoad.push(`${it.kind} at (${it.x.toFixed(1)}, ${it.z.toFixed(1)})`);
      }
      if (it.kind !== 'landmark' && !a.terrain.mask.isLand(it.x, it.z)) out.inWater.push(`${it.kind} at (${it.x.toFixed(1)}, ${it.z.toFixed(1)})`);   // quays and marinas are meant to be in the water
    }
    for (const s of a.stations.stations) { out.stations++; if (!s.sprite || !s.hit) out.stationsNoPlate++; }
    return out;
  });
  const live = await page.evaluate(() => window.__app.liveStatus);
  await browser.close();
  if (/[?&]osm=/.test(URL) && !live?.applied) fail('live network not applied', JSON.stringify(live));
  if (live?.applied) console.log(`live network applied from ${live.source}: ${live.edges} edges, ${live.stations} stations, ${live.routes} routes in ${live.ms} ms`);
  for (const e of errors) fail('page error', e);
  for (const c of report.carsOff) fail('train off its line', c);
  for (const c of report.carsUnder) fail('train off the railhead', c);
  for (const c of report.onRail) fail('object on a rail', c);
  for (const c of report.onRoad) fail('object on a road', c);
  for (const c of report.inWater) fail('object in the water', c);
  if (report.stationsNoPlate) fail('station without plate', `${report.stationsNoPlate} stations`);
  console.log(`part 2: ${report.trains} trains, ${report.items} placed objects, ${report.stations} stations checked in the live scene`);
}

/* ------------------------------------------------------------- report */
const byRule = failures.reduce((m, f) => ((m[f.rule] ??= []).push(f.detail), m), {});
if (!failures.length) { console.log('PASS  nothing clips, nothing floats, every line connects'); process.exit(0); }
for (const [rule, list] of Object.entries(byRule)) {
  console.log(`\nFAIL  ${rule}  (${list.length})`);
  list.slice(0, 10).forEach((d) => console.log('   -', d));
  if (list.length > 10) console.log(`   ... and ${list.length - 10} more`);
}
process.exit(1);
