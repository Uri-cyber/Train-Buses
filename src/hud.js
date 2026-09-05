import * as THREE from 'three';
import { Builder, stdMat } from './builder.js';
import { C } from './palette.js';

/**
 * The control console: a 3D desk rendered in its own overlay scene, pinned to
 * the bottom of the screen. Two levers (speed, time of day) and six latching
 * buttons with indicator lamps, labelled in Hebrew and English, plus a clock
 * showing Israel's time. Pointer events are handled here first; the map's
 * orbit controls only see what the desk does not take.
 */
export const LEVERS = [
  { id: 'speed', he: 'מהירות', en: 'SPEED', x: -0.44, colour: 0xd0342c },
  { id: 'time',  he: 'שעה',    en: 'TIME',  x: -0.27, colour: 0x2a63b8 },
];
export const BUTTONS = [
  { id: 'lights',    he: 'תאורה',        en: 'LIGHTS',    x: -0.06, on: 0x6ad07a },
  { id: 'autoSun',   he: 'שמש אמיתית',   en: 'REAL SUN',  x: 0.07,  on: 0xffc94d },
  { id: 'turntable', he: 'סובב קטרים',   en: 'TURNTABLE', x: 0.20,  on: 0x53b6ff },
  { id: 'traffic',   he: 'תנועה',        en: 'TRAFFIC',   x: 0.33,  on: 0xff8a4d },
  { id: 'whistle',   he: 'צפירה',        en: 'WHISTLE',   x: 0.46,  on: 0xff5f5f },
  { id: 'tour',      he: 'סיור',         en: 'TOUR',      x: 0.59,  on: 0xc7a2ff },
];
const PANEL_W = 1.40, PANEL_D = 0.19;
const FONT_HE = '"Segoe UI", Arial, "Noto Sans Hebrew", "DejaVu Sans", sans-serif';

