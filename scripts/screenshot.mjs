// Loads the dev/preview server in headless Chromium with WebGL (SwiftShader),
// captures a set of views and reports every console message and page error.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:4173/';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { name: '01-overview',  hour: 10.5 },
  { name: '02-golden',    hour: 17.4 },
  { name: '03-night',     hour: 21.5, lights: true },
  { name: '04-dawn',      hour: 6.4 },
];

const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
try {
  await page.waitForFunction(() => !!window.__railway, null, { timeout: 45000 });
} catch (err) {
  console.log('!! app never initialised');
  logs.forEach((l) => console.log(l));
  await page.screenshot({ path: `${OUT}/00-failed.png` });
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(1500);

const report = { logs, views: [], stats: null };

for (const v of VIEWS) {
  await page.evaluate((v) => {
    window.__railway.setHour(v.hour);
    window.__railway.state.lights = !!v.lights;
  }, v);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${v.name}.png` });
  report.views.push(v.name);
}

// Close-ups: point the camera at specific features for the clipping review.
const CLOSE = [
  { name: '05-station',  pos: [-0.35, 0.20, 0.72], look: [-0.35, 0.03, 0.20] },
  { name: '06-harbour',  pos: [0.95, 0.30, -0.30], look: [1.05, 0.02, -0.92] },
  { name: '07-yard',     pos: [0.10, 0.24, 0.42], look: [0.30, 0.02, -0.30] },
  { name: '08-hill',     pos: [-0.70, 0.28, 0.55], look: [-1.30, 0.06, -0.12] },
  { name: '09-town',     pos: [0.55, 0.22, 1.05], look: [1.20, 0.05, 0.68] },
  { name: '10-desk',     pos: [0.0, 0.30, 1.35], look: [0.0, 0.02, 0.98] },
];
await page.evaluate(() => { window.__railway.setHour(12.5); window.__railway.state.lights = false; });
for (const c of CLOSE) {
  await page.evaluate((c) => {
    const { camera, renderer, scene } = window.__railway;
    window.__railway.freeCamera(true);           // stop the idle camera drift
    camera.position.set(...c.pos);
    camera.lookAt(...c.look);
    renderer.render(scene, camera);
  }, c);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${c.name}.png` });
  report.views.push(c.name);
}

report.stats = await page.evaluate(() => ({
  drawCalls: window.__railway.drawCalls(),
  triangles: window.__railway.triangles(),
  fps: window.__railway.w.fps,
  solids: window.__railway.SOLIDS.length,
}));

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('--- stats ---');
console.log(report.stats);
console.log('--- console (%d) ---', logs.length);
logs.slice(0, 40).forEach((l) => console.log(l));
await browser.close();
