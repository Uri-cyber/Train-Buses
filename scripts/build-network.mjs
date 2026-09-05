#!/usr/bin/env node
/**
 * Builds data/network.json from
 *   data/world.json      Natural Earth rail geometry (real, older)
 *   data/osm-rail.json   optional OpenStreetMap rails + stations, see fetch-osm.mjs
 *   data/stations.json   curated Israel Railways stations (used when no OSM file exists)
 * The graph logic lives in src/network-build.js, which the browser also uses
 * when it fetches the live network itself.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { makeProjection } from '../src/geo.js';
import { buildNetwork, roundNetwork } from '../src/network-build.js';

const world = JSON.parse(readFileSync('data/world.json', 'utf8'));
const P = makeProjection(world.proj);
const osm = existsSync('data/osm-rail.json') ? JSON.parse(readFileSync('data/osm-rail.json', 'utf8')) : null;
const curated = JSON.parse(readFileSync('data/stations.json', 'utf8'));

const rails = osm ? osm.rails : world.rails.map((r) => ({ pts: r.pts, line: 'ne', real: true }));
const stations = (osm ? osm.stations : curated.stations).map((s) => {
  const [x, z] = s.x !== undefined ? [s.x, s.z] : P.toXZ(s.lon, s.lat);
  return { id: s.id, he: s.he, en: s.en, x, z, line: s.line || '', approx: !osm };
});

const net = buildNetwork({ world, rails, stations, trimWater: !osm, log: (m) => console.warn('  !', m) });
const out = roundNetwork({
  source: osm ? 'OpenStreetMap (ODbL) via scripts/fetch-osm.mjs' : 'Natural Earth 1:10m rails plus generated lines for stations opened after the data was drawn',
  ...net,
});
writeFileSync('data/network.json', JSON.stringify(out));

const realKm = net.edges.filter((e) => e.real).reduce((n, e) => n + e.len, 0);
const genKm = net.edges.filter((e) => !e.real).reduce((n, e) => n + e.len, 0);
console.log(`network: ${net.nodes.length} nodes, ${net.edges.length} edges, ${realKm.toFixed(0)} km real + ${genKm.toFixed(0)} km generated (${net.generatedLines.join(', ') || 'none'})`);
console.log(`stations: ${net.stations.length} snapped, ${net.orphans.length} orphans${net.orphans.length ? ': ' + net.orphans.join(', ') : ''}`);
for (const r of net.routes) console.log(`  route ${r.id.padEnd(20)} ${r.len.toFixed(0).padStart(4)} km, ${r.stops.length} stops`);
if (net.skippedRoutes.length) console.log(`  skipped routes: ${net.skippedRoutes.join(', ')}`);
console.log(`wrote data/network.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
if (net.orphans.length) process.exit(1);
