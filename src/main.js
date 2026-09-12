import * as THREE from 'three';
import world from '../data/world.json';
import bundledNetwork from '../data/network.json';
import stationsData from '../data/stations.json';
import { buildNetwork } from './network-build.js';
import { loadLiveNetwork } from './osm.js';
import { createTerrain, CLOUD } from './terrain.js';
import { createSea } from './sea.js';
import { createSky, israelClock, israelSeconds } from './sky.js';
import { createLighting } from './lighting.js';
import { createPost } from './post.js';
import { createCamera } from './camera.js';
import { createRails, TRACK } from './rails.js';
import { createStations } from './stations.js';
import { createTrains } from './trains.js';
import { horn, whistle } from './audio.js';
import { createTraffic } from './traffic.js';
import { makeOccupancy } from './occupancy.js';
import { createVegetation } from './vegetation.js';
import { createCities } from './cities.js';
import { createLandmarks } from './landmarks.js';
import { createHud } from './hud.js';
import { createTour } from './tour.js';
import { createMusic } from './music.js';
import { loadTimetable, israelDate } from './timetable.js';
import { createLive } from './live.js';
import { makeRouter } from './router.js';
import { makeProjection } from './geo.js';

const params = new URLSearchParams(location.search);
const DESK = params.has('desk');                  // background mode by default: no console, no help, just the map
document.body.classList.toggle('desk', DESK);

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;           // once per frame, not once per pass (see frame())
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

/* ------------------------------------------------------------- the world */
const terrain = createTerrain(world);
scene.add(terrain.mesh);
const sea = createSea(world, terrain);
scene.add(sea.group);
const sky = createSky(scene);
const lights = createLighting(scene, renderer);
const cam = createCamera(renderer, terrain);
const post = createPost(renderer, scene, cam.camera);
const traffic = createTraffic(world, terrain, terrain.mask);
scene.add(traffic.group);

/* -------------------------- everything that depends on the rail network */
let network = bundledNetwork;
let built = null;
let timetable = null;                              // the real Israel Railways timetable, once loaded
const TOY = params.get('trains') === 'toy';        // ?trains=toy: the made-up fleet instead
// The trains run on Israel's clock: what you see is where the trains are now.
// ?speed=8 runs the timetable eight times faster, which reads better as a moving
// picture but is no longer the current moment.
const TIME_SCALE = Math.max(1, Math.min(60, +params.get('speed') || 1));
// The sun is where it really is over Israel right now. ?sky=fast gives the sky its own
// clock instead (TIME_SCALE by day, three times that through the night, so a whole day
// plays out in a few hours) for when you would rather watch the light change than the clock.
const SKY_REAL = params.get('sky') !== 'fast';
const NIGHT_BOOST = 3;
const isSkyNight = (h) => h >= 19.5 || h < 5.5;
let skyClock = null;                              // the sky's own hour (0..24), see above
// Live delays from Israel Railways come through a small proxy (worker/rail-live.js):
// ?live=<its url>, or the address below once one is deployed. ?live=off turns it off.
const LIVE_URL = 'https://israel-by-rail-live.meiriuri.workers.dev/live';
const LIVE = params.get('live') === 'off' ? '' : (params.get('live') || LIVE_URL);
let liveDigest = null;
let ttClock = null;                               // the sped-up timetable clock, seconds after midnight
const scheduleFor = (net, rails) => timetable && !TOY ? { timetable, router: makeRouter(net), P: terrain.P, makeRoute: rails.makeRoute } : null;
function makeTrains(net, rails, stations) { return createTrains(rails, terrain, stations.byId, { schedule: scheduleFor(net, rails) }); }
function buildNetworkObjects(net) {
  const rails = createRails(net, terrain);
  const stations = createStations(net, rails, terrain);
  const trains = makeTrains(net, rails, stations);
  const occupancy = makeOccupancy(net, world, terrain);
  const cities = createCities(world, net, terrain, occupancy);
  const landmarks = createLandmarks(world, terrain, occupancy, net);
  const vegetation = createVegetation(world, terrain, occupancy);
  const groups = [rails.group, stations.group, trains.group, cities.group, landmarks.group, vegetation.group];
  groups.forEach((g) => scene.add(g));
  return { rails, stations, trains, occupancy, cities, landmarks, vegetation, groups };
}
function disposeNetworkObjects(b) {
  for (const g of b.groups) {
    scene.remove(g);
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }
}
built = buildNetworkObjects(network);
/** replace the fleet alone (the timetable arrived) */
function swapTrains() {
  const old = built.trains;
  scene.remove(old.group);
  old.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); } });
  built.trains = makeTrains(network, built.rails, built.stations);
  built.groups[built.groups.indexOf(old.group)] = built.trains.group;
  scene.add(built.trains.group);
  if (liveDigest) built.trains.applyLive(liveDigest);
}

