#!/usr/bin/env node
/**
 * What a visitor actually sees. Loads the real published page in a real browser,
 * on a desktop screen and on a phone, clicks to start as a visitor would, and
 * reports what is on screen: errors, how long it took, whether the trains are
 * the real ones, whether the tour is riding, and how heavy the frame is.
 * Run it against the live site (the build machine cannot reach it, CI can).
 */
import { chromium, devices } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const ISRAEL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const problems = [];
const fail = (what) => { problems.push(what); console.log(`  FAIL  ${what}`); };

async function visit(browser, name, opts, { touch = false } = {}) {
  console.log(`\n== ${name}`);
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__app, null, { timeout: 120000 });
  const booted = Date.now() - t0;
  // a visitor clicks once, wherever they like
  if (touch) await page.tap('body'); else await page.click('body', { position: { x: 40, y: 40 } });
  await page.waitForTimeout(9000);

  const s = await page.evaluate(() => ({
    info: window.__app.info(),
    tt: window.__app.timetable,
    live: window.__app.live,
    tour: { on: window.__app.tour.active, mode: window.__app.tour.mode, shot: window.__app.tour.shot },
    trains: { total: window.__app.trains.trains.length, active: window.__app.trains.activeCount, source: window.__app.trains.source, replay: window.__app.trains.replay },
    moving: window.__app.trains.trains.filter((t) => t.active && t.v > 0.004).length,
    overlay: document.getElementById('loading')?.style.display,
    canvas: { w: document.getElementById('view').width, h: document.getElementById('view').height },
  }));
  // the canvas never stops moving, so a screenshot can time out on a software renderer:
  // it is a keepsake, not part of the verdict
  await page.screenshot({ path: `${OUT}/visitor-${name}.png`, timeout: 20000, animations: 'disabled' })
    .catch(() => console.log('  (no screenshot: the renderer was too slow to hold still)'));

  console.log(`  booted in ${(booted / 1000).toFixed(1)} s, canvas ${s.canvas.w}x${s.canvas.h}`);
  console.log(`  timetable: ${JSON.stringify(s.tt)}`);
  console.log(`  trains: ${s.trains.active} running of ${s.trains.total} slots, ${s.moving} moving, source ${s.trains.source}${s.trains.replay ? ' (replaying a weekday)' : ''}`);
  console.log(`  live: ${JSON.stringify(s.live)}`);
  console.log(`  tour: ${JSON.stringify(s.tour)}   draw calls ${s.info.calls}, fps ${s.info.fps}`);

  if (errors.length) fail(`${name}: ${errors.length} page errors, first: ${errors[0]}`);
  if (!s.tt.loaded) fail(`${name}: the real timetable did not load`);
  if (s.trains.active < 3) fail(`${name}: only ${s.trains.active} trains on screen`);
  if (s.trains.replay) console.log('  note: the railway is quiet now, so the page is replaying a weekday morning');
  if (s.live && s.live.state === 'ok' && s.live.positioned === 0) console.log('  note: no train is reporting a position (normal on Shabbat and at night)');
  if (s.moving < 1) fail(`${name}: no train is moving`);
  if (!s.tour.on) fail(`${name}: the tour is not running`);
  if (s.info.calls > 300) fail(`${name}: ${s.info.calls} draw calls`);
  if (booted > 60000) fail(`${name}: took ${(booted / 1000).toFixed(0)} s to boot`);
  await ctx.close();
  return s;
}

// the build machine keeps its Chromium outside the Playwright cache; CI uses Playwright's own
const EXE = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
console.log(`Israel time: ${ISRAEL}`);
const browser = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
await visit(browser, 'desktop', { viewport: { width: 1440, height: 900 } });
await visit(browser, 'laptop', { viewport: { width: 1280, height: 720 } });
await visit(browser, 'phone', { ...devices['Pixel 7'] }, { touch: true });
await browser.close();

console.log('');
if (problems.length) { console.log(`FAIL  ${problems.length} problem(s) a visitor would hit`); process.exit(1); }
console.log('PASS  a visitor gets a working page on desktop, laptop and phone');
