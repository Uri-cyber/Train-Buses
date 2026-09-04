import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Home view: the busy centre of the country, north up, looking from the south-west. */
export const HOME = { target: new THREE.Vector3(-14, 0.4, 18), offset: new THREE.Vector3(-60, 250, 300) };

export function createCamera(renderer, terrain) {
  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.5;
  controls.maxDistance = 720;
  controls.maxPolarAngle = 1.32;
  controls.minPolarAngle = 0.04;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  let fly = null;      // { from, to, targetFrom, targetTo, t, dur }
  const api = {
    camera, controls, free: false,
    distance: () => camera.position.distanceTo(controls.target),
    /** animate to a view */
    flyTo(target, offset, dur = 2.2) {
      fly = { from: camera.position.clone(), to: target.clone().add(offset), targetFrom: controls.target.clone(), targetTo: target.clone(), t: 0, dur };
    },
    /** look at a ground point from a given distance, keeping the current tilt/heading */
    focus(x, z, dist = 18) {
      const y = terrain.heightAt(x, z);
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (dir.y < 0.35) { dir.y = 0.55; dir.normalize(); }
      api.flyTo(new THREE.Vector3(x, y, z), dir.multiplyScalar(dist), 1.6);
    },
    reset() { api.flyTo(HOME.target, HOME.offset, 2.4); },
    cancelFlight() { fly = null; },
    /** jump instantly (used by the screenshot harness) */
    setView(pos, target) {
      fly = null;
      camera.position.set(...pos); controls.target.set(...target);
      controls.update();
    },
    intro() {
      camera.position.copy(HOME.target).add(new THREE.Vector3(-120, 620, 760));
      controls.target.copy(HOME.target);
      api.flyTo(HOME.target, HOME.offset, 4.0);
    },
    update(dt) {
      if (fly) {
        fly.t = Math.min(1, fly.t + dt / fly.dur);
        const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - Math.pow(-2 * fly.t + 2, 3) / 2;   // ease in-out
        camera.position.lerpVectors(fly.from, fly.to, e);
        controls.target.lerpVectors(fly.targetFrom, fly.targetTo, e);
        if (fly.t >= 1) fly = null;
      }
      // keep the orbit centre on the ground, never under it
      const ground = terrain.heightAt(controls.target.x, controls.target.z);
      if (controls.target.y < ground) controls.target.y = ground;
      controls.update();
    },
    resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); },
  };
  // any user input cancels a flight
  renderer.domElement.addEventListener('pointerdown', () => { fly = null; });
  renderer.domElement.addEventListener('wheel', () => { fly = null; }, { passive: true });
  return api;
}
