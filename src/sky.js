import * as THREE from 'three';
import { C, mixHex, smooth, clamp01 } from './palette.js';
import { radialSprite, cloudSprite } from './textures.js';

/* ------------------------------------------------------- the real sun */

const D2R = Math.PI / 180;

/** Solar elevation/azimuth (radians; azimuth clockwise from north) for a UTC date. */
export function solarPosition(date, latDeg = 31.8, lonDeg = 35.0) {
  const n = date.getTime() / 86400000 - 10957.5;                  // days since J2000
  const L = ((280.46 + 0.9856474 * n) % 360 + 360) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360;
  const lambda = (L + 1.915 * Math.sin(g * D2R) + 0.020 * Math.sin(2 * g * D2R)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const lst = (gmst + lonDeg / 15) * 15 * D2R;
  const H = lst - ra;
  const lat = latDeg * D2R;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  return { elevation: el, azimuth: az };
}

/** Israel's wall clock right now: decimal hour and the UTC offset in hours. */
export function israelClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).formatToParts(now);
  const get = (t) => +parts.find((p) => p.type === t).value;
  const hour = (get('hour') % 24) + get('minute') / 60 + get('second') / 3600;
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  let offset = hour - utcHour;
  if (offset < -12) offset += 24; if (offset > 12) offset -= 24;
  return { hour, offset: Math.round(offset * 4) / 4 };
}

/** A UTC Date for today at the given Israel wall-clock hour. */
export function dateAtIsraelHour(hourLocal, now = new Date()) {
  const { offset } = israelClock(now);
  const d = new Date(now.getTime());
  const utcH = hourLocal - offset;
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + utcH * 3600000);
}

/* ------------------------------------------------------------- the dome */

const SkyShader = {
  uniforms: {
    top: { value: new THREE.Color(C.zenithDay) },
    horizon: { value: new THREE.Color(C.horizonDay) },
    ground: { value: new THREE.Color(0x0a2e48) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(C.sun) },
    sunUp: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;                          // always at the far plane
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 top, horizon, ground, sunDir, sunColor; uniform float sunUp;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float y = d.y;
      vec3 sky = mix(horizon, top, pow(clamp(y, 0.0, 1.0), 0.5));
      // below the horizon: haze fading into deep sea, seen when looking down from height
      sky = mix(sky, ground, smoothstep(0.0, -0.35, y));
      float s = max(dot(d, sunDir), 0.0);
      float glow = pow(s, 6.0) * 0.16 + pow(s, 48.0) * 0.45;
      float disc = smoothstep(0.99935, 0.99975, s);
      vec3 col = sky + sunColor * (glow + disc * 1.6) * sunUp;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createSky(scene) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24),
    new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false }));
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // stars
  const N = 1600, pts = new Float32Array(N * 3);
  let s = 7;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
    const y = Math.abs(u) * 0.9 + 0.06, r = Math.sqrt(1 - y * y);
    pts[i * 3] = Math.cos(a) * r * 1350; pts[i * 3 + 1] = y * 1350; pts[i * 3 + 2] = Math.sin(a) * r * 1350;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
  stars.frustumCulled = false;
  scene.add(stars);

  // clouds: flat sprites drifting over the country
  const cloudTex = cloudSprite();
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.9, side: THREE.DoubleSide });
  const clouds = new THREE.Group();
  for (let i = 0; i < 34; i++) {
    const w = 10 + rnd() * 18;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.78), cloudMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rnd() * Math.PI;
    m.position.set(-95 + rnd() * 170, 5.5 + rnd() * 2.5, -160 + rnd() * 430);
    m.userData.v = 0.15 + rnd() * 0.25;
    clouds.add(m);
  }
  scene.add(clouds);

  // sun and moon glows as sprites, so they sit "in" the scene for bloom
  const glowTex = radialSprite(128, 0.05, 1, 2.2);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C.sun, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunSprite.scale.set(160, 160, 1);
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C.moon, transparent: true, depthWrite: false, opacity: 0.55 }));
  moonSprite.scale.set(50, 50, 1);
  scene.add(sunSprite, moonSprite);

  scene.fog = new THREE.Fog(C.horizonDay, 420, 2400);


  const u = dome.material.uniforms;
  const sunDir = new THREE.Vector3();
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();

  return {
    dome, stars, clouds,
    /** @param hourLocal Israel wall-clock hour (0..24) */
    update(hourLocal, dt = 0, cameraPos = null) {
      const date = dateAtIsraelHour(hourLocal);
      const { elevation, azimuth } = solarPosition(date);
      // world: +x east, -z north. azimuth clockwise from north.
      sunDir.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
      const el = Math.sin(elevation);
      const day = clamp01((el + 0.04) * 3.2);
      const dusk = Math.max(0, 1 - Math.abs(el) * 4.5) * (1 - Math.abs(el) * 2 > 0 ? 1 : 0.5);
      u.top.value.setHex(mixHex(mixHex(C.zenithNight, C.zenithDusk, dusk), C.zenithDay, day));
      u.horizon.value.setHex(mixHex(mixHex(C.horizonNight, C.horizonDusk, dusk), C.horizonDay, day));
      u.sunDir.value.copy(sunDir);
      u.sunUp.value = clamp01((el + 0.02) * 12);
      u.ground.value.setHex(mixHex(0x06131f, 0x0a2e48, day));
      u.sunColor.value.setHex(mixHex(0xff8a3c, C.sun, clamp01(el * 2.5)));
      stars.material.opacity = clamp01((-el - 0.03) * 8) * 0.9;
      scene.fog.color.copy(u.horizon.value);
      const anchor = cameraPos ?? new THREE.Vector3();
      sunSprite.position.copy(anchor).addScaledVector(sunDir, 1200);
      sunSprite.material.opacity = u.sunUp.value * 0.9;
      moonSprite.position.copy(anchor).addScaledVector(sunDir, -1200);
      moonSprite.material.opacity = clamp01((-el - 0.05) * 6) * 0.7;
      cloudMat.color.setHex(mixHex(0x2a3550, mixHex(0xf1c9a0, 0xffffff, clamp01(el * 3)), clamp01((el + 0.1) * 2.5)));
      for (const c of clouds.children) {
        c.position.x += c.userData.v * dt;
        if (c.position.x > 100) c.position.x = -100;
      }
      return { dir: sunDir, elevation: el, day, dusk, sunColor: u.sunColor.value };
    },
  };
}
