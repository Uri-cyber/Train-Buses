import { chromium } from 'playwright';
const out = process.argv[2] || 'shots/closeup';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:4173/?osm=fixture&tt=./timetable-fixture.json', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__app, null, { timeout: 120000 });
const HOUR = +(process.env.HOUR || 10.5);                      // e.g. HOUR=21 for the lit windows
await p.evaluate((h) => { window.__app.start(); window.__app.tour.set(false); window.__app.setHour(h); }, HOUR);
await p.waitForTimeout(1500);
// park beside a moving train: three fixed shots relative to its head, so before/after line up
const shots = [['side', 5.0, 1.6, 0.0], ['front', 4.2, 1.2, 4.0], ['high', 6.0, 4.0, -3.0]];
for (const [name, r, up, ahead] of shots) {
  await p.evaluate(([r, up, ahead]) => {
    const t = window.__app.trains.trains.find((x) => x.active && x.v > 0.05) || window.__app.trains.trains.find((x) => x.active);
    const h = t.head; const nx = -h.tz, nz = h.tx;            // sideways normal
    const tx = h.x + h.tx * ahead * 0.5, tz = h.z + h.tz * ahead * 0.5;
    window.__app.setView([h.x + nx * r + h.tx * ahead, h.y + up, h.z + nz * r + h.tz * ahead], [tx, h.y + 0.6, tz]);
  }, [r, up, ahead]);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}-${name}.png` });
}
console.log('closeups', errs.length ? 'ERRORS ' + errs[0] : 'ok');
await b.close();
