import * as THREE from 'three';
import { C, mixHex, clamp01 } from './palette.js';

/**
 * One real sun (a shadow-casting directional light that follows the true
 * solar direction) and a sky/ground hemisphere; toon materials take no
 * reflections, so there is no environment map. The shadow frustum follows the camera target and scales
 * with zoom so shadows stay sharp whether you look at the whole country or
 * one station.
 */
export function createLighting(scene, renderer) {
  const sun = new THREE.DirectionalLight(C.sun, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1600;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(C.horizonDay, 0xcbb894, 0.6);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0x9fb6e0, 0);
  scene.add(moon);

  const _target = new THREE.Vector3();
  return {
    sun, hemi, moon,
    /**
     * @param sky   result of sky.update()
     * @param focus world point the camera looks at
     * @param dist  camera distance to it (km)
     */
    update(sky, focus, dist) {
      const { dir, elevation: el, day } = sky;
      _target.copy(focus);
      sun.target.position.copy(_target);
      sun.position.copy(_target).addScaledVector(dir, 600);
      sun.color.setHex(mixHex(0xff9450, C.sun, clamp01(el * 3)));
      sun.intensity = 0.12 + Math.pow(day, 0.75) * 1.9;
      // shadow box hugs what is on screen
      const S = Math.max(6, Math.min(280, dist * 0.95));
      const cam = sun.shadow.camera;
      cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S;
      cam.updateProjectionMatrix();
      sun.shadow.needsUpdate = true;

      hemi.color.setHex(mixHex(0x10203a, C.horizonDay, day));
      hemi.groundColor.setHex(mixHex(0x0b0f18, 0xcbb894, day));
      hemi.intensity = 0.14 + day * 0.8;

      moon.position.copy(_target).addScaledVector(dir, -600);
      moon.intensity = clamp01((-el - 0.04) * 5) * 0.35;
    },
  };
}
