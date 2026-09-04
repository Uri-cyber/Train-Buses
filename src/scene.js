import * as THREE from 'three';
import { EYE_Y, EYE_Z } from './layout.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.05, 60);
  cam.position.set(0, EYE_Y, EYE_Z);
  cam.lookAt(0, -0.06, -0.15);
  return cam;
}

/** Sky, ambient bounce, the sun/moon and its shadow camera. */
export function createLighting(scene) {
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6d6152, 0.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe9c4, 2.0);
  sun.castShadow = true;
  // Tight ortho frustum around the baseboard keeps the shadow map sharp and cheap.
  // Only the baseboard needs shadows, so the frustum hugs the table: this keeps
  // the 2048 map dense and stops the room from sampling outside it.
  const S = 2.15;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S * 0.8; sun.shadow.camera.bottom = -S * 0.8;
  sun.shadow.camera.near = 1.0; sun.shadow.camera.far = 14;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 3;                   // soft edges with PCFSoft
  sun.target.position.set(0, 0.02, -0.05);
  scene.add(sun, sun.target);

  // Warm practical bounce so the front of buildings never goes fully black.
  const fill = new THREE.DirectionalLight(0xffd9b0, 0.30);
  fill.position.set(0.6, 1.1, 3.0);
  scene.add(fill);

  // Room lamp, only on at night / when the lights button is pressed.
  const lamp = new THREE.PointLight(0xffce8a, 0, 7, 2);
  lamp.position.set(0, 1.75, 0.2);
  scene.add(lamp);

  return { hemi, sun, fill, lamp };
}

const SKY_NIGHT = new THREE.Color(0x0d1424);
const SKY_DAWN  = new THREE.Color(0xe98a5a);
const SKY_DAY   = new THREE.Color(0x9dc4e8);
const _a = new THREE.Color(), _b = new THREE.Color();

/**
 * Drives the sun for a given hour (0..24). Returns the daylight factor 0..1
 * so other systems (window lights, street lamps) can react to it.
 */
export function updateSun(lights, scene, hour) {
  const theta = ((hour - 6) / 12) * Math.PI;      // 0 at 06:00, PI at 18:00
  const R = 6.5;
  const el = Math.sin(theta);
  const up = Math.max(el, 0);
  const day = Math.max(0, Math.min(1, el * 2.6));  // 0 at horizon, 1 well up
  const dawnish = Math.max(0, 1 - Math.abs(el) * 5); // peaks at the horizon

  const { sun, hemi, fill } = lights;
  sun.position.set(-Math.cos(theta) * R, Math.max(el * R, -1.2), 0.30 * R);

  if (el > -0.02) {
    sun.intensity = 0.35 + up * 2.1;
    _a.setHex(0xff9a4d).lerp(_b.setHex(0xfff3d6), Math.min(1, up * 2.2));
    sun.color.copy(_a);
  } else {
    // moonlight
    sun.position.set(Math.cos(theta) * R, Math.max(-el * R, 0.9), 0.30 * R);
    sun.intensity = 0.22;
    sun.color.setHex(0x9db8e0);
  }

  hemi.intensity = 0.10 + day * 0.78;
  hemi.color.setHex(0x0f1a30).lerp(_b.setHex(0xbcd8ff), day);
  fill.intensity = 0.07 + day * 0.30;

  _a.copy(SKY_NIGHT).lerp(SKY_DAWN, dawnish).lerp(SKY_DAY, day);
  scene.background = _a.clone();
  if (scene.fog) { scene.fog.color.copy(_a); }

  return { day, dawnish, elevation: el };
}
