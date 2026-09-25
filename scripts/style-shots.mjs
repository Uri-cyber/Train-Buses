/**
 * Renders the same three views under each style preset so the looks can be compared side by
 * side. npm run preview first; then: node scripts/style-shots.mjs [style ...]
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';

const BASE = process.env.URL || 'http://127.0.0.1:4173/?osm=fixture&tt=./timetable-fixture.json';
const EXE = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const STYLES = process.argv.slice(2).length ? process.argv.slice(2) : ['sunlit', 'diorama', 'neon', 'poster'];
const OUT = 'shots/styles';
mkdirSync(OUT, { recursive: true });

const VIEWS = [
  ['country',  12.5, [-100, 520, 470], [5, 0, 60]],
  ['tel-aviv', 15.5, [-38, 14, 8],     [-21, 0.05, -9]],
  ['haifa',    10.5, [-12, 12, -80],   [-1, 0.1, -92]],
];

const browser = await chromium.launch({ executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const style of STYLES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}&style=${style}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__app, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__app.liveStatus?.applied || window.__app.liveStatus?.failed || window.__app.liveStatus?.thin, null, { timeout: 180000 }).catch(() => {});
  await page.evaluate(() => { window.__app.start(); window.__app.tour.set(false); });
  await page.waitForTimeout(800);
  for (const [name, hour, pos, target] of VIEWS) {
    await page.evaluate(([h, p, t]) => { window.__app.setHour(h); window.__app.setView(p, t); }, [hour, pos, target]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${style}-${name}.png` });
  }
  console.log(style, errors.length ? `ERRORS: ${errors[0]}` : 'ok');
  await page.close();
}
await browser.close();
