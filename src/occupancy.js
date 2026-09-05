import { makePathLookup } from './geo.js';
import { TRACK } from './rails.js';

/**
 * Where things already are. A coarse spatial hash seeded with the rails,
 * roads, stations and water, so trees and buildings are never placed on a
 * line or in the sea, and so scripts/rails-check.mjs can verify the same rule.
 */
export function makeOccupancy(network, world, terrain, opts = {}) {
  const cell = 1.0;
  const grid = new Map();
  const items = [];
  const key = (i, j) => i * 100003 + j;
  const add = (x, z, r, kind) => {
    const it = { x, z, r, kind };
    items.push(it);
    const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell);
    const j0 = Math.floor((z - r) / cell), j1 = Math.floor((z + r) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(it);
    }
    return it;
  };
  /** the nearest registered item overlapping a disc of radius r at (x, z), or null */
  const hit = (x, z, r, filter) => {
    const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell);
    const j0 = Math.floor((z - r) / cell), j1 = Math.floor((z + r) / cell);
    let best = null, bd = Infinity;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = grid.get(key(i, j));
      if (!list) continue;
      for (const it of list) {
        if (filter && !filter(it)) continue;
        const d = Math.hypot(it.x - x, it.z - z) - it.r - r;
        if (d < 0 && d < bd) { bd = d; best = it; }
      }
    }
    return best;
  };
  const blocked = (x, z, r, filter) => hit(x, z, r, filter) !== null;

  // seed: rails
  const railR = opts.railR ?? TRACK.corridorHalf + 0.4, roadR = opts.roadR ?? 0.45;
  for (const e of network.edges) {
    const lk = makePathLookup(e.pts);
    for (let d = 0; d <= lk.length; d += 0.3) { const p = lk.at(d); add(p.x, p.z, railR, 'rail'); }
  }
  // roads
  for (const road of world.roads) {
    const lk = makePathLookup(road.pts);
    for (let d = 0; d <= lk.length; d += 0.35) { const p = lk.at(d); add(p.x, p.z, roadR, 'road'); }
  }
  // stations
  for (const s of network.stations) add(s.x, s.z, 3.0, 'station');

  const mask = terrain.mask;
  const onCoreLand = (x, z) => mask.isLand(x, z) && mask.nearIsrael(x, z, 3) && terrain.heightAt(x, z) > 0.005;
  return { add, hit, blocked, onCoreLand, items, railR };
}
