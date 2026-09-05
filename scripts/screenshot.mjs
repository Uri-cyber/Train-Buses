/**
 * Loads the preview in headless Chromium (software WebGL), captures a set of
 * views at different places and hours, and reports every console message.
 *
 *   npm run preview &   npm run shots
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const URL = process.argv[2] || process.env.URL || 'http://127.0.0.1:4173/';
const EXE = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p)); // undefined = Playwright's own Chromium
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

// [name, hour, camera position, look-at target]  (world km: +x east, +z south)
const VIEWS = [
  ['01-country',   12.5, [-100, 520, 470],  [5, 0, 60]],
  ['02-centre',    11.0, [-74, 250, 318],   [-14, 0.4, 18]],
  ['03-tel-aviv',  15.5, [-38, 14, 8],      [-21, 0.05, -9]],
  ['04-haifa',     10.5, [-12, 12, -80],    [-1, 0.1, -92]],
  ['05-jerusalem', 16.5, [8, 16, 42],       [19, 2.4, 24]],
  ['06-dead-sea',  13.0, [20, 40, 95],      [44, -1.2, 55]],
  ['07-eilat',     14.0, [-20, 18, 290],    [-5, 0.3, 272]],
  ['08-night',     22.0, [-74, 250, 318],   [-14, 0.4, 18]],
  ['09-dawn',      6.3,  [-74, 250, 318],   [-14, 0.4, 18]],
  ['10-tour',      9.5,  null, null],          // the auto tour riding a train
];

const browser = await chromium.launch({ executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
try {
  await page.waitForFunction(() => !!window.__app, null, { timeout: 120000 });
  if (/[?&]osm=/.test(URL)) await page.waitForFunction(() => window.__app.liveStatus?.applied || window.__app.liveStatus?.failed || window.__app.liveStatus?.thin, null, { timeout: 180000 });
} catch {
  console.log('!! app never initialised'); logs.forEach((l) => console.log(l));
  await page.screenshot({ path: `${OUT}/00-failed.png` }); await browser.close(); process.exit(1);
}
await page.waitForTimeout(800);

for (const [name, hour, pos, target] of VIEWS) {
  if (pos) await page.evaluate(([h, p, t]) => { window.__app.setHour(h); window.__app.setView(p, t); }, [hour, pos, target]);
  else {
    // let the tour fly to a train and settle beside it (slow under software rendering)
    await page.evaluate((h) => { window.__app.setHour(h); window.__app.tour.set(true); }, hour);
    await page.waitForFunction(() => window.__app.tour.mode === 'follow', null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
const stats = await page.evaluate(() => window.__app.info());
writeFileSync(`${OUT}/report.json`, JSON.stringify({ stats, logs }, null, 2));
console.log('stats', stats);
console.log(`console messages: ${logs.length}`);
logs.slice(0, 30).forEach((l) => console.log(' ', l));
await browser.close();
process.exit(logs.some((l) => l.startsWith('[pageerror]')) ? 1 : 0);
