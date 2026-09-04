#!/usr/bin/env node
/**
 * Builds the railway graph the app runs trains on, from
 *   data/world.json      Natural Earth rail geometry (real, older)
 *   data/osm-rail.json   optional OpenStreetMap rails + stations (real, current), see fetch-osm.mjs
 *   data/stations.json   curated Israel Railways stations (used when no OSM file exists)
 *
 * Lines that exist today but are missing from the geometry (opened after the
 * data was drawn) are generated from their station sequence, smoothed, and
 * joined onto the real network at the junction where they really branch.
 * Every such edge is flagged `real: false` so the app can say so.
 *
 * Output: data/network.json  { nodes, edges, stations, routes }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  makeProjection, makeMask, dist, polylineLength, nearestOnPolyline, catmullRom,
} from '../src/geo.js';

const world = JSON.parse(readFileSync('data/world.json', 'utf8'));
const P = makeProjection(world.proj);
const mask = makeMask(world);
const osm = existsSync('data/osm-rail.json') ? JSON.parse(readFileSync('data/osm-rail.json', 'utf8')) : null;
const curated = JSON.parse(readFileSync('data/stations.json', 'utf8'));

/* ------------------------------------------------------------- the graph */

const nodes = [];      // [x, z]
const edges = [];      // { a, b, pts, len, real, line }
const NODE_TOL = 0.05; // km: endpoints closer than this are the same node

function nodeAt(p) {
  for (let i = 0; i < nodes.length; i++) if (dist(nodes[i], p) < NODE_TOL) return i;
  nodes.push([p[0], p[1]]);
  return nodes.length - 1;
}
function addEdge(pts, real, line) {
  if (pts.length < 2 || polylineLength(pts) < 0.05) return -1;
  const a = nodeAt(pts[0]), b = nodeAt(pts[pts.length - 1]);
  if (a === b && polylineLength(pts) < 0.5) return -1;
  pts = pts.slice(); pts[0] = nodes[a].slice(); pts[pts.length - 1] = nodes[b].slice();
  edges.push({ a, b, pts, len: polylineLength(pts), real, line });
  return edges.length - 1;
}
/** Split edge `ei` at (segment `seg`, point p); returns the new node index. */
function splitEdge(ei, seg, p) {
  const e = edges[ei];
  if (dist(p, nodes[e.a]) < NODE_TOL) return e.a;
  if (dist(p, nodes[e.b]) < NODE_TOL) return e.b;
  const n = nodeAt(p);
  const first = e.pts.slice(0, seg + 1).concat([nodes[n].slice()]);
  const second = [nodes[n].slice()].concat(e.pts.slice(seg + 1));
  edges[ei] = { ...e, b: n, pts: first, len: polylineLength(first) };
  edges.push({ ...e, a: n, pts: second, len: polylineLength(second) });
  return n;
}
/** Nearest point on any edge to p within maxKm: { ei, seg, x, z, d } or null. */
function nearestEdgePoint(p, maxKm, filter = () => true) {
  let best = null;
  edges.forEach((e, ei) => {
    if (!filter(e)) return;
    const r = nearestOnPolyline(p, e.pts);
    if (r.d <= maxKm && (!best || r.d < best.d)) best = { ei, ...r };
  });
  return best;
}
function attach(p, maxKm, filter) {
  const r = nearestEdgePoint(p, maxKm, filter);
  return r ? splitEdge(r.ei, r.seg, [r.x, r.z]) : -1;
}

/* ---------------------------------------------------- 1. real geometry */

/** Keep the runs of a polyline that lie in (or right beside) Israel. */
function israelRuns(pts) {
  const runs = []; let cur = [];
  for (const p of pts) {
    if (mask.nearIsrael(p[0], p[1], 2) && mask.isLand(p[0], p[1])) cur.push(p);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => polylineLength(r) >= 0.8);
}

const realSource = osm ? osm.rails : world.rails;
let realCount = 0;
for (const r of realSource) {
  for (const run of israelRuns(r.pts)) { if (addEdge(run, true, r.line || 'ne') >= 0) realCount++; }
}
// Natural Earth draws separate features that meet mid-line; join any dangling
// end that sits on another edge (T-junctions the merge-by-endpoint missed).
for (let i = 0; i < nodes.length; i++) {
  const deg = edges.reduce((n, e) => n + (e.a === i) + (e.b === i), 0);
  if (deg !== 1) continue;
  const r = nearestEdgePoint(nodes[i], 0.6, (e) => e.a !== i && e.b !== i);
  if (r) { const n = splitEdge(r.ei, r.seg, [r.x, r.z]); if (n !== i) addEdge([nodes[i], nodes[n]], true, 'join'); }
}