/* ---------------------------------------------------------------- state */
const state = {
  hour: israelClock().hour,      // Israel wall clock
  autoSun: true,                 // follow the real clock
  speed: 0.6,
  lights: false, turntable: true, traffic: true, whistle: false,
  tour: params.get('tour') !== 'off',             // the camera rides the trains on its own
};
const tour = createTour({ cam, getTrains: () => built.trains.trains, getLandmarks: () => built.landmarks.list, terrain, state, hint: document.getElementById('tour') });
const _proj = new THREE.Vector3();
let focusY = 0.52;               // where the tilt-shift's sharp band sits (0 bottom, 1 top)

const music = createMusic();
const hud = createHud(renderer, state, {
  controls: cam.controls,
  onPress: (id, on) => {
    if (id === 'whistle') { const t = built.trains.nearestTo(cam.controls.target); (t && t.kind === 'heritage' ? whistle : horn)(); }
    if (id === 'autoSun' && on) state.hour = israelClock().hour;
    if (id === 'tour') tour.set(on);
  },
});

/* ------------------------------------------------------------ interaction */
const QUALITIES = ['high', 'medium', 'low'];
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q') post.setQuality(QUALITIES[(QUALITIES.indexOf(post.quality) + 1) % QUALITIES.length]);
  if (k === 'r') cam.reset();
  if (k === 'm') { music.toggle(); soundEl.textContent = music.playing ? '♪' : '♪̸'; }
  const idx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
  if (idx >= 0) hud.press(hud.buttons[idx].spec.id);
  if (e.key === 'ArrowUp') state.speed = Math.min(1, state.speed + 0.1);
  if (e.key === 'ArrowDown') state.speed = Math.max(0, state.speed - 0.1);
  if (e.key === 'ArrowLeft') { state.autoSun = false; state.hour = (state.hour - 0.25 + 24) % 24; }
  if (e.key === 'ArrowRight') { state.autoSun = false; state.hour = (state.hour + 0.25) % 24; }
});
// click (not drag) on a station: show its name and fly closer
{
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }
    down = null;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, cam.camera);
    const hit = ray.intersectObjects(built.stations.hits, false)[0];
    if (!hit) return;
    const st = built.stations.byId[hit.object.userData.stationId];
    built.stations.select(st.id);
    cam.focus(st.x, st.z, Math.min(cam.distance(), 14));
  });
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  cam.resize();
  hud.resize();
  post.resize(innerWidth, innerHeight);
});

hud.setEnabled(DESK);

