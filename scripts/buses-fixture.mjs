/**
 * A synthetic bus snapshot for the checks: buses scattered around every station, in the shape
 * the proxy serves (GET /buses). Writes public/buses-fixture.json; the deploy strips it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const { stations } = JSON.parse(readFileSync('data/stations.json', 'utf8'));
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const v = [];
for (const s of stations) {
  const n = 4 + Math.floor(rnd() * 10);
  for (let i = 0; i < n; i++) {
    const r = 0.02 + rnd() * 0.06, a = rnd() * Math.PI * 2;
    v.push([`fx${v.length}`, +(s.lat + Math.sin(a) * r).toFixed(5), +(s.lon + Math.cos(a) * r).toFixed(5),
      Math.floor(rnd() * 360), Math.floor(rnd() * 50), [3, 5, 15, 16, 18, 25][Math.floor(rnd() * 6)]]);
  }
}
const body = { snapshot: 1, at: Date.now(), part: 0, page: 1000, n: v.length, v };
writeFileSync('public/buses-fixture.json', JSON.stringify(body));
console.log(`buses fixture: ${v.length} buses around ${stations.length} stations`);
