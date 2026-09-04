import * as THREE from 'three';
import world from '../data/world.json';
import network from '../data/network.json';
import { createTerrain } from './terrain.js';
import { createSea } from './sea.js';
import { createSky, israelClock } from './sky.js';
import { createLighting } from './lighting.js';
import { createPost } from './post.js';
import { createCamera } from './camera.js';

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
  if (e.key === 'ArrowLeft') { state.autoSun = false; state.hour = (state.hour - 0.25 + 24) % 24; }
  if (e.key === 'ArrowRight') { state.autoSun = false; state.hour = (state.hour + 0.25) % 24; }
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  cam.resize();
  post.resize(innerWidth, innerHeight);
});

/* ----------------------------------------------------------------- loop */
const clock = new THREE.Clock();
let frames = 0, fpsT = 0;
const app = { scene, camera: cam.camera, renderer, state, cam, terrain, sky, lights, post, network, world, fps: 0 };

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (state.autoSun) state.hour = israelClock().hour;
  cam.update(dt);
  const skyState = sky.update(state.hour, dt, cam.camera.position);
  const dist = cam.distance();
  lights.update(skyState, cam.controls.target, dist);
  sea.update(clock.elapsedTime);
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
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps: app.fps }),
};
