import * as THREE from 'three';
import { VoxelBuilder, standardMat, emissiveMat } from './voxel.js';
import { C } from './palette.js';
import { DESK } from './layout.js';

const PANEL_Z = (DESK.z0 + DESK.z1) / 2;

export const BUTTONS = [
  { id: 'lights',    label: 'LIGHTS',    x: -0.02, on: 0x6ad07a },
  { id: 'autoSun',   label: 'AUTO SUN',  x: 0.10,  on: 0xffc94d },
  { id: 'turntable', label: 'TURNTABLE', x: 0.22,  on: 0x53b6ff },
  { id: 'traffic',   label: 'TRAFFIC',   x: 0.34,  on: 0xff8a4d },
  { id: 'whistle',   label: 'WHISTLE',   x: 0.46,  on: 0xff5f5f },
];

export const LEVERS = [
  { id: 'speed', label: 'SPEED', x: -0.40 },
  { id: 'time',  label: 'TIME',  x: -0.22 },
];

/** Panel face texture with the labels drawn procedurally (no external assets). */
function panelTexture() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#2b2723'; g.fillRect(0, 0, 1024, 256);
  // brushed streaks
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
    g.fillRect(Math.random() * 1024, Math.random() * 256, Math.random() * 120, 1);
  }
  g.strokeStyle = '#5d5348'; g.lineWidth = 3;
  g.strokeRect(8, 8, 1008, 240);
  g.fillStyle = '#d8cfbe';
  g.font = 'bold 26px monospace';
  g.textAlign = 'center';
  const toU = (x) => ((x - DESK.x0) / (DESK.x1 - DESK.x0)) * 1024;
  for (const l of LEVERS) { g.fillText(l.label, toU(l.x), 104); }
  g.font = 'bold 15px monospace';
  for (const b of BUTTONS) { g.fillText(b.label, toU(b.x), 104); }
  g.font = 'bold 20px monospace';
  g.fillStyle = '#9a8f7d';
  g.textAlign = 'left';
  g.fillText('VOXEL MODEL RAILWAY  /  CONTROL DESK', 30, 40);
  g.fillStyle = '#7d7365';
  g.font = '15px monospace';
  g.textAlign = 'right';
  g.fillText('MPH', 986, 40);
  // tick marks beside each lever
  g.strokeStyle = '#8c8172'; g.lineWidth = 2;
  for (const l of LEVERS) {
    const u = toU(l.x);
    for (let i = 0; i <= 5; i++) {
      const y = 128 + i * 21;
      g.beginPath(); g.moveTo(u - 56, y); g.lineTo(u - 42, y); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildDesk(scene, state) {
  const root = new THREE.Group();
  scene.add(root);

  const w = DESK.x1 - DESK.x0, cx = (DESK.x0 + DESK.x1) / 2;
  const TILT = 0.62;                         // radians below horizontal
  const PANEL_D = 0.125;                     // panel depth measured up the slope

  // --- desk carcass (static, merged). Sloped front like a signalling desk.
  const vb = new VoxelBuilder();
  vb.box(cx, 0.012, PANEL_Z + 0.035, w + 0.10, 0.024, 0.20, C.deskTop, { jitter: 0.04 });
  vb.box(cx, 0.040, PANEL_Z + 0.082, w + 0.09, 0.056, 0.070, C.desk, { jitter: 0.05 });
  vb.box(cx, 0.070, PANEL_Z + 0.082, w + 0.10, 0.010, 0.078, 0x6b5745);
  for (const s2 of [-1, 1]) {   // side cheeks, cut to the panel angle
    const sx = cx + s2 * (w / 2 + 0.032);
    vb.box(sx, 0.030, PANEL_Z + 0.02, 0.026, 0.060, 0.17, C.desk, { jitter: 0.05 });
    vb.box(sx, 0.068, PANEL_Z + 0.005, 0.026, 0.030, 0.115, C.desk, { rotX: TILT, jitter: 0.05 });
  }
  const carcass = vb.mesh(standardMat({ roughness: 0.68 }));
  root.add(carcass);

  // --- the tilted panel gets its own frame; every control is a child of it, so
  //     the desk stays consistent if the angle is ever changed.
  const panelGroup = new THREE.Group();
  panelGroup.position.set(cx, 0.074, PANEL_Z + 0.012);
  panelGroup.rotation.x = TILT;   // +ve tilts the panel face up towards the viewer
  root.add(panelGroup);

  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(w, PANEL_D),
    new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.5, metalness: 0.12 }),
  );
  panel.rotation.x = -Math.PI / 2;            // lie flat within the panel frame
  panel.position.y = 0.004;
  panel.receiveShadow = true;
  panelGroup.add(panel);
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.012, 0.010, PANEL_D + 0.012),
    new THREE.MeshStandardMaterial({ color: 0x3a322a, roughness: 0.75 }),
  );
  slab.position.y = -0.002; slab.castShadow = true; slab.receiveShadow = true;
  panelGroup.add(slab);

  const interactive = [];
  const localX = (x) => x - cx;

  // --- levers: pivot low on the panel, swing up the slope
  const levers = LEVERS.map((spec) => {
    const pivot = new THREE.Group();
    pivot.position.set(localX(spec.x), 0.006, 0.030);
    panelGroup.add(pivot);
    const lb = new VoxelBuilder();
    lb.cyl(0, 0.036, 0, 0.0050, 0.072, C.steel, 8);
    lb.box(0, 0.006, 0, 0.020, 0.012, 0.020, C.steelDark);
    const stick = lb.mesh(standardMat({ roughness: 0.35, metalness: 0.45 }));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 14, 10),
      new THREE.MeshStandardMaterial({
        color: spec.id === 'speed' ? 0xc0392b : 0x2e6f9e, roughness: 0.3,
      }));
    knob.position.y = 0.076; knob.castShadow = true;
    pivot.add(stick, knob);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.004, 0.062),
      new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 0.9 }));
    slot.position.set(localX(spec.x), 0.006, 0.006);
    panelGroup.add(slot);
    const obj = { spec, pivot, knob, value: spec.id === 'speed' ? 0.45 : 0.42 };
    knob.userData.lever = obj; stick.userData.lever = obj;
    interactive.push(knob, stick);
    return obj;
  });

  // --- buttons, standing proud of the panel face
  const buttons = BUTTONS.map((spec) => {
    const g = new THREE.Group();
    g.position.set(localX(spec.x), 0.006, 0.006);
    panelGroup.add(g);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.019, 0.008, 16),
      new THREE.MeshStandardMaterial({ color: 0x1d1916, roughness: 0.7 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.011, 16),
      new THREE.MeshStandardMaterial({ color: 0x585144, roughness: 0.4 }));
    cap.position.y = 0.009; cap.castShadow = true;
    const led = new THREE.Mesh(new THREE.CylinderGeometry(0.0078, 0.0078, 0.004, 12),
      new THREE.MeshBasicMaterial({ color: 0x2a2a2a, toneMapped: false }));
    led.position.y = 0.0155;
    g.add(bezel, cap, led);
    const obj = { spec, group: g, cap, led, restY: 0.009 };
    cap.userData.button = obj; led.userData.button = obj; bezel.userData.button = obj;
    interactive.push(cap, led, bezel);
    return obj;
  });

  // --- speed dial at the right-hand end of the panel
  const dialGroup = new THREE.Group();
  dialGroup.position.set(localX(0.56), 0.006, 0.012);
  panelGroup.add(dialGroup);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.005, 22),
    new THREE.MeshStandardMaterial({ color: 0xe8e0cd, roughness: 0.55 }));
  dial.position.y = 0.003;
  const nGroup = new THREE.Group(); nGroup.position.y = 0.0065;
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.002, 0.021),
    new THREE.MeshBasicMaterial({ color: 0xc0392b, toneMapped: false }));
  needle.position.z = -0.010;
  nGroup.add(needle);
  dialGroup.add(dial, nGroup);

  // --- small warm lamp clipped to the desk so the panel always reads
  const deskLamp = new THREE.PointLight(0xffe0b0, 0.5, 1.2, 2.2);
  deskLamp.position.set(cx, 0.32, PANEL_Z - 0.12);
  root.add(deskLamp);

  return { root, levers, buttons, interactive, needle: nGroup, panel, panelGroup, deskLamp };
}

