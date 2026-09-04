import * as THREE from 'three';
import { VoxelBuilder, standardMat, emissiveMat } from './voxel.js';
import { createRenderer, createCamera, createLighting } from './scene.js';
import { buildRoom } from './room.js';
import { buildTable } from './table.js';
import { buildScenery } from './scenery.js';
import { buildWater } from './water.js';
import { buildDesk, attachInteraction } from './controls.js';
import { createLoop, createSmoke, Route, whistle } from './animate.js';
import {
  steamLoco, tender, coach, wagon, ship, tugboat, portalCrane,
  roadVehicle, parkedStock, makeTrain,
} from './rollingstock.js';
import { ZONES, LOOP, BOARD } from './layout.js';
import { C } from './palette.js';
import { SOLIDS } from './occupancy.js';

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);
const camera = createCamera();
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9dc4e8, 6, 16);
const lights = createLighting(scene);

/* ------------------------------------------------- static, merged geometry */

// The room is a separate merged mesh with shadows off: it lies outside the
// (deliberately tight) shadow frustum, and sampling outside it would darken it.
const roomVB = new VoxelBuilder();
const solidVB = new VoxelBuilder();
const litVB = new VoxelBuilder();

buildRoom(roomVB, litVB);
buildTable(solidVB);
const { track, sids } = buildScenery(solidVB, litVB);

const roomMesh = roomVB.mesh(standardMat({ roughness: 0.95 }));
roomMesh.castShadow = false; roomMesh.receiveShadow = false;
scene.add(roomMesh);

const solidMesh = solidVB.mesh(standardMat());
scene.add(solidMesh);

const windowMat = emissiveMat();
const litGeo = litVB.build();
const litMesh = new THREE.Mesh(litGeo, windowMat);
scene.add(litMesh);

const water = buildWater();
scene.add(water.mesh);

/* -------------------------------------------------------------- dynamics */

// Passenger train: loco + tender + three coaches
const train = makeTrain([steamLoco, tender, () => coach(C.coach), () => coach(C.coach), () => coach(0x8a4a2f)]);
train.cars[0].userData.len = 0.0;
[0.100, 0.130, 0.165, 0.165, 0.165].forEach((l, i) => { train.cars[i].userData.len = l; });
scene.add(train.group);

// Freight running the opposite way
const freight = makeTrain([steamLoco, tender, () => wagon(0), () => wagon(1), () => wagon(2), () => wagon(0)]);
[0.100, 0.115, 0.105, 0.105, 0.105, 0.105].forEach((l, i) => { freight.cars[i].userData.len = l; });
scene.add(freight.group);

// Turntable deck (rotates)
const ttVB = new VoxelBuilder();
ttVB.box(0, 0.020, 0, 0.040, 0.010, ZONES.turntable.r * 1.92, C.steelDark, { jitter: 0.05 });
ttVB.box(0, 0.032, ZONES.turntable.r * 0.72, 0.026, 0.018, 0.020, C.steel);
for (const s of [-1, 1]) {
  ttVB.box(LOOP.gauge * s, 0.027, 0, 0.0032, 0.005, ZONES.turntable.r * 1.85, C.rail);
}
const turntableDeck = ttVB.mesh(standardMat());
turntableDeck.position.set(ZONES.turntable.cx, 0, ZONES.turntable.cz);
scene.add(turntableDeck);

// Parked stock in the yard
parkedStock(scene);

// Ships on two lanes of the harbour, well clear of the quay
const seaLane = (z) => new Route([[-0.15, z], [1.95, z], [1.95, z - 0.045], [-0.15, z - 0.045]]);
const ships = [];
{
  const cargo = ship(0.9, C.hull);
  cargo.userData = { route: seaLane(-0.985), d: 0.2, v: 0.055 };
  const cargo2 = ship(0.75, 0x2f5f8a);
  cargo2.userData = { route: seaLane(-1.058), d: 2.4, v: 0.042 };
  const tug = tugboat();
  tug.userData = { route: seaLane(-0.915), d: 1.4, v: 0.075 };
  ships.push(cargo, cargo2, tug);
  ships.forEach((s) => scene.add(s));
}

// Two portal cranes standing on the quay crane rails
const CRANE_Z = (ZONES.quayRailZ[0] + ZONES.quayRailZ[1]) / 2;
const cranes = ZONES.craneX.map((x) => {
  const c = portalCrane();
  c.position.set(x, 0, CRANE_Z);
  scene.add(c);
  return c;
});

// Road traffic on the two roads
const F = ZONES.roadFront, RR = ZONES.roadRight;
const roadLoop = new Route([
  [-1.70, F.z - 0.026], [RR.x - 0.026, F.z - 0.026], [RR.x - 0.026, -0.40],
  [RR.x + 0.026, -0.40], [RR.x + 0.026, F.z + 0.026], [-1.70, F.z + 0.026],
]);
const cars = [];
for (let i = 0; i < 9; i++) {
  const v = roadVehicle(i % 6);
  v.userData = { route: roadLoop, d: (i / 9) * roadLoop.length, v: 0.11 + (i % 3) * 0.03 };
  scene.add(v);
  cars.push(v);
}

/* ----------------------------------------------------------- control desk */

const state = {
  speed: 0.45, hour: 10.1,
  lights: false, autoSun: true, turntable: true, traffic: true, whistle: false,
};
const desk = buildDesk(scene, state);
attachInteraction(renderer, camera, desk, state, (id, on) => {
  if (id === 'whistle' && on) { whistle(); state.whistle = false; desk.buttons[4].pressT = 1; }
});

/* ----------------------------------------------------------------- camera */

let yaw = 0, pitch = 0;
addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  yaw = ((e.clientX / innerWidth) - 0.5) * 0.30;
  pitch = ((e.clientY / innerHeight) - 0.5) * 0.14;
});
function updateCamera() {
  camera.position.x += (yaw * 0.55 - camera.position.x) * 0.05;
  camera.lookAt(yaw * 0.8, -0.06 - pitch * 0.8, -0.15);
}
const _render = renderer.render.bind(renderer);
export const cam = { free: false };
renderer.render = (s, c) => { if (!cam.free) updateCamera(); _render(s, c); };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* -------------------------------------------------------------- run loop */

const world = {
  track, sids, train, freight, turntableDeck, ships, cranes, cars,
  windowMats: [windowMat, ...collectWindowMats(scene)],
  smoke: createSmoke(scene),
};

function collectWindowMats(root) {
  const out = [];
  root.traverse((o) => { if (o.userData?.isWindow && o.material) out.push(o.material); });
  return out;
}

const w = { renderer, scene, camera, state, desk, lights, water, world, fps: 0 };
createLoop(w).start();

// expose for the headless screenshot / QA harness
window.__railway = {
  w, state, desk, scene, camera, renderer, SOLIDS, BOARD, LOOP, ZONES,
  cam, freeCamera: (on) => { cam.free = on; },
  drawCalls: () => renderer.info.render.calls,
  triangles: () => renderer.info.render.triangles,
  setHour: (h) => { state.autoSun = false; state.hour = h; desk.levers[1].value = h / 24; },
  press: (id) => { state[id] = !state[id]; return state[id]; },
};
document.getElementById('loading')?.remove();
