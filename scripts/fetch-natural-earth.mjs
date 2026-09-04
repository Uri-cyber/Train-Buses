#!/usr/bin/env node
/**
 * Downloads Natural Earth 1:10m layers (public domain, hosted on GitHub), clips them
 * to the Israel bounding box, projects them to world units and writes data/world.json.
 *
 * Layers: coastline, lakes, railroads, roads, rivers, countries, populated places.
 * Countries and lakes are rasterised into run-length-encoded masks (land / Israel /
 * lake) so the app never has to do point-in-polygon work at runtime.
 *
 *   npm run data      (re-runnable; downloads are cached under .cache/ne/)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const LAYERS = [
  'ne_10m_coastline', 'ne_10m_lakes', 'ne_10m_railroads', 'ne_10m_roads',
  'ne_10m_rivers_lake_centerlines', 'ne_10m_admin_0_countries', 'ne_10m_populated_places',
];
const CACHE = '.cache/ne';
const OUT = 'data/world.json';

// The box: from the Lebanese border to the Red Sea, the Mediterranean to the Jordanian
// highlands. Everything the app shows lives inside it.
export const BBOX = { lon0: 34.20, lon1: 35.95, lat0: 29.40, lat1: 33.40 };
// Equirectangular projection centred on Israel. 1 world unit = 1 km; +x east, +z south.
export const PROJ = { lat0: 32.0, lon0: 35.0, kx: 111.32 * Math.cos((32.0 * Math.PI) / 180), kz: 110.574 };
export const project = ([lon, lat]) => [(lon - PROJ.lon0) * PROJ.kx, -(lat - PROJ.lat0) * PROJ.kz];

// Land/Israel/lake masks at ~0.4 km cells. Row 0 is the north edge.
const CELL = 0.004;
const MW = Math.round((BBOX.lon1 - BBOX.lon0) / CELL);
const MH = Math.round((BBOX.lat1 - BBOX.lat0) / CELL);

/* ---------------------------------------------------------------- download */

