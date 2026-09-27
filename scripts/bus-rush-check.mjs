/**
 * How the real-bus layer looks at a busy moment: counts every bus the proxy serves, then renders
 * the live site over central Tel Aviv. Prints the shots as base64 between markers so they can be
 * read back from the job log. Run from a machine that can reach the proxy and the site.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const PROXY = 'https://israel-by-rail-live.meiriuri.workers.dev/buses';
const SITE = process.env.SITE || 'https://zoozsoos.co/';
let total = 0, bytes = 0, parts = 0, snapshot = null, at = 0;
for (let k = 0; k < 30; k++) {
  const r = await fetch(`${PROXY}?part=${k}`, { headers: { origin: 'https://zoozsoos.co' } });
  const text = await r.text(); bytes += text.length;
  const d = JSON.parse(text);
  if (d.error) { console.log('part', k, 'error', d.error); break; }
  parts++; total += d.v.length; snapshot = d.snapshot; at = d.at;
  if (d.n < d.page) break;
}
console.log(`BUSES total ${total} | parts ${parts} | bytes ${bytes} | snapshot ${snapshot} | age min ${Math.round((Date.now() - at) / 60000)}`);

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 690 } });
await p.goto(SITE + '?tour=off', { waitUntil: 'load', timeout: 120000 });
await p.waitForFunction(() => window.__app?.buses?.().state === 'ok', null, { timeout: 180000 });
const layer = await p.evaluate(() => window.__app.buses());
console.log('LAYER', JSON.stringify(layer));
await p.evaluate(() => { window.__app.start(); window.__app.tour.set(false); });
const views = [['close', [-38, 14, 8], [-21, 0.05, -9]], ['wide', [-70, 70, 60], [-18, 0, -6]]];
for (const [name, pos, target] of views) {
  await p.evaluate(([a, t]) => window.__app.setView(a, t), [pos, target]);
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `rush-${name}.jpg`, type: 'jpeg', quality: 70, timeout: 240000 });
  const b64 = readFileSync(`rush-${name}.jpg`).toString('base64');
  console.log(`===SHOT ${name} ${b64.length}===`);
  for (let i = 0; i < b64.length; i += 8000) console.log('B64:' + b64.slice(i, i + 8000));
  console.log(`===END ${name}===`);
}
await b.close();
