/**
 * Drives the control desk with real pointer events in headless Chromium:
 * clicks every button on its cap and drags both levers, asserting that the
 * app state changed and the lever physically moved.
 *
 *   npm run preview &   npm run test:controls
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = process.argv[2] || process.env.URL || 'http://127.0.0.1:4173/';
const EXE = process.env.CHROME_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p)); // undefined = Playwright's own Chromium
const browser = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__app);
await page.evaluate(() => window.__app.tour.set(false));      // the auto tour would move the camera under us
if (/[?&]osm=/.test(URL)) await page.waitForFunction(() => window.__app.liveStatus?.applied || window.__app.liveStatus?.failed || window.__app.liveStatus?.thin, null, { timeout: 180000 });
await page.waitForTimeout(1500);

// screen position of a desk control (controls hang off the HUD camera)
const screenOf = (kind, index) => page.evaluate(([kind, index]) => {
  const { hud } = window.__app;
  const o = kind === 'button' ? hud.buttons[index].cap : hud.levers[index].knob;
  hud.camera.updateMatrixWorld(true);
  const w = o.getWorldPosition(o.position.clone());
  const p = w.project(hud.camera);
  return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
}, [kind, index]);

const results = [];
const ids = await page.evaluate(() => window.__app.hud.buttons.map((b) => b.spec.id));
for (let i = 0; i < ids.length; i++) {
  const before = await page.evaluate((id) => !!window.__app.state[id], ids[i]);
  const pt = await screenOf('button', i);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(350);
  const after = await page.evaluate((id) => !!window.__app.state[id], ids[i]);
  const led = await page.evaluate((k) => window.__app.hud.buttons[k].led.material.color.getHexString(), i);
  const ok = ids[i] === 'whistle' ? true : after !== before;
  results.push({ control: ids[i], before, after, led: '#' + led, ok });
}
for (let i = 0; i < 2; i++) {
  const name = await page.evaluate((k) => window.__app.hud.levers[k].spec.id, i);
  const v0 = await page.evaluate((k) => window.__app.hud.levers[k].value, i);
  const a0 = await page.evaluate((k) => window.__app.hud.levers[k].pivot.rotation.x, i);
  const pt = await screenOf('lever', i);
  const dir = v0 > 0.6 ? -1 : 1;                       // drag away from the nearer end stop
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  for (let s = 1; s <= 10; s++) await page.mouse.move(pt.x, pt.y - dir * s * 7);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const v1 = await page.evaluate((k) => window.__app.hud.levers[k].value, i);
  const a1 = await page.evaluate((k) => window.__app.hud.levers[k].pivot.rotation.x, i);
  const bound = await page.evaluate((k) => (k === 0 ? window.__app.state.speed : window.__app.state.hour / 24), i);
  results.push({ control: 'lever:' + name, before: +v0.toFixed(3), after: +v1.toFixed(3), state: +bound.toFixed(3), moved: Math.abs(a1 - a0) > 0.02, ok: (v1 - v0) * dir > 0.1 && Math.abs(a1 - a0) > 0.02 && Math.abs(bound - v1) < 0.02 });
}
// indicator lamps settle after the clicks: they must match the state
await page.waitForTimeout(800);
const leds = await page.evaluate(() => window.__app.hud.buttons.map((b) => ({ id: b.spec.id, on: !!window.__app.state[b.spec.id], led: b.led.material.color.getHexString() })));
for (const l of leds) {
  const lit = l.led !== '1c2230';
  if (l.id !== 'whistle' && lit !== l.on) results.push({ control: 'led:' + l.id, before: l.on, after: lit, ok: false });
}
console.table(results);
if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log(' ', e)); }
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAIL ${failed.length} control(s)` : 'PASS all controls respond');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
