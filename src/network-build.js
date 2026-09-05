/**
 * Builds the railway graph the trains run on. Pure JS: used by
 * scripts/build-network.mjs at build time and by the browser when the live
 * OpenStreetMap network arrives.
 *
 *   buildNetwork({ world, rails, stations })
 *     rails:    [{ pts: [[x, z], ...], line, real }]   projected polylines
 *     stations: [{ id, he, en, x, z, line, approx }]
 *   -> { nodes, edges, stations, routes, generatedLines, orphans, skippedRoutes }
 */
import { makeProjection, makeMask, dist, polylineLength, nearestOnPolyline, catmullRom } from './geo.js';

// Lines that exist today but are missing from older geometry. Each is
// generated from its station sequence (ids, or [lat, lon] waypoints) and
// joined onto the network at the junction where it really branches. A line
// is only generated when one of its stations is not already on the network.
export const LINES = [
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

export const ROUTES = [
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

const NODE_TOL = 0.05;  // km: endpoints closer than this are the same node
const NEAR = 1.5;       // km: a station this close to an existing edge is on it

/* --------------------------------------------------------- binary heap */
class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

/**
 * @param trimWater  drop rail points the coarse land mask calls water. Right for
 *                   Natural Earth (a spur runs into Ashdod harbour), wrong for
 *                   OpenStreetMap, whose track hugs the coast at Bat Galim.
 */
export function buildNetwork({ world, rails, stations: stationsIn, trimWater = true, log = () => {} }) {
  const P = makeProjection(world.proj);
  const mask = makeMask(world);
  const nodes = [], edges = [];

  // node lookup through a 0.1 km hash: thousands of OpenStreetMap ways join in milliseconds
  const cellsOf = new Map();
  const ck = (i, j) => i * 200003 + j;
  const nodeAt = (p) => {
    const ci = Math.floor(p[0] / 0.1), cj = Math.floor(p[1] / 0.1);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const list = cellsOf.get(ck(i, j));
      if (list) for (const n of list) if (dist(nodes[n], p) < NODE_TOL) return n;
    }
    nodes.push([p[0], p[1]]);
    const n = nodes.length - 1, k = ck(ci, cj);
    if (!cellsOf.has(k)) cellsOf.set(k, []);
    cellsOf.get(k).push(n);
    return n;
  };
  const addEdge = (pts, real, line) => {
    if (pts.length < 2 || polylineLength(pts) < 0.05) return -1;
    const a = nodeAt(pts[0]), b = nodeAt(pts[pts.length - 1]);
    if (a === b && polylineLength(pts) < 0.5) return -1;
    pts = pts.slice(); pts[0] = nodes[a].slice(); pts[pts.length - 1] = nodes[b].slice();
    edges.push({ a, b, pts, len: polylineLength(pts), real, line });
    return edges.length - 1;
  };
  const splitEdge = (ei, seg, p) => {
    const e = edges[ei];
    if (dist(p, nodes[e.a]) < NODE_TOL) return e.a;
    if (dist(p, nodes[e.b]) < NODE_TOL) return e.b;
    const n = nodeAt(p);
    const first = e.pts.slice(0, seg + 1).concat([nodes[n].slice()]);
    const second = [nodes[n].slice()].concat(e.pts.slice(seg + 1));
    edges[ei] = { ...e, b: n, pts: first, len: polylineLength(first) };
    edges.push({ ...e, a: n, pts: second, len: polylineLength(second) });
    return n;
  };
  const nearestEdgePoint = (p, maxKm, filter = () => true) => {
    let best = null;
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei];
      if (!filter(e)) continue;
      // cheap reject on the edge's bounding box
      if (e.bb && (p[0] < e.bb[0] - maxKm || p[0] > e.bb[1] + maxKm || p[1] < e.bb[2] - maxKm || p[1] > e.bb[3] + maxKm)) continue;
      const r = nearestOnPolyline(p, e.pts);
      if (r.d <= maxKm && (!best || r.d < best.d)) best = { ei, ...r };
    }
    return best;
  };
  const bbox = () => { for (const e of edges) { if (e.bb) continue; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of e.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } e.bb = [x0, x1, z0, z1]; } };
  const attach = (p, maxKm, filter) => { bbox(); const r = nearestEdgePoint(p, maxKm, filter); return r ? splitEdge(r.ei, r.seg, [r.x, r.z]) : -1; };

  /* 1. real geometry, kept to Israel's land */
  const israelRuns = (pts) => {
    const runs = []; let cur = [];
    for (const p of pts) {
      if (mask.nearIsrael(p[0], p[1], 2) && (!trimWater || mask.isLand(p[0], p[1]))) cur.push(p);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    // a way kept whole is kept however short (crossovers, station throats);
    // fragments cut off at the border or the water must be worth drawing
    const whole = runs.length === 1 && runs[0].length === pts.length;
    return whole ? runs : runs.filter((r) => polylineLength(r) >= 0.8);
  };
  for (const r of rails) for (const run of israelRuns(r.pts)) addEdge(run, r.real !== false, r.line || 'ne');
  // dangling ends that sit on another edge become junctions
  bbox();
  const degree = new Uint16Array(nodes.length);
  for (const e of edges) { degree[e.a]++; degree[e.b]++; }
  for (let i = 0; i < nodes.length; i++) {
    if (degree[i] !== 1) continue;
    const r = nearestEdgePoint(nodes[i], 0.6, (e) => e.a !== i && e.b !== i);
    if (r) { const n = splitEdge(r.ei, r.seg, [r.x, r.z]); if (n !== i) addEdge([nodes[i], nodes[n]], true, 'join'); }
  }

  /* 2. stations */
  const stations = stationsIn.map((s) => ({ ...s }));
  const byId = Object.fromEntries(stations.map((s) => [s.id, s]));
  const S = (id) => byId[id] ? [byId[id].x, byId[id].z] : null;

  /* 3. generated lines */
  const generatedLines = [];
  for (const line of LINES) {
    const ids = line.ctrl.filter((c) => typeof c === 'string');
    if (ids.some((id) => !byId[id])) { log(`line ${line.id}: a station is missing, skipped`); continue; }
    bbox();
    const needed = line.force || ids.some((id) => !nearestEdgePoint(S(id), NEAR));
    if (!needed) continue;
    const ctrl = line.ctrl.map((c) => (typeof c === 'string' ? S(c) : P.toXZ(c[1], c[0])));
    const pts = catmullRom(ctrl, 0.25);
    const startNode = attach(pts[0], 8);
    if (startNode < 0) { log(`line ${line.id}: nothing within 8 km of its start, skipped`); continue; }
    pts[0] = nodes[startNode].slice();
    let endPts = pts;
    if (line.end === 'join') {
      const endNode = attach(pts[pts.length - 1], 8, (e) => e.line !== line.id);
      if (endNode >= 0) endPts = pts.concat([nodes[endNode].slice()]);
    }
    if (addEdge(endPts, false, line.id) >= 0) generatedLines.push(line.id);
  }

  /* 4. snap stations onto edges */
  const orphans = [];
  bbox();
  for (const s of stations) {
    const r = nearestEdgePoint([s.x, s.z], 6);
    if (!r) { orphans.push(s.id); continue; }
    const n = splitEdge(r.ei, r.seg, [r.x, r.z]);
    s.x = nodes[n][0]; s.z = nodes[n][1]; s.node = n; s.snapKm = Math.round(r.d * 100) / 100; s.real = edges[r.ei].real;
  }

  /* 5. routes by shortest path */
  const adj = nodes.map(() => []);
  edges.forEach((e, ei) => { adj[e.a].push({ to: e.b, ei, dir: 1 }); adj[e.b].push({ to: e.a, ei, dir: -1 }); });
  const dijkstra = (from, to) => {
    const d = new Float64Array(nodes.length).fill(Infinity), prev = new Array(nodes.length).fill(null);
    d[from] = 0;
    const heap = new Heap(); heap.push(0, from);
    while (heap.size) {
      const [du, u] = heap.pop();
      if (du > d[u]) continue;
      if (u === to) break;
      for (const { to: v, ei, dir } of adj[u]) {
        const nd = du + edges[ei].len;
        if (nd < d[v]) { d[v] = nd; prev[v] = { u, ei, dir }; heap.push(nd, v); }
      }
    }
    if (!isFinite(d[to])) return null;
    const path = [];
    for (let v = to; prev[v]; v = prev[v].u) path.unshift(prev[v]);
    return path;
  };
  const nearestNode = (x, z) => { let best = -1, bd = Infinity; nodes.forEach((n, i) => { const dd = dist(n, [x, z]); if (dd < bd) { bd = dd; best = i; } }); return best; };

  const routes = [], skippedRoutes = [];
  for (const R of ROUTES) {
    const via = [];
    let ok = true;
    for (const v of R.via) {
      if (typeof v === 'string') { if (byId[v]?.node === undefined) { log(`route ${R.id}: ${v} is not on the network`); ok = false; break; } via.push(byId[v].node); }
      else { const [x, z] = P.toXZ(v[1], v[0]); via.push(nearestNode(x, z)); }
    }
    if (!ok) { skippedRoutes.push(R.id); continue; }
    const steps = [];
    for (let i = 0; i + 1 < via.length && ok; i++) {
      const seg = dijkstra(via[i], via[i + 1]);
      if (!seg) { log(`route ${R.id}: no path ${R.via[i]} -> ${R.via[i + 1]}`); ok = false; break; }
      steps.push(...seg);
    }
    if (!ok) { skippedRoutes.push(R.id); continue; }
    const pts = [], nodeD = new Map();
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
    routes.push({ id: R.id, kind: R.kind, he: R.he, en: R.en, edges: steps.map((s) => ({ e: s.ei, dir: s.dir })), pts, len: d, stops });
  }

  for (const e of edges) delete e.bb;
  return { nodes, edges, stations, routes, generatedLines, orphans, skippedRoutes };
}

/** Round the network's numbers to metres before writing it to a file. */
export function roundNetwork(n) {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    ...n,
    nodes: n.nodes.map(([x, z]) => [r3(x), r3(z)]),
    edges: n.edges.map((e) => ({ a: e.a, b: e.b, real: e.real, line: e.line, len: r3(e.len), pts: e.pts.map(([x, z]) => [r3(x), r3(z)]) })),
    stations: n.stations.map((s) => ({ ...s, x: r3(s.x), z: r3(s.z) })),
    routes: n.routes.map((r) => ({ ...r, len: r3(r.len), pts: r.pts.map(([x, z]) => [r3(x), r3(z)]), stops: r.stops.map((s) => ({ ...s, d: r3(s.d) })) })),
  };
}
