import * as THREE from 'three';
import { C, mixHex, smooth, clamp01 } from './palette.js';
import { radialSprite, cloudSprite, moonDisc } from './textures.js';

/* ------------------------------------------------------- the real sun */

const D2R = Math.PI / 180;
// days since a known new moon, for the phase drawn on the disc (2000-01-06)
const MOON_EPOCH_DAYS = 9800;

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
let _offAt = -1e9, _off = 0;                    // the Israel UTC offset, refreshed once a second (Intl is slow per frame)

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

/**
 * Seconds after midnight in Israel, continuous: israelClock resolves to whole
 * seconds, and a timetable driven by that moves in one-second hops instead of
 * gliding. This keeps the sub-second part, using the cached offset so there is
 * no Intl call per frame.
 */
export function israelSeconds(now = new Date()) {
  const ms = now.getTime();
  if (ms - _offAt > 1000) { _off = israelClock(now).offset; _offAt = ms; }
  return ((((ms / 1000) + _off * 3600) % 86400) + 86400) % 86400;
}

/** A UTC Date for today at the given Israel wall-clock hour. */
export function dateAtIsraelHour(hourLocal, now = new Date()) {
  const ms = now.getTime();
  if (ms - _offAt > 1000) { _off = israelClock(now).offset; _offAt = ms; }
  const d = new Date(ms);
  const utcH = hourLocal - _off;
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
    dusk: { value: 0 },
    horizonWarm: { value: new THREE.Color(C.horizonDusk) },
  },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;                          // always at the far plane
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 top, horizon, ground, sunDir, sunColor, horizonWarm; uniform float sunUp, dusk;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float y = d.y;
      vec3 sky = mix(horizon, top, pow(clamp(y, 0.0, 1.0), 0.5));
      // below the horizon: haze fading into deep sea, seen when looking down from height
      sky = mix(sky, ground, smoothstep(0.0, -0.35, y));
      // at dusk the warm glow sits only on the sun's side of the horizon; the far side stays cool
      float toSun = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0), 3.0);
      sky = mix(sky, horizonWarm, toSun * dusk * (1.0 - smoothstep(0.0, 0.35, y)));
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
  // each star gets its own phase, so they flicker out of step with one another
  const phases = new Float32Array(N);
  for (let i = 0; i < N; i++) phases[i] = rnd() * 6.283;
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
    transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float aPhase; uniform float uTime; varying float vTw;
      void main() {
        vTw = 0.72 + 0.28 * sin(uTime * 2.1 + aPhase);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 2.4 * vTw;
      }`,
    fragmentShader: `uniform float uOpacity; varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.12, d) * uOpacity * vTw;
        if (a < 0.01) discard;
        gl_FragColor = vec4(1.0, 0.98, 0.94, a);
      }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
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
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C.sun, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sunSprite.scale.set(70, 70, 1);
  // the moon: a small crisp disc with its phase, inside a soft halo
  const moonPhase = ((MOON_EPOCH_DAYS + 0.5) % 29.53) / 29.53;
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonDisc(64, moonPhase), transparent: true, depthWrite: false, opacity: 0, fog: false }));
  moonSprite.scale.set(11, 11, 1);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C.moon, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, fog: false }));
  moonHalo.scale.set(44, 44, 1);
  scene.add(sunSprite, moonHalo, moonSprite);

  scene.fog = new THREE.Fog(C.horizonDay, 420, 2400);


  const u = dome.material.uniforms;
  const sunDir = new THREE.Vector3();
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();
  const _moon = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  return {
    dome, stars, clouds, moonDir: _moon,
    /**
     * @param hourLocal Israel wall-clock hour (0..24)
     * @param dist      camera distance to what it looks at (km): the haze scales with the shot
     */
    update(hourLocal, dt = 0, cameraPos = null, dist = 400) {
      const date = dateAtIsraelHour(hourLocal);
      const { elevation, azimuth } = solarPosition(date);
      // world: +x east, -z north. azimuth clockwise from north.
      sunDir.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
      const el = Math.sin(elevation);
      const day = clamp01((el + 0.04) * 3.2);
      const dusk = Math.max(0, 1 - Math.abs(el) * 4.5) * (1 - Math.abs(el) * 2 > 0 ? 1 : 0.5);
      u.top.value.setHex(mixHex(mixHex(C.zenithNight, C.zenithDusk, dusk), C.zenithDay, day));
      u.horizon.value.setHex(mixHex(mixHex(C.horizonNight, C.horizonDusk, dusk * 0.5), C.horizonDay, day));
      u.dusk.value = dusk;
      u.sunDir.value.copy(sunDir);
      u.sunUp.value = clamp01((el + 0.02) * 12);
      u.ground.value.setHex(mixHex(0x06131f, 0x0a2e48, day));
      u.sunColor.value.setHex(mixHex(0xff8a3c, C.sun, clamp01(el * 2.5)));
      starMat.uniforms.uOpacity.value = clamp01((-el - 0.03) * 8) * 0.95;
      // aerial perspective: the followed train stays crisp (near >= 1.6 x distance) and the hills
      // behind it fade toward the horizon colour; from the country view the fog is effectively off.
      // A low sun thickens the haze, and at dusk it warms toward the sun's side of the sky.
      const haze = 1 - 0.35 * clamp01((0.35 - el) / 0.35) * day;
      scene.fog.near = Math.max(8, dist * 1.6);
      scene.fog.far = Math.max(60, (dist * 9 + 120) * haze);
      _c1.setHex(mixHex(u.horizon.value.getHex(), 0xe8c4a0, dusk * 0.5));
      scene.fog.color.copy(_c1);
      const anchor = cameraPos ?? new THREE.Vector3();
      sunSprite.position.copy(anchor).addScaledVector(sunDir, 1200);
      sunSprite.scale.setScalar(70 + 60 * dusk);          // a small crisp disc by day, a fatter low sun at dusk
      sunSprite.material.opacity = u.sunUp.value * 0.6;
      // the moon rides opposite the sun, swung aside so it is never exactly antipodal
      _moon.copy(sunDir).multiplyScalar(-1).applyAxisAngle(UP, 0.44).normalize();
      const moonUp = clamp01((-el - 0.05) * 6);
      moonSprite.position.copy(anchor).addScaledVector(_moon, 1200);
      moonSprite.material.opacity = moonUp;
      moonHalo.position.copy(moonSprite.position);
      moonHalo.material.opacity = moonUp * 0.3;
      // the stars twinkle and wheel; on the fast sky clock they wheel visibly
      starMat.uniforms.uTime.value += dt;
      stars.rotation.y += dt * 0.0016;
      cloudMat.color.setHex(mixHex(0x2a3550, mixHex(0xf1c9a0, 0xffffff, clamp01(el * 3)), clamp01((el + 0.1) * 2.5)));
      for (const c of clouds.children) {
        c.position.x += c.userData.v * dt;
        if (c.position.x > 100) c.position.x = -100;
      }
      // the cool wash after the sun has gone and before full night
      const blueHour = clamp01((-el + 0.05) * 8) * (1 - clamp01((-el - 0.15) * 6));
      return { dir: sunDir, elevation: el, day, dusk, blueHour, sunColor: u.sunColor.value };
    },
  };
}
