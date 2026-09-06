import { dist } from './geo.js';

/**
 * Shortest paths over the railway graph, for trains whose stop sequence comes
 * from a timetable rather than the built-in route list. routeThrough() returns
 * the same shape as a route in data/network.json ({ edges, pts, len, stops }),
 * so rails.makeRoute() can drape it and trains can run on it.
 */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
}

export function makeRouter(network) {
  const { nodes, edges } = network;
  const adj = nodes.map(() => []);
  edges.forEach((e, ei) => { adj[e.a].push({ to: e.b, ei, dir: 1 }); adj[e.b].push({ to: e.a, ei, dir: -1 }); });
  const byId = Object.fromEntries(network.stations.map((s) => [s.id, s]));
  const cache = new Map();

  const dijkstra = (from, to) => {
    const key = from + '>' + to;
    if (cache.has(key)) return cache.get(key);
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
    let path = null;
    if (isFinite(d[to])) { path = []; for (let v = to; prev[v]; v = prev[v].u) path.unshift(prev[v]); }
    cache.set(key, path);
    return path;
  };

  return {
    byId,
    /** a route calling at these stations in order, or null when they are not all connected */
    routeThrough(stationIds) {
      const via = stationIds.map((id) => byId[id]?.node);
      if (via.some((n) => n === undefined)) return null;
      const steps = [];
      for (let i = 0; i + 1 < via.length; i++) {
        if (via[i] === via[i + 1]) continue;
        const seg = dijkstra(via[i], via[i + 1]);
        if (!seg) return null;
        steps.push(...seg);
      }
      if (!steps.length) return null;
      const pts = [], nodeD = new Map();
      let d = 0;
      for (const { u, ei, dir } of steps) {
        const e = edges[ei];
        const p = dir === 1 ? e.pts : e.pts.slice().reverse();
        if (!nodeD.has(u)) nodeD.set(u, d);
        for (let i = pts.length ? 1 : 0; i < p.length; i++) { if (pts.length) d += dist(pts[pts.length - 1], p[i]); pts.push(p[i]); }
        const v = dir === 1 ? e.b : e.a;
        nodeD.set(v, d);                              // last visit wins: a stop we return to is placed where we stop
      }
      // the calling points in order, at the distance along the path where each is passed
      const stops = [];
      let seek = 0;
      for (const id of stationIds) {
        const node = byId[id].node;
        // walk the steps from the last stop to find where this node is reached
        let acc = 0, found = null;
        for (let k = 0; k < steps.length; k++) {
          const e = edges[steps[k].ei];
          const start = acc, end = acc + e.len;
          if (k >= seek && steps[k].u === node) { found = start; seek = k; break; }
          if (k >= seek && (steps[k].dir === 1 ? e.b : e.a) === node) { found = end; seek = k + 1; break; }
          acc = end;
        }
        stops.push({ id, d: found ?? nodeD.get(node) ?? 0 });
      }
      return { edges: steps.map((s) => ({ e: s.ei, dir: s.dir })), pts, len: d, stops };
    },
  };
}
