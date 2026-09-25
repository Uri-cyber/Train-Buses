/**
 * How smooth the trains are: per-frame position jumps of every running train, frame-time
 * spread, and the triangles drawn per frame. npm run preview first; then
 *   node scripts/smoothness.mjs [url]
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
const URL = process.argv[2] || 'http://127.0.0.1:4173/?osm=fixture&tt=./timetable-fixture.json&live=./live-fixture.json';
const EXE = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const b = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto(URL, { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__app, null, { timeout: 120000 });
await p.evaluate(() => { window.__app.start(); window.__app.tour.set(false); });
await p.waitForFunction(() => window.__app.trains?.activeCount > 5, null, { timeout: 120000 }).catch(() => {});
await p.waitForTimeout(3000);
const r = await p.evaluate(() => new Promise((done) => {
  const tr = window.__app.trains, last = new Map(), frames = [];
  let jumps = 0, samples = 0, worst = 0, t0 = performance.now(), prev = t0;
  const tick = (now) => {
    frames.push(now - prev); prev = now;
    for (const t of tr.trains) {
      if (!t.active) { last.delete(t); continue; }
      const q = last.get(t);
      if (q !== undefined) { const d = Math.abs(t.d - q); samples++; worst = Math.max(worst, d); if (d > 0.3) jumps++; }
      last.set(t, t.d);
    }
    if (now - t0 < 15000) requestAnimationFrame(tick);
    else {
      frames.sort((a, b) => a - b);
      const q = (f) => +frames[Math.floor(frames.length * f)].toFixed(1);
      done({ frames: frames.length, median_ms: q(0.5), p95_ms: q(0.95), worst_ms: q(0.999), trains: tr.activeCount,
             jumps_over_300m: jumps, worst_jump_km: +worst.toFixed(2), samples, triangles: window.__app.info().triangles });
    }
  };
  requestAnimationFrame(tick);
}));
console.log(JSON.stringify(r));
await b.close();
