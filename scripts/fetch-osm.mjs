#!/usr/bin/env node
/**
 * Fetches the current Israel Railways network and stations from OpenStreetMap
 * (Overpass API) and writes data/osm-rail.json. Run this on a normal PC:
 *
 *     npm run fetch:osm
 *
 * (It cannot run inside the hosted build sandbox, whose network policy blocks
 * OpenStreetMap; that is the only reason the app ships with Natural Earth rails.)
 * After it succeeds, scripts/build-network.mjs prefers the OSM file automatically.
 *
 * Data: (c) OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeProjection, makeMask, dist } from '../src/geo.js';

const world = JSON.parse(readFileSync('data/world.json', 'utf8'));
const curated = JSON.parse(readFileSync('data/stations.json', 'utf8')).stations;
const P = makeProjection(world.proj);
const mask = makeMask(world);
const { lon0, lon1, lat0, lat1 } = world.bbox;
const BBOX = `${lat0},${lon0},${lat1},${lon1}`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function overpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'israel-by-rail/2.0 (data fetch)' } });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      try {   // curl honours proxy settings that node's fetch ignores
        const out = execFileSync('curl', ['-sS', '--fail', '-m', '240', '--data-urlencode', `data=${query}`, url], { maxBuffer: 1 << 30 });
        return JSON.parse(out.toString('utf8'));
      } catch (e2) { lastErr = e2; }
    }
  }
  throw lastErr;
}

console.log('OpenStreetMap -> data/osm-rail.json');
console.log('  rails ...');
const rails = await overpass(`[out:json][timeout:240];
  way["railway"="rail"][!"service"]["railway:preserved"!="yes"](${BBOX});
  out geom;`);
console.log('  stations ...');
const stations = await overpass(`[out:json][timeout:180];
  ( node["railway"="station"](${BBOX}); way["railway"="station"](${BBOX}); node["railway"="halt"](${BBOX}); );
  out center tags;`);

const r3 = (v) => Math.round(v * 1000) / 1000;
const inIsrael = (lon, lat) => { const [x, z] = P.toXZ(lon, lat); return mask.nearIsrael(x, z, 2); };

const railOut = [];
for (const w of rails.elements) {
  if (!w.geometry) continue;
  const pts = w.geometry.filter((g) => inIsrael(g.lon, g.lat)).map((g) => P.toXZ(g.lon, g.lat).map(r3));
  if (pts.length < 2) continue;
  const t = w.tags || {};
  railOut.push({ id: w.id, pts, tunnel: t.tunnel === 'yes', bridge: !!t.bridge, name: t.name || '', line: t['name:en'] || t.name || 'osm' });
}

const slug = (s) => s.toLowerCase().replace(/['’"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const curatedXZ = curated.map((c) => ({ ...c, p: P.toXZ(c.lon, c.lat) }));
const stOut = [];
const seen = new Set();
for (const e of stations.elements) {
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  const t = e.tags || {};
  if (lat === undefined || !inIsrael(lon, lat)) continue;
  if (t.subway === 'yes' || t.light_rail === 'yes' || t.tram === 'yes') continue;      // Jerusalem light rail etc.
  const he = t['name:he'] || t.name || '';
  const en = t['name:en'] || t['int_name'] || '';
  if (!he && !en) continue;
  const [x, z] = P.toXZ(lon, lat);
  // keep the curated id when this is the same station, so routes keep working
  let id = null;
  for (const c of curatedXZ) if (dist(c.p, [x, z]) < 3 && !seen.has(c.id)) { id = c.id; break; }
  if (!id) id = slug(en) || `osm-${e.id}`;
  if (seen.has(id)) continue;
  seen.add(id);
  stOut.push({ id, he, en: en || he, x: r3(x), z: r3(z), osm: e.id });
}

mkdirSync('data', { recursive: true });
writeFileSync('data/osm-rail.json', JSON.stringify({
  source: 'OpenStreetMap contributors (ODbL), Overpass API', fetched: new Date().toISOString(),
  rails: railOut, stations: stOut,
}));
const km = railOut.reduce((n, r) => n + r.pts.reduce((m, p, i) => (i ? m + dist(p, r.pts[i - 1]) : 0), 0), 0);
console.log(`  ${railOut.length} rail ways (${km.toFixed(0)} km), ${stOut.length} stations. Now run: node scripts/build-network.mjs`);
