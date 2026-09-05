/**
 * Writes public/fixtures/overpass-israel.json: an Overpass-shaped snapshot of
 * the bundled network (ways with geometry, station nodes with names), so the
 * browser's live-network path can be exercised headlessly where the real
 * Overpass API is unreachable:   http://127.0.0.1:4173/?osm=fixture
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { makeProjection } from '../src/geo.js';

const world = JSON.parse(readFileSync('data/world.json', 'utf8'));
const net = JSON.parse(readFileSync('data/network.json', 'utf8'));
const P = makeProjection(world.proj);
const ways = net.edges.map((e, i) => ({
  type: 'way', id: 100000 + i, tags: { railway: 'rail', name: e.line },
  geometry: e.pts.map(([x, z]) => { const [lon, lat] = P.toLonLat(x, z); return { lat: +lat.toFixed(6), lon: +lon.toFixed(6) }; }),
}));
const nodes = net.stations.map((s, i) => {
  const [lon, lat] = P.toLonLat(s.x, s.z);
  return { type: 'node', id: 900000 + i, lat: +lat.toFixed(6), lon: +lon.toFixed(6), tags: { railway: 'station', name: s.he, 'name:he': s.he, 'name:en': s.en } };
});
const out = JSON.stringify({ fetched: Date.now(), rails: { elements: ways }, stations: { elements: nodes } });
// public/ is copied into dist/ at build time; write to both so a running preview sees it
for (const dir of ['public/fixtures', 'dist/fixtures']) { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/overpass-israel.json`, out); }
console.log(`fixture: ${ways.length} ways, ${nodes.length} station nodes -> public/fixtures/overpass-israel.json`);
