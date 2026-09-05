import * as THREE from 'three';
import world from '../data/world.json';
import bundledNetwork from '../data/network.json';
import stationsData from '../data/stations.json';
import { buildNetwork } from './network-build.js';
import { loadLiveNetwork } from './osm.js';
import { createTerrain } from './terrain.js';
import { createSea } from './sea.js';
import { createSky, israelClock } from './sky.js';
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
import { makeProjection } from './geo.js';

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
function buildNetworkObjects(net) {
  const rails = createRails(net, terrain);
  const stations = createStations(net, rails, terrain);
  const trains = createTrains(rails, terrain);
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

/* ---------------------------------------------------------------- state */
const state = {
  hour: israelClock().hour,      // Israel wall clock
  autoSun: true,                 // follow the real clock
  speed: 0.5,
  lights: false, turntable: true, traffic: true, whistle: false,
};

const hud = createHud(renderer, state, {
  controls: cam.controls,
  onPress: (id, on) => {
    if (id === 'whistle') { const t = built.trains.nearestTo(cam.controls.target); (t && t.kind === 'heritage' ? whistle : horn)(); }
    if (id === 'autoSun' && on) state.hour = israelClock().hour;
  },
});

/* ------------------------------------------------------------ interaction */
const QUALITIES = ['high', 'medium', 'low'];
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q') post.setQuality(QUALITIES[(QUALITIES.indexOf(post.quality) + 1) % QUALITIES.length]);
  if (k === 'r') cam.reset();
  const idx = ['1', '2', '3', '4', '5'].indexOf(e.key);
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

/* ----------------------------------------------------------------- loop */
const clock = new THREE.Clock();
let frames = 0, fpsT = 0;
renderer.info.autoReset = false;
const app = {
  scene, camera: cam.camera, renderer, state, cam, terrain, sky, lights, post, world, traffic, hud, fps: 0,
  liveStatus: { source: 'bundled', applied: false },
  get network() { return network; },
  get rails() { return built.rails; }, get stations() { return built.stations; }, get trains() { return built.trains; },
  get cities() { return built.cities; }, get vegetation() { return built.vegetation; }, get occupancy() { return built.occupancy; }, get landmarks() { return built.landmarks; },
};

function frame() {
  renderer.info.reset();
  const dt = Math.min(clock.getDelta(), 0.1);
  if (state.autoSun) state.hour = israelClock().hour;
  cam.update(dt);
  const skyState = sky.update(state.hour, dt, cam.camera.position);
  const dist = cam.distance();
  lights.update(skyState, cam.controls.target, dist);
  sea.update(clock.elapsedTime);
  built.stations.update(cam.camera, dt);
  built.trains.update(dt, state.speed, 1 - skyState.day, state.lights);
  traffic.update(dt, state.traffic, 1 - skyState.day, state.lights);
  built.cities.update(1 - skyState.day, state.lights);
  built.landmarks.update(dt, cam.camera, state.turntable, 1 - skyState.day, state.lights);
  post.setNight(1 - skyState.day, skyState.dusk);
  post.setZoom(dist);
  renderer.shadowMap.needsUpdate = true;
  post.render();
  const hh = Math.floor(state.hour), mm = Math.floor((state.hour - hh) * 60);
  hud.update(dt, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, state.autoSun ? 'השעה בישראל עכשיו' : 'שעה מכוונת ידנית');
  hud.render();
  frames++; fpsT += dt;
  if (fpsT >= 1) { app.fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}

cam.intro();
frame();
document.getElementById('loading')?.remove();

/* ----------------------------------------------- hooks for the QA scripts */
window.__app = Object.assign(Object.create(app), {
  THREE, TRACK,
  setHour: (h) => { state.autoSun = false; state.hour = h; },
  setView: (pos, target) => cam.setView(pos, target),
  fly: (x, z, dist) => cam.focus(x, z, dist),
  selectStation: (id) => { const s = built.stations.byId[id]; built.stations.select(id); cam.focus(s.x, s.z, 12); },
  horn: () => { const t = built.trains.nearestTo(cam.controls.target); (t && t.kind === 'heritage' ? whistle : horn)(); },
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps: app.fps }),
});

/* ------------------------------------------- the live network from OpenStreetMap */
const statusEl = document.getElementById('status');
const setStatus = (he, en) => { if (statusEl) statusEl.innerHTML = `<span dir="rtl">${he}</span><span dir="ltr">${en}</span>`; };
setStatus('מסילות: Natural Earth (מקורב). מוריד את הרשת העדכנית מ-OpenStreetMap…', 'Rails: Natural Earth (approximate). Fetching the current network from OpenStreetMap…');
const params = new URLSearchParams(location.search);
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