// the opening overlay: browsers only let sound start after a click
const loadingEl = document.getElementById('loading');
const soundEl = document.getElementById('sound');
let started = false;
const start = ({ withMusic = true } = {}) => {
  if (started) return;
  started = true;
  if (withMusic && params.get('music') !== 'off') { music.start(); soundEl.textContent = '♪'; }
  else soundEl.textContent = '♪̸';
  if (withMusic && !DESK && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  loadingEl.classList.add('gone');
  setTimeout(() => loadingEl.remove(), 900);
};
soundEl.addEventListener('click', () => { music.toggle(); soundEl.textContent = music.playing ? '♪' : '♪̸'; });

/* ----------------------------------------------------------------- loop */
const clock = new THREE.Clock();
let frames = 0, fpsT = 0;
renderer.info.autoReset = false;
const app = {
  scene, camera: cam.camera, renderer, state, cam, terrain, sky, lights, post, world, traffic, hud, tour, music, fps: 0, timetable: { loaded: false, pending: true },
  liveStatus: { source: 'bundled', applied: false }, skyHour: state.hour,
  get live() { return LIVE ? { source: LIVE, ...live.status, ...(built.trains.live || {}) } : null; },
  get network() { return network; },
  get rails() { return built.rails; }, get stations() { return built.stations; }, get trains() { return built.trains; },
  get cities() { return built.cities; }, get vegetation() { return built.vegetation; }, get occupancy() { return built.occupancy; }, get landmarks() { return built.landmarks; },
};

function frame() {
  renderer.info.reset();
  const dt = Math.min(clock.getDelta(), 0.1);
  if (state.autoSun) state.hour = israelSeconds() / 3600;    // continuous, so the sun and the trains glide
  const today = israelDate();
  // the timetable runs on Israel's clock; with ?speed it runs ahead of it, wrapping at midnight
  if (TIME_SCALE > 1) ttClock = ((ttClock ?? state.hour * 3600) + dt * TIME_SCALE) % 86400;
  // at real speed the timetable reads Israel's clock straight, to the millisecond: a clock
  // that ticks in whole seconds makes the trains hop once a second instead of rolling
  const T = TIME_SCALE > 1 ? ttClock : (state.autoSun ? israelSeconds() : state.hour * 3600);
  // the sky's own clock: fast by day, faster by night; a manual hour or ?sky=real wins
  if (skyClock === null) skyClock = state.hour;
  skyClock = (skyClock + dt * TIME_SCALE * (isSkyNight(skyClock) ? NIGHT_BOOST : 1) / 3600) % 24;
  const skyFast = state.autoSun && TIME_SCALE > 1 && !SKY_REAL;
  if (!skyFast) skyClock = state.hour;            // stay continuous with the real or manual hour
  const skyHour = skyClock;
  app.skyHour = skyHour;
  const skyState = sky.update(skyHour, dt, cam.camera.position, cam.distance());
  built.trains.update(dt, state.speed, 1 - skyState.day, state.lights, cam.controls.target, tour.trainId, cam.distance(), { T, ymd: today.ymd, weekday: today.weekday });
  traffic.update(dt, state.traffic, 1 - skyState.day, state.lights);
  tour.update(dt);                 // after the trains moved, before the camera settles
  cam.update(dt);
  const dist = cam.distance();
  // the sharp band of the tilt-shift follows the ridden train
  const ft = tour.trainId ? built.trains.byId(tour.trainId) : null;
  if (ft) {
    const h = ft.head;
    _proj.set(h.x, h.y, h.z).project(cam.camera);
    focusY += (Math.max(0.2, Math.min(0.85, (_proj.y + 1) / 2)) - focusY) * Math.min(1, dt * 4);
    post.setFocus(focusY, cam.flying() ? 0.35 : 0.14);
  } else { focusY = 0.52; post.setFocus(0.52, 0.16); }
  lights.update(skyState, cam.controls.target, dist);
  // cloud shadows drift with the sprite clouds; none at night, none on 'low'
  CLOUD.time.value = clock.elapsedTime;
  CLOUD.amt.value = post.quality === 'low' ? 0 : 0.22 * skyState.day;
  sea.update(clock.elapsedTime);
  built.stations.update(cam.camera, dt, 1 - skyState.day, state.lights);
  built.cities.update(1 - skyState.day, state.lights, clock.elapsedTime);
  built.landmarks.update(dt, cam.camera, state.turntable, 1 - skyState.day, state.lights);
  post.setNight(1 - skyState.day, skyState.dusk, skyState.blueHour);
  post.setZoom(dist);
  renderer.shadowMap.needsUpdate = true;
  post.render();
  const hh = Math.floor(skyHour), mm = Math.floor((skyHour - hh) * 60);
  hud.update(dt, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    !state.autoSun ? 'שעה מכוונת ידנית' : skyFast ? `זמן מואץ ×${TIME_SCALE}` : 'השעה בישראל עכשיו');
  hud.render();
  frames++; fpsT += dt;
  if (fpsT >= 1) { app.fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}

tour.begin();
frame();
loadingEl.innerHTML = '<div><b>ישראל ברכבת</b><span class="go">לחצו כדי להתחיל</span><small>Israel by Rail · click to start · M mutes the music</small></div>';
loadingEl.classList.add('ready');
loadingEl.addEventListener('click', () => start(), { once: true });
addEventListener('keydown', () => start(), { once: true });

/* ----------------------------------------------- hooks for the QA scripts */
window.__app = Object.assign(Object.create(app), {
  THREE, TRACK,
  start: () => start({ withMusic: false }),      // dismiss the opening overlay without sound (the QA scripts)
  setHour: (h) => { state.autoSun = false; state.hour = h; },
  setView: (pos, target) => cam.setView(pos, target),
  fly: (x, z, dist) => cam.focus(x, z, dist),
  selectStation: (id) => { const s = built.stations.byId[id]; built.stations.select(id); cam.focus(s.x, s.z, 12); },
  horn: () => { const t = built.trains.nearestTo(cam.controls.target); (t && t.kind === 'heritage' ? whistle : horn)(); },
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps: app.fps, skyHour: app.skyHour }),
});