/* ------------------------------------------------- 2. station positions */

const stations = (osm ? osm.stations : curated.stations).map((s) => {
  const [x, z] = s.x !== undefined ? [s.x, s.z] : P.toXZ(s.lon, s.lat);
  return { id: s.id, he: s.he, en: s.en, x, z, line: s.line || '', approx: !osm };
});
const byId = Object.fromEntries(stations.map((s) => [s.id, s]));
const S = (id) => { if (!byId[id]) throw new Error(`unknown station ${id}`); return [byId[id].x, byId[id].z]; };
const NEAR = 1.5; // km: a station this close to an existing edge is on it

/* --------------------------------------- 3. generated (missing) lines */
// Each line: control points (station ids or [lat, lon] waypoints). The first
// point is joined to the nearest existing edge; `end: 'join'` also joins the
// last point. Lines are only generated when one of their stations is not
// already on the network, so an OSM file with full coverage makes this a no-op.
const LINES = [
  // The Ayalon between Savidor and HaHagana is not in the Natural Earth data,
  // which would send every southbound train round through Rosh HaAyin.
  { id: 'ayalon',    ctrl: ['tel-aviv-savidor', 'tel-aviv-hashalom', 'tel-aviv-hahagana'], end: 'join', force: true },
  { id: 'karmiel',   ctrl: ['akko', 'ahihud', 'karmiel'] },
  { id: 'valley',    ctrl: ['lev-hamifratz', [32.760, 35.090], 'kfar-yehoshua', 'kfar-baruch', 'afula', [32.560, 35.420], 'beit-shean'] },
  { id: 'airport',   ctrl: ['kfar-habad', 'ben-gurion-airport', 'paatei-modiin', 'modiin-center'] },
  { id: 'jerusalem-fast', ctrl: ['paatei-modiin', [31.845, 34.985], [31.822, 35.035], [31.810, 35.100], [31.800, 35.160], 'jerusalem-navon'] },
  { id: 'sharon-west', ctrl: ['herzliya', 'raanana-west', 'raanana-south', 'hod-hasharon', 'kfar-saba'], end: 'join' },
  { id: 'batyam',    ctrl: ['tel-aviv-hahagana', 'holon-junction', 'holon-wolfson', 'bat-yam-yoseftal', 'bat-yam-komemiyut', 'rishon-moshe-dayan', 'yavne-west'], end: 'join' },
  { id: 'south',     ctrl: ['ashkelon', 'sderot', 'netivot', 'ofakim', 'beersheba-north'], end: 'join' },
  { id: 'beersheba-center', ctrl: ['beersheba-north', 'beersheba-center'] },
  { id: 'dimona',    ctrl: [[31.115, 35.045], 'dimona'] },
];

const generated = [];
for (const line of LINES) {
  if (osm) continue;                                      // OSM already has everything
  const ids = line.ctrl.filter((c) => typeof c === 'string');
  const needed = line.force || ids.some((id) => !nearestEdgePoint(S(id), NEAR));
  if (!needed) continue;
  const ctrl = line.ctrl.map((c) => (typeof c === 'string' ? S(c) : P.toXZ(c[1], c[0])));
  const pts = catmullRom(ctrl, 0.25);
  const startNode = attach(pts[0], 8, (e) => true);
  if (startNode < 0) { console.warn(`  ! ${line.id}: no edge within 8 km of its start`); continue; }
  pts[0] = nodes[startNode].slice();
  let endPts = pts;
  if (line.end === 'join') {
    const endNode = attach(pts[pts.length - 1], 8, (e) => e.line !== line.id);
    if (endNode >= 0) endPts = pts.concat([nodes[endNode].slice()]);
  }
  const ei = addEdge(endPts, false, line.id);
  if (ei >= 0) generated.push(line.id);
}

/* --------------------------------------------- 4. snap stations to edges */

const orphans = [];
for (const s of stations) {
  const r = nearestEdgePoint([s.x, s.z], 6);
  if (!r) { orphans.push(s.id); continue; }
  const n = splitEdge(r.ei, r.seg, [r.x, r.z]);
  s.x = nodes[n][0]; s.z = nodes[n][1]; s.node = n; s.snapKm = Math.round(r.d * 100) / 100;
  s.real = edges[r.ei].real;
}

/* ---------------------------------------------------------- 5. routes */

