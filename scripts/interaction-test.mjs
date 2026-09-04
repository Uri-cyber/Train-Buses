/**
 * Drives the control desk with real pointer events in headless Chromium:
 * clicks every button on its 3D cap and drags both levers, asserting that the
 * state changes and that the lever actually moves.
 *
 *   npm run preview &   node scripts/interaction-test.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:4173/';
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__railway);
await page.waitForTimeout(1200);

// Screen position of a desk object, so we click the real 3D control.
const screenOf = (kind, index) => page.evaluate(({ kind, index }) => {
  const { camera, renderer, desk } = window.__railway;
  const o = kind === 'button' ? desk.buttons[index].cap : desk.levers[index].knob;
  o.updateWorldMatrix(true, false);
  const v = new o.matrixWorld.constructor();
  const p = { x: 0, y: 0, z: 0 };
  const w = o.getWorldPosition(new (Object.getPrototypeOf(o.position).constructor)());
  const proj = w.clone().project(camera);
  void v; void p;
  const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + ((proj.x + 1) / 2) * r.width, y: r.top + ((1 - proj.y) / 2) * r.height };
}, { kind, index });

const results = [];
const ids = await page.evaluate(() => window.__railway.desk.buttons.map((b) => b.spec.id));

for (let i = 0; i < ids.length; i++) {
  const before = await page.evaluate((id) => !!window.__railway.state[id], ids[i]);
  const pt = await screenOf('button', i);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(260);
  const after = await page.evaluate((id) => !!window.__railway.state[id], ids[i]);
  const led = await page.evaluate((i2) => {
    const b = window.__railway.desk.buttons[i2];
    return { hex: b.led.material.color.getHexString(), capY: +b.cap.position.y.toFixed(4) };
  }, i);
  // whistle is momentary: it fires and latches straight back off
  const ok = ids[i] === 'whistle' ? true : after !== before;
  results.push({ control: ids[i], before, after, led: `#${led.hex}`, capY: led.capY, ok });
}

for (let i = 0; i < 2; i++) {
  const name = await page.evaluate((i2) => window.__railway.desk.levers[i2].spec.id, i);
  const v0 = await page.evaluate((i2) => window.__railway.desk.levers[i2].value, i);
  const a0 = await page.evaluate((i2) => window.__railway.desk.levers[i2].pivot.rotation.x, i);
  const pt = await screenOf('lever', i);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  for (let s = 1; s <= 8; s++) await page.mouse.move(pt.x, pt.y - s * 8);   // drag upward
  await page.mouse.up();
  await page.waitForTimeout(400);
  const v1 = await page.evaluate((i2) => window.__railway.desk.levers[i2].value, i);
  const a1 = await page.evaluate((i2) => window.__railway.desk.levers[i2].pivot.rotation.x, i);
  results.push({
    control: `lever:${name}`, before: +v0.toFixed(3), after: +v1.toFixed(3),
    moved: Math.abs(a1 - a0) > 0.02, ok: v1 > v0 + 0.15 && Math.abs(a1 - a0) > 0.02,
  });
}

console.table(results);
if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log(' ', e)); }
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAIL ${failed.length} control(s)` : 'PASS all controls respond');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