function panelTexture() {
  const cv = document.createElement('canvas');
  cv.width = 1536; cv.height = 232;
  const g = cv.getContext('2d');
  g.fillStyle = '#16233a'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#1d2d4a'; g.fillRect(0, 0, cv.width, 30);
  g.fillStyle = '#d0342c'; g.fillRect(0, 30, cv.width, 6);
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`; g.fillRect(Math.random() * cv.width, 40 + Math.random() * 190, Math.random() * 90, 1); }
  const toU = (x) => ((x + PANEL_W / 2) / PANEL_W) * cv.width;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#f3ede2'; g.direction = 'rtl'; g.font = `bold 21px ${FONT_HE}`;
  g.fillText('ישראל ברכבת', cv.width - 150, 15);
  g.direction = 'ltr'; g.font = '600 15px "Segoe UI", Arial, sans-serif'; g.fillStyle = '#cfe3ff';
  g.fillText('ISRAEL BY RAIL  ·  CONTROL DESK', 240, 15);
  const label = (c, yHe, yEn) => {
    const u = toU(c.x);
    g.direction = 'rtl'; g.fillStyle = '#ffffff'; g.font = `bold 24px ${FONT_HE}`; g.fillText(c.he, u, yHe);
    g.direction = 'ltr'; g.fillStyle = '#9fb8dc'; g.font = '600 14px "Segoe UI", Arial, sans-serif'; g.fillText(c.en, u, yEn);
  };
  for (const c of BUTTONS) label(c, 70, 96);
  for (const c of LEVERS) label(c, 190, 214);
  g.strokeStyle = '#5c6f8f'; g.lineWidth = 2;
  for (const l of LEVERS) { const u = toU(l.x); for (let i = 0; i <= 6; i++) { const y = 56 + i * 17; g.beginPath(); g.moveTo(u - 46, y); g.lineTo(u - 34, y); g.stroke(); } }
  g.fillStyle = '#6f83a6'; g.font = '12px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.direction = 'ltr';
  g.fillText('Asia/Jerusalem', toU(-0.59), 216);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function clockCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const g = cv.getContext('2d');
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  let last = '';
  return { t, set(text, sub) {
    const key = text + sub;
    if (key === last) return; last = key;
    g.fillStyle = '#0a1220'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#ffd27a'; g.font = 'bold 52px "Segoe UI", Arial, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 40);
    g.fillStyle = '#7f95b8'; g.font = `15px ${FONT_HE}`; g.direction = 'rtl';
    g.fillText(sub, 128, 78);
    g.direction = 'ltr';
    t.needsUpdate = true;
  } };
}

export function createHud(renderer, state, { onPress, controls } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 12);
  scene.add(camera);
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2); key.position.set(0.4, 1.2, 0.8); camera.add(key);
  const fill = new THREE.HemisphereLight(0xcfe3ff, 0x2a2a30, 0.9); camera.add(fill);

  const desk = new THREE.Group();
  desk.position.set(0, -0.52, -2.25);
  desk.rotation.x = 0.6;
  camera.add(desk);

  // carcass
  const cb = new Builder(1);
  cb.box(0, -0.015, 0.0, PANEL_W + 0.10, 0.03, PANEL_D + 0.10, 0x2a2f38);
  cb.box(0, -0.035, PANEL_D / 2 + 0.06, PANEL_W + 0.14, 0.05, 0.06, 0x35404f);
  for (const s of [-1, 1]) cb.box(s * (PANEL_W / 2 + 0.06), 0.0, 0, 0.03, 0.06, PANEL_D + 0.1, 0x35404f);
  desk.add(cb.mesh(stdMat({ roughness: 0.6, metalness: 0.2 }), { shadow: false }));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_D), new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.55, metalness: 0.15 }));
  panel.rotation.x = -Math.PI / 2; panel.position.y = 0.002;
  desk.add(panel);

  const interactive = [];
  const levers = LEVERS.map((spec) => {
    const pivot = new THREE.Group();
    pivot.position.set(spec.x, 0.004, -0.02);
    desk.add(pivot);
    const lb = new Builder(2);
    lb.cyl(0, 0.045, 0, 0.0055, 0.09, C.rail, 8);
    lb.box(0, 0.006, 0, 0.022, 0.012, 0.022, 0x1c2230);
    const stick = lb.mesh(stdMat({ roughness: 0.35, metalness: 0.5 }), { shadow: false });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), new THREE.MeshStandardMaterial({ color: spec.colour, roughness: 0.3 }));
    knob.position.y = 0.094;
    pivot.add(stick, knob);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.004, 0.078), new THREE.MeshStandardMaterial({ color: 0x080c14 }));
    slot.position.set(spec.x, 0.004, -0.045);
    desk.add(slot);
    const lever = { spec, pivot, knob, value: 0.5, dragging: false };
    knob.userData.lever = lever; stick.userData.lever = lever;
    interactive.push(knob, stick);
    return lever;
  });

  const buttons = BUTTONS.map((spec) => {
    const g = new THREE.Group();
    g.position.set(spec.x, 0.004, 0.028);
    desk.add(g);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.008, 18), new THREE.MeshStandardMaterial({ color: 0x0f1521, roughness: 0.7 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 18), new THREE.MeshStandardMaterial({ color: 0x4a5261, roughness: 0.4 }));
    cap.position.y = 0.01;
    const led = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 14), new THREE.MeshBasicMaterial({ color: 0x1c2230, toneMapped: false }));
    led.position.y = 0.017;
    g.add(bezel, cap, led);
    const button = { spec, group: g, cap, led, restY: 0.01, pressT: 0 };
    cap.userData.button = button; led.userData.button = button; bezel.userData.button = button;
    interactive.push(cap, led, bezel);
    return button;
  });

  // clock
  const clock = clockCanvas();
  const clockMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.07), new THREE.MeshBasicMaterial({ map: clock.t, toneMapped: false }));
  clockMesh.rotation.x = -Math.PI / 2; clockMesh.position.set(-0.59, 0.004, 0.02);
  desk.add(clockMesh);

  /* ------------------------------------------------------- interaction */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const el = renderer.domElement;
  let drag = null;
  const pick = (e) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    camera.updateMatrixWorld(true);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(interactive, false)[0];
  };
  const press = (id) => {
    const b = buttons.find((x) => x.spec.id === id);
    if (!b) return;
    b.pressT = 1;
    if (id === 'whistle') { onPress?.('whistle', true); return; }
    state[id] = !state[id];
    onPress?.(id, state[id]);
  };
  el.addEventListener('pointerdown', (e) => {
    const hit = pick(e);
    if (!hit) return;
    e.stopImmediatePropagation();
    const { lever, button } = hit.object.userData;
    if (lever) {
      drag = { lever, y0: e.clientY, v0: lever.value };
      lever.dragging = true;
      if (controls) controls.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
      el.style.cursor = 'grabbing';
    } else if (button) press(button.spec.id);
  }, { capture: true });
  el.addEventListener('pointermove', (e) => {
    if (drag) {
      e.stopImmediatePropagation();
      drag.lever.value = Math.max(0, Math.min(1, drag.v0 + (drag.y0 - e.clientY) / 190));
      return;
    }
    el.style.cursor = pick(e) ? 'grab' : '';
  }, { capture: true });
  const end = (e) => {
    if (!drag) return;
    e.stopImmediatePropagation();
    drag.lever.dragging = false; drag = null;
    if (controls) controls.enabled = true;
    try { el.releasePointerCapture(e.pointerId); } catch { /* fine */ }
    el.style.cursor = '';
  };
  el.addEventListener('pointerup', end, { capture: true });
  el.addEventListener('pointercancel', end, { capture: true });

  const _c = new THREE.Color();
  return {
    scene, camera, desk, levers, buttons, interactive, press,
    setLever(id, v) { const l = levers.find((x) => x.spec.id === id); if (l) l.value = Math.max(0, Math.min(1, v)); },
    /** two-way binding with the app state, once per frame */
    update(dt, clockText, clockSub) {
      const speed = levers[0], time = levers[1];
      if (speed.dragging) state.speed = speed.value; else speed.value = state.speed;
      if (time.dragging) { state.autoSun = false; state.hour = time.value * 24; } else time.value = state.hour / 24;
      for (const l of levers) {
        const target = (l.value - 0.5) * 1.1;
        l.pivot.rotation.x += (target - l.pivot.rotation.x) * Math.min(1, dt * 16);
      }
      for (const b of buttons) {
        const on = b.spec.id === 'whistle' ? b.pressT > 0.3 : !!state[b.spec.id];
        b.pressT = Math.max(0, b.pressT - dt * 3);
        const y = b.restY - (on ? 0.004 : 0) - b.pressT * 0.002;
        b.cap.position.y += (y - b.cap.position.y) * Math.min(1, dt * 18);
        b.led.position.y = b.cap.position.y + 0.007;
        _c.setHex(on ? b.spec.on : 0x1c2230);
        b.led.material.color.lerp(_c, Math.min(1, dt * 12));
      }
      clock.set(clockText, clockSub);
    },
    render() {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.autoClear = true;
    },
    resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); },
  };
}