function adjacency() {
  const adj = nodes.map(() => []);
  edges.forEach((e, ei) => { adj[e.a].push({ to: e.b, ei, dir: 1 }); adj[e.b].push({ to: e.a, ei, dir: -1 }); });
  return adj;
}
function dijkstra(adj, from, to) {
  const d = new Float64Array(nodes.length).fill(Infinity), prev = new Array(nodes.length).fill(null);
  d[from] = 0;
  const open = new Set([from]);
  while (open.size) {
    let u = -1;
    for (const n of open) if (u < 0 || d[n] < d[u]) u = n;
    open.delete(u);
    if (u === to) break;
    for (const { to: v, ei, dir } of adj[u]) {
      const nd = d[u] + edges[ei].len;
      if (nd < d[v]) { d[v] = nd; prev[v] = { u, ei, dir }; open.add(v); }
    }
  }
  if (!isFinite(d[to])) return null;
  const path = [];
  for (let v = to; prev[v]; v = prev[v].u) path.unshift(prev[v]);
  return path;                                            // [{u, ei, dir}]
}

const ROUTES = [
  { id: 'nahariya-beersheba', kind: 'passenger', he: 'נהריה – באר שבע', en: 'Nahariya – Beersheba',
    via: ['nahariya', 'haifa-center', 'tel-aviv-savidor', 'lod', 'kiryat-gat', 'beersheba-north', 'beersheba-center'] },
  { id: 'karmiel-telaviv', kind: 'passenger', he: 'כרמיאל – תל אביב', en: 'Karmiel – Tel Aviv',
    via: ['karmiel', 'akko', 'haifa-center', 'tel-aviv-savidor', 'tel-aviv-hahagana'] },
  { id: 'valley-heritage', kind: 'heritage', he: 'רכבת העמק (מורשת)', en: 'Valley Railway (heritage)',
    via: ['beit-shean', 'afula', 'kfar-yehoshua', 'lev-hamifratz', 'haifa-center'] },
  { id: 'jerusalem-fast', kind: 'passenger', he: 'ירושלים נבון – הרצליה', en: 'Jerusalem Navon – Herzliya',
    via: ['jerusalem-navon', 'ben-gurion-airport', 'tel-aviv-hahagana', 'tel-aviv-savidor', 'herzliya'] },
  { id: 'jerusalem-old', kind: 'passenger', he: 'ירושלים מלחה – תל אביב', en: 'Jerusalem Malha – Tel Aviv',
    via: ['jerusalem-malha', 'beit-shemesh', 'lod', 'tel-aviv-hahagana', 'tel-aviv-savidor'] },
  { id: 'modiin-nahariya', kind: 'passenger', he: 'מודיעין – נהריה', en: "Modi'in – Nahariya",
    via: ['modiin-center', 'ben-gurion-airport', 'tel-aviv-savidor', 'binyamina', 'haifa-hof-hacarmel', 'nahariya'] },
  { id: 'ashkelon-beersheba', kind: 'passenger', he: 'אשקלון – באר שבע', en: 'Ashkelon – Beersheba',
    via: ['ashkelon', 'sderot', 'netivot', 'ofakim', 'beersheba-north', 'beersheba-center'] },
  { id: 'batyam-ashkelon', kind: 'passenger', he: 'תל אביב – בת ים – אשקלון', en: 'Tel Aviv – Bat Yam – Ashkelon',
    via: ['tel-aviv-savidor', 'tel-aviv-hahagana', 'bat-yam-yoseftal', 'rishon-moshe-dayan', 'yavne-west', 'ashdod', 'ashkelon'] },
  { id: 'sharon', kind: 'passenger', he: 'הרצליה – כפר סבא', en: 'Herzliya – Kfar Saba',
    via: ['tel-aviv-savidor', 'herzliya', 'raanana-west', 'raanana-south', 'hod-hasharon', 'kfar-saba'] },
  { id: 'rosh-haayin', kind: 'passenger', he: 'תל אביב – ראש העין', en: "Tel Aviv – Rosh HaAyin",
    via: ['tel-aviv-hahagana', 'tel-aviv-savidor', 'bnei-brak', 'petah-tikva-kiryat-arye', 'petah-tikva-segula', 'rosh-haayin'] },
  { id: 'dimona', kind: 'passenger', he: 'דימונה – תל אביב', en: 'Dimona – Tel Aviv',
    via: ['dimona', 'beersheba-north', 'kiryat-gat', 'lod', 'tel-aviv-savidor'] },
  { id: 'phosphate', kind: 'freight', he: 'פוספטים: צין – נמל אשדוד', en: 'Phosphate: Zin – Ashdod port',
    via: [[30.922, 35.026], 'kiryat-gat', 'lod', [31.833, 34.645]] },
  { id: 'haifa-port', kind: 'freight', he: 'מכולות: לוד – נמל חיפה', en: 'Containers: Lod – Haifa port',
    via: ['lod', 'tel-aviv-savidor', 'hadera-west', 'haifa-center', 'hutzot-hamifratz'] },
];

