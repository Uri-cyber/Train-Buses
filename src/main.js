import * as THREE from 'three';
import world from '../data/world.json';
import network from '../data/network.json';
import { createTerrain } from './terrain.js';
import { createSea } from './sea.js';
import { createSky, israelClock } from './sky.js';
import { createLighting } from './lighting.js';
import { createPost } from './post.js';
import { createCamera } from './camera.js';
import { createRails } from './rails.js';
import { createStations } from './stations.js';
import { createTrains } from './trains.js';
import { horn, whistle } from './audio.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
const rails = createRails(network, terrain);
scene.add(rails.group);
const stations = createStations(network, rails, terrain);
scene.add(stations.group);
const trains = createTrains(rails, terrain);
scene.add(trains.group);

/* ---------------------------------------------------------------- state */
const state = {
  hour: israelClock().hour,      // Israel wall clock
  autoSun: true,                 // follow the real clock
  speed: 0.5,
  lights: false, turntable: true, traffic: true, whistle: false,
};

/* ------------------------------------------------------------ interaction */
const QUALITIES = ['high', 'medium', 'low'];
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'q') post.setQuality(QUALITIES[(QUALITIES.indexOf(post.quality) + 1) % QUALITIES.length]);
  if (k === 'r') cam.reset();
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
    const hit = ray.intersectObjects(stations.hits, false)[0];
    if (!hit) return;
    const st = stations.byId[hit.object.userData.stationId];
    stations.select(st.id);
    cam.focus(st.x, st.z, Math.min(cam.distance(), 14));
  });
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  cam.resize();
  post.resize(innerWidth, innerHeight);
});

/* ----------------------------------------------------------------- loop */
const clock = new THREE.Clock();
let frames = 0, fpsT = 0;
renderer.info.autoReset = false;
const app = { scene, camera: cam.camera, renderer, state, cam, terrain, sky, lights, post, network, world, rails, stations, trains, fps: 0 };

function frame() {
  renderer.info.reset();
  const dt = Math.min(clock.getDelta(), 0.1);
  if (state.autoSun) state.hour = israelClock().hour;
  cam.update(dt);
  const skyState = sky.update(state.hour, dt, cam.camera.position);
  const dist = cam.distance();
  lights.update(skyState, cam.controls.target, dist);
  sea.update(clock.elapsedTime);
  stations.update(cam.camera, dt);
  trains.update(dt, state.speed, 1 - skyState.day, state.lights);
  post.setNight(1 - skyState.day, skyState.dusk);
  post.setZoom(dist);
  post.render();
  frames++; fpsT += dt;
  if (fpsT >= 1) { app.fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}

cam.intro();
frame();
document.getElementById('loading')?.remove();

/* ----------------------------------------------- hooks for the QA scripts */
window.__app = {
  ...app,
  setHour: (h) => { state.autoSun = false; state.hour = h; },
  setView: (pos, target) => cam.setView(pos, target),
  fly: (x, z, dist) => cam.focus(x, z, dist),
  selectStation: (id) => { const s = stations.byId[id]; stations.select(id); cam.focus(s.x, s.z, 12); },
  horn: () => { const t = trains.nearestTo(cam.controls.target); (t && t.kind === 'heritage' ? whistle : horn)(); },
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps: app.fps }),
};
