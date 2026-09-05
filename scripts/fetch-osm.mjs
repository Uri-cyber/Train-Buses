#!/usr/bin/env node
/**
 * Fetches the current Israel Railways network and stations from OpenStreetMap
 * (Overpass API) and writes data/osm-rail.json, so the bundled fallback can be
 * refreshed too. Run it on a normal PC:
 *
 *     npm run fetch:osm
 *
 * The app does the same fetch by itself in the browser (src/osm.js); this
 * script only refreshes the snapshot that ships in the build.
 * Data (c) OpenStreetMap contributors, ODbL.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { QUERIES, bboxString, parseOverpass } from '../src/osm-parse.js';
import { dist } from '../src/geo.js';

const world = JSON.parse(readFileSync('data/world.json', 'utf8'));
const curated = JSON.parse(readFileSync('data/stations.json', 'utf8')).stations;
const bbox = bboxString(world);
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

async function overpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
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
const railsJson = await overpass(QUERIES.rails(bbox));
console.log('  stations ...');
const stationsJson = await overpass(QUERIES.stations(bbox));
const { rails, stations } = parseOverpass({ railsJson, stationsJson, world, curated });
mkdirSync('data', { recursive: true });
writeFileSync('data/osm-rail.json', JSON.stringify({ source: 'OpenStreetMap contributors (ODbL), Overpass API', fetched: new Date().toISOString(), rails, stations }));
const km = rails.reduce((n, r) => n + r.pts.reduce((m, p, i) => (i ? m + dist(p, r.pts[i - 1]) : 0), 0), 0);
console.log(`  ${rails.length} rail ways (${km.toFixed(0)} km), ${stations.length} stations. Now run: node scripts/build-network.mjs`);