const adj = adjacency();
const routes = [];
for (const R of ROUTES) {
  const nodesVia = R.via.map((v) => {
    if (typeof v === 'string') { if (byId[v]?.node === undefined) throw new Error(`${R.id}: station ${v} is not on the network`); return byId[v].node; }
    const [x, z] = P.toXZ(v[1], v[0]);
    let best = -1, bd = Infinity;
    nodes.forEach((n, i) => { const d = dist(n, [x, z]); if (d < bd) { bd = d; best = i; } });
    return best;
  });
  const steps = [];
  let ok = true;
  for (let i = 0; i + 1 < nodesVia.length; i++) {
    const seg = dijkstra(adj, nodesVia[i], nodesVia[i + 1]);
    if (!seg) { console.warn(`  ! ${R.id}: no path ${R.via[i]} -> ${R.via[i + 1]}`); ok = false; break; }
    steps.push(...seg);
  }
  if (!ok) continue;
  // flatten to a polyline and note where the stations are along it
  const pts = [];
  const nodeD = new Map();
  let d = 0;
  for (const { u, ei, dir } of steps) {
    const e = edges[ei];
    const p = dir === 1 ? e.pts : e.pts.slice().reverse();
    if (!nodeD.has(u)) nodeD.set(u, d);
    for (let i = pts.length ? 1 : 0; i < p.length; i++) { if (pts.length) d += dist(pts[pts.length - 1], p[i]); pts.push(p[i]); }
    const v = dir === 1 ? e.b : e.a;
    if (!nodeD.has(v)) nodeD.set(v, d);
  }
  const stops = stations.filter((s) => nodeD.has(s.node)).map((s) => ({ id: s.id, d: nodeD.get(s.node) })).sort((a, b) => a.d - b.d);
  routes.push({ ...R, via: undefined, edges: steps.map((s) => ({ e: s.ei, dir: s.dir })), pts, len: d, stops });
}

/* ---------------------------------------------------------- 6. write */

const r3 = (v) => Math.round(v * 1000) / 1000;
const out = {
  source: osm ? 'OpenStreetMap (ODbL) via scripts/fetch-osm.mjs' : 'Natural Earth 1:10m rails plus generated lines for stations opened after the data was drawn',
  generatedLines: generated,
  nodes: nodes.map(([x, z]) => [r3(x), r3(z)]),
  edges: edges.map((e) => ({ a: e.a, b: e.b, real: e.real, line: e.line, len: r3(e.len), pts: e.pts.map(([x, z]) => [r3(x), r3(z)]) })),
  stations: stations.map((s) => ({ ...s, x: r3(s.x), z: r3(s.z) })),
  routes: routes.map((r) => ({ ...r, len: r3(r.len), pts: r.pts.map(([x, z]) => [r3(x), r3(z)]), stops: r.stops.map((s) => ({ ...s, d: r3(s.d) })) })),
};
writeFileSync('data/network.json', JSON.stringify(out));

const realKm = edges.filter((e) => e.real).reduce((n, e) => n + e.len, 0);
const genKm = edges.filter((e) => !e.real).reduce((n, e) => n + e.len, 0);
console.log(`network: ${nodes.length} nodes, ${edges.length} edges, ${realKm.toFixed(0)} km real + ${genKm.toFixed(0)} km generated (${generated.join(', ') || 'none'})`);
console.log(`stations: ${stations.length} snapped, ${orphans.length} orphans${orphans.length ? ': ' + orphans.join(', ') : ''}`);
const far = stations.filter((s) => s.snapKm > NEAR).map((s) => `${s.id} ${s.snapKm}km`);
if (far.length) console.log(`  moved more than ${NEAR} km onto the line: ${far.join(', ')}`);
for (const r of routes) console.log(`  route ${r.id.padEnd(20)} ${r.len.toFixed(0).padStart(4)} km, ${r.stops.length} stops`);
console.log(`wrote data/network.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
if (orphans.length) process.exit(1);
