#!/usr/bin/env node
/**
 * The picture people see when the link is pasted into WhatsApp or Twitter.
 * Rendered from the page itself at exactly 1200x630, at the hour the light is
 * best, so it is always the real thing and never a stale mock-up.
 *   node scripts/preview-image.mjs [url]        -> public/preview.png
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/?osm=fixture';
const EXE = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
mkdirSync('public', { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__app && !window.__app.timetable.pending, null, { timeout: 120000 });
await page.evaluate(() => { window.__app.start(); window.__app.tour.set(false); });
// mid-morning light, and a train as the subject: the camera sits beside a moving one,
// far enough back that the locomotive and a few coaches fill the frame
await page.evaluate(() => {
  window.__app.setHour(9.4);
  const t = window.__app.trains.trains.filter((x) => x.active && x.v > 0.015)
    .sort((a, b) => b.head.y - a.head.y)[0] || window.__app.trains.trains.find((x) => x.active);
  const h = t.head;
  // behind and to one side, high enough to keep the country in the picture: the train
  // is the subject, the coast and the hills are why it is worth looking at
  const nx = h.tz, nz = -h.tx;
  const r = 11, up = 4.2, back = 5;
  const mx = h.x - h.tx * 3, mz = h.z - h.tz * 3;
  window.__app.setView([mx + nx * r - h.tx * back, h.y + up, mz + nz * r - h.tz * back], [mx, h.y + 0.4, mz]);
});
await page.waitForTimeout(7000);
await page.evaluate(() => { const c = document.getElementById('credit'); if (c) c.style.display = 'none'; });
await page.waitForTimeout(500);
await page.screenshot({ path: 'public/preview.png' });
console.log('public/preview.png written at 1200x630');
await browser.close();