function fetchLayer(name) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${name}.geojson`);
  if (existsSync(file) && statSync(file).size > 1000) return JSON.parse(readFileSync(file, 'utf8'));
  const url = BASE + name + '.geojson';
  process.stdout.write(`  downloading ${name} ... `);
  // curl honours the environment's proxy settings, node's fetch does not
  execFileSync('curl', ['-sS', '-L', '--fail', '--retry', '4', '--retry-delay', '2', '-o', file, url], { stdio: 'inherit' });
  console.log(`${(statSync(file).size / 1e6).toFixed(1)} MB`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/* -------------------------------------------------------------- geometry */

const inBox = ([lon, lat]) => lon >= BBOX.lon0 && lon <= BBOX.lon1 && lat >= BBOX.lat0 && lat <= BBOX.lat1;

/** every LineString of a (Multi)LineString geometry */
function lines(g) {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}
/** every ring of a (Multi)Polygon geometry */
function rings(g) {
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
}

/** Clip a polyline to the box by splitting it into the runs of points that lie inside. */
function clipLine(coords) {
  const runs = [];
  let cur = [];
  for (const c of coords) {
    if (inBox(c)) cur.push(c);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}

/** Douglas-Peucker in projected km. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1e-12;
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, pz] = pts[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
      const d = Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > tol) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const projLine = (coords, tol) => simplify(coords.map(project), tol).map(([x, z]) => [r3(x), r3(z)]);

/* ------------------------------------------------------------- rasterise */

/** Scanline fill of a set of rings (even-odd) into `grid` with `value`. */
function fillRings(grid, ringList, value) {
  const edges = [];
  for (const ring of ringList) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if (y1 === y2) continue;
      edges.push([x1, y1, x2, y2]);
    }
  }
  for (let j = 0; j < MH; j++) {
    const y = BBOX.lat1 - (j + 0.5) * CELL;
    const xs = [];
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - BBOX.lon0) / CELL - 0.5));
      const i1 = Math.min(MW - 1, Math.floor((xs[k + 1] - BBOX.lon0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) grid[j * MW + i] = value;
    }
  }
}

function rle(grid) {
  const out = [];
  let v = grid[0], n = 0;
  for (const g of grid) {
    if (g === v) n++;
    else { out.push(v, n); v = g; n = 1; }
  }
  out.push(v, n);
  return out;
}

/* ------------------------------------------------------------------ main */

console.log('Natural Earth -> data/world.json');
const [coast, lakes, rails, roads, rivers, countries, places] = LAYERS.map(fetchLayer);

const touches = (f) => rings(f.geometry).concat(lines(f.geometry)).some((c) => c.some(inBox));

// countries -> id raster
const countryList = [];
const ids = new Uint8Array(MW * MH);
for (const f of countries.features) {
  if (!touches(f)) continue;
  const p = f.properties;
  const id = countryList.push({ name: p.NAME, name_en: p.NAME_EN, name_he: p.NAME_HE, a3: p.ADM0_A3 }) ;
  fillRings(ids, rings(f.geometry), id);
}
const israelId = countryList.findIndex((c) => c.a3 === 'ISR') + 1;

// lakes -> raster + rings
const lakeGrid = new Uint8Array(MW * MH);
const lakeList = [];
for (const f of lakes.features) {
  if (!touches(f)) continue;
  const p = f.properties;
  const id = lakeList.push({
    name_en: p.name_en || p.name, name_he: p.name_he || '',
    rings: rings(f.geometry).map((r) => projLine(r, 0.05)),
  });
  fillRings(lakeGrid, rings(f.geometry), id);
}

const coastLines = coast.features.flatMap((f) => lines(f.geometry).flatMap(clipLine)).map((l) => projLine(l, 0.05));
const railLines = rails.features.filter(touches).flatMap((f, fi) =>
  lines(f.geometry).flatMap(clipLine).map((l) => ({ id: fi, rank: f.properties.scalerank, pts: projLine(l, 0.03) })));
const roadLines = roads.features.filter(touches).flatMap((f) =>
  lines(f.geometry).flatMap(clipLine).map((l) => ({ type: f.properties.type, pts: projLine(l, 0.06) })));
const riverLines = rivers.features.filter(touches).flatMap((f) =>
  lines(f.geometry).flatMap(clipLine).map((l) => ({ name: f.properties.name_en || f.properties.name, pts: projLine(l, 0.06) })));
const placeList = places.features.filter((f) => inBox(f.geometry.coordinates)).map((f) => {
  const p = f.properties, [x, z] = project(f.geometry.coordinates);
  return { name_en: p.NAME_EN || p.NAME, name_he: p.NAME_HE || '', adm0: p.ADM0NAME, pop: p.POP_MAX, x: r3(x), z: r3(z) };
});

const world = {
  source: 'Natural Earth 1:10m (public domain), clipped and projected by scripts/fetch-natural-earth.mjs',
  bbox: BBOX, proj: PROJ,
  mask: { w: MW, h: MH, cell: CELL, israelId, countries: countryList, ids: rle(ids), lake: rle(lakeGrid) },
  coast: coastLines, rails: railLines, roads: roadLines, rivers: riverLines, lakes: lakeList, places: placeList,
};
mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify(world));

const count = (arr) => arr.reduce((n, l) => n + (l.pts ? l.pts.length : l.length), 0);
let land = 0, isr = 0, lake = 0;
for (let i = 0; i < ids.length; i++) { if (ids[i]) land++; if (ids[i] === israelId) isr++; if (lakeGrid[i]) lake++; }
console.log(`  mask ${MW}x${MH}: land ${(100 * land / ids.length).toFixed(1)}%, Israel ${(100 * isr / ids.length).toFixed(1)}%, lakes ${lake} cells`);
console.log(`  countries: ${countryList.map((c) => c.a3).join(' ')}`);
console.log(`  coast ${coastLines.length} lines/${count(coastLines)} pts, rails ${railLines.length}/${count(railLines)}, roads ${roadLines.length}/${count(roadLines)}, rivers ${riverLines.length}/${count(riverLines)}`);
console.log(`  lakes: ${lakeList.map((l) => l.name_en).join(', ')}; places: ${placeList.length}`);
console.log(`  wrote ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