/** Wires pointer events to the desk. Mutates `state`. */
export function attachInteraction(renderer, camera, desk, state, onPress) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let dragging = null, dragStartY = 0, dragStartValue = 0;
  const el = renderer.domElement;
  // The idle camera drift must not slide the desk out from under the pointer,
  // so the camera reads these while the desk is being used.
  desk.pointer = { hover: false, dragging: false };

  const setNdc = (e) => {
    const r = el.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };

  el.addEventListener('pointerdown', (e) => {
    setNdc(e);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(desk.interactive, false)[0];
    if (!hit) return;
    const lever = hit.object.userData.lever;
    const button = hit.object.userData.button;
    if (lever) {
      dragging = lever; dragStartY = e.clientY; dragStartValue = lever.value;
      desk.pointer.dragging = true;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    } else if (button) {
      state[button.spec.id] = !state[button.spec.id];
      button.pressT = 1;
      onPress?.(button.spec.id, state[button.spec.id]);
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dy = (dragStartY - e.clientY) / 190;      // up = more
      dragging.value = Math.max(0, Math.min(1, dragStartValue + dy));
      return;
    }
    setNdc(e);
    ray.setFromCamera(ndc, camera);
    const over = ray.intersectObjects(desk.interactive, false).length > 0;
    desk.pointer.hover = over;
    el.style.cursor = over ? 'grab' : 'default';
  });

  const end = (e) => {
    if (dragging) { try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }
    dragging = null; desk.pointer.dragging = false; el.style.cursor = 'default';
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  // keyboard fallbacks, handy for testing and accessibility
  addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.15 : 0.05;
    if (e.key === 'ArrowUp') desk.levers[0].value = Math.min(1, desk.levers[0].value + step);
    if (e.key === 'ArrowDown') desk.levers[0].value = Math.max(0, desk.levers[0].value - step);
    if (e.key === 'ArrowRight') desk.levers[1].value = Math.min(1, desk.levers[1].value + step);
    if (e.key === 'ArrowLeft') desk.levers[1].value = Math.max(0, desk.levers[1].value - step);
    const idx = ['1', '2', '3', '4', '5'].indexOf(e.key);
    if (idx >= 0) {
      const b = desk.buttons[idx];
      state[b.spec.id] = !state[b.spec.id];
      b.pressT = 1;
      onPress?.(b.spec.id, state[b.spec.id]);
    }
  });
}

const _col = new THREE.Color();

/** Per-frame visual update of the desk. */
export function updateDesk(desk, state, dt) {
  for (const l of desk.levers) {
    const target = (l.value - 0.5) * 1.05;
    l.pivot.rotation.x += (target - l.pivot.rotation.x) * Math.min(1, dt * 14);
  }
  for (const b of desk.buttons) {
    const on = !!state[b.spec.id];
    b.pressT = Math.max(0, (b.pressT ?? 0) - dt * 4);
    const targetY = b.restY - (on ? 0.0035 : 0) - b.pressT * 0.002;
    b.cap.position.y += (targetY - b.cap.position.y) * Math.min(1, dt * 18);
    b.led.position.y = b.cap.position.y + 0.0058;
    _col.setHex(on ? b.spec.on : 0x241f1c);
    b.led.material.color.lerp(_col, Math.min(1, dt * 12));
    b.cap.material.color.lerp(_col.clone().multiplyScalar(on ? 0.45 : 1).lerp(
      new THREE.Color(0x4a443c), on ? 0.35 : 1), Math.min(1, dt * 12));
  }
  desk.needle.rotation.y = (0.5 - desk.levers[0].value) * 2.2;
}