/* ------------------------------------------------ the real timetable */
const ttEl = document.getElementById('timetable');
const ttStatus = () => {
  if (!ttEl) return;
  const tr = built.trains;
  if (!tr.scheduled) { ttEl.innerHTML = '<span dir="rtl">רכבות: שירות מדומה (אין לוח זמנים)</span><span dir="ltr">Trains: made-up service (no timetable)</span>'; return; }
  const when = new Date(timetable.fetched).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const scale = TIME_SCALE > 1 ? ` · ×${TIME_SCALE}` : ' · בזמן אמת';
  const scaleEn = TIME_SCALE > 1 ? ` · ×${TIME_SCALE}` : ' · in real time';
  let he = tr.replay ? `לוח זמנים: רכבת ישראל, עודכן ${when} · שקט עכשיו, משדר בוקר יום חול${scale}` : `לוח זמנים: רכבת ישראל, עודכן ${when} · ${tr.activeCount} רכבות בדרך${scale}`;
  let en = tr.replay ? `Timetable: Israel Railways (MOT GTFS), updated ${when} · quiet now, replaying a weekday morning${scaleEn}` : `Timetable: Israel Railways (MOT GTFS), updated ${when} · ${tr.activeCount} trains running${scaleEn}`;
  const lv = tr.live, ls = live?.status;
  if (LIVE && ls) {
    if (ls.state === 'ok' && lv) { he += ` · חי: ${lv.positioned} רכבות דיווחו איפה הן, ${lv.delayed} באיחור`; en += ` · live: ${lv.positioned} trains reporting where they are, ${lv.delayed} running late`; }
    else if (ls.state === 'error') { he += ' · חי: אין קשר לרכבת ישראל'; en += ' · live: no answer from Israel Railways'; }
    else { he += ' · חי: מתחבר...'; en += ' · live: connecting...'; }
  }
  ttEl.innerHTML = `<span dir="rtl">${he}</span><span dir="ltr">${en}</span>`;
};
/* live delays: poll the proxy, hand each digest to the trains */
const live = LIVE ? createLive({ source: LIVE, every: 60, onData: (d) => { liveDigest = d; built.trains.applyLive(d); ttStatus(); } }) : null;
if (live) live.start();
loadTimetable(params.get('tt') || './timetable.json').then((tt) => {
  if (tt && !TOY) { timetable = tt; swapTrains(); app.timetable = { loaded: true, trips: tt.trips.length, fetched: tt.fetched }; }
  else app.timetable = { loaded: false };
  ttStatus();
}).catch((e) => { console.warn('timetable failed', e); app.timetable = { loaded: false, error: String(e) }; ttStatus(); });
setInterval(ttStatus, 5000);

/* ------------------------------------------- the live network from OpenStreetMap */
const statusEl = document.getElementById('status');
const setStatus = (he, en) => { if (statusEl) statusEl.innerHTML = `<span dir="rtl">${he}</span><span dir="ltr">${en}</span>`; };
setStatus('מסילות: Natural Earth (מקורב). מוריד את הרשת העדכנית מ-OpenStreetMap…', 'Rails: Natural Earth (approximate). Fetching the current network from OpenStreetMap…');
const osmParam = params.get('osm');
const fixtureUrl = osmParam === 'fixture' ? './fixtures/overpass-israel.json' : osmParam && osmParam !== 'off' ? osmParam : null;
if (osmParam !== 'off') {
  setTimeout(() => {
    loadLiveNetwork({
      world, curated: stationsData.stations, fixtureUrl, force: params.has('refresh'),
      onStatus: (kind, detail) => {
        if (kind === 'mirror') setStatus(`מוריד מ-${new URL(detail).host}…`, `Fetching from ${new URL(detail).host}…`);
        if (kind === 'failed') setStatus('OpenStreetMap לא זמין כרגע, מציג את המפה המובנית.', `OpenStreetMap unavailable (${detail}); showing the bundled map.`);
      },
    }).then((osm) => {
      if (!osm) { app.liveStatus = { source: 'bundled', applied: false, failed: true }; return; }
      const t0 = performance.now();
      const live = buildNetwork({ world, rails: osm.rails, stations: osm.stations, trimWater: false, log: (m) => console.warn('network:', m) });
      if (live.routes.length < 4 || live.stations.length < 20) {
        console.warn('live network too thin, keeping the bundled one', live);
        setStatus('הרשת מ-OpenStreetMap חלקית, נשארים עם המפה המובנית.', 'OpenStreetMap network too thin; keeping the bundled map.');
        app.liveStatus = { source: osm.source, applied: false, thin: true };
        return;
      }
      disposeNetworkObjects(built);
      network = live;
      built = buildNetworkObjects(live);
      if (liveDigest) built.trains.applyLive(liveDigest);
      const km = live.edges.reduce((n, e) => n + e.len, 0);
      const when = new Date(osm.fetched);
      const day = when.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
      setStatus(`מסילות ותחנות: OpenStreetMap, ${Math.round(km)} ק"מ, ${live.stations.length} תחנות, עודכן ${day}`,
        `Rails and stations: OpenStreetMap, ${Math.round(km)} km, ${live.stations.length} stations, updated ${when.toLocaleDateString('en-GB')}`);
      app.liveStatus = { source: osm.source, applied: true, edges: live.edges.length, stations: live.stations.length, routes: live.routes.length, skipped: live.skippedRoutes, ms: Math.round(performance.now() - t0) };
    }).catch((e) => { console.warn('live network failed', e); app.liveStatus = { source: 'bundled', applied: false, failed: true, error: String(e) }; });
  }, 400);
} else {
  setStatus('מסילות: המפה המובנית (Natural Earth).', 'Rails: bundled map (Natural Earth).');
}
