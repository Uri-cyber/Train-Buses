import * as THREE from 'three';
import { makeMask, makeProjection, distanceTransform, sampleField } from './geo.js';
import { C, mixHex, smooth, clamp01 } from './palette.js';
import { noise2, fbm, groundNormal } from './textures.js';

/**
 * The land. A heightfield sculpted from Israel's named relief (there is no
 * elevation API reachable from the build sandbox), cut by the real coastline
 * and lake masks from Natural Earth, coloured by biome. 1 unit = 1 km on the
 * ground; heights are exaggerated VEXAG times so the relief reads from the air.
 */
export const VEXAG = 3.0;
export const yOf = (metres) => (metres / 1000) * VEXAG;
export const LAKE_LEVEL = { 'Sea of Galilee': -210, 'Dead Sea': -430 };   // metres, real

const noise = noise2(2024);
const D2R = Math.PI / 180;
const gauss = (d, w) => Math.exp(-(d * d) / (w * w));
// isotropic degrees: longitude shrinks by cos(lat) at Israel's latitude
const KLON = Math.cos(31.8 * D2R);

function segDist(lon, lat, a, b) {
  const ax = a[0] * KLON, az = a[1], bx = b[0] * KLON, bz = b[1], px = lon * KLON, pz = lat;
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp01(((px - ax) * dx + (pz - az) * dz) / l2);
  return { d: Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t };
}
const ridge = (lon, lat, a, b, w, h) => h * gauss(segDist(lon, lat, a, b).d, w);
const blob = (lon, lat, c, rx, ry, h) => h * Math.exp(-(((lon - c[0]) * KLON) ** 2) / (rx * rx) - ((lat - c[1]) ** 2) / (ry * ry));

// The Jordan Rift: a trough whose floor follows the real levels down the valley.
const RIFT = [
  [[35.62, 33.20], 70], [[35.58, 32.88], -210], [[35.56, 32.70], -210], [[35.55, 32.45], -240],
  [[35.50, 31.95], -300], [[35.47, 31.60], -430], [[35.40, 31.05], -430], [[35.22, 30.60], -120],
  [[35.06, 30.05], 120], [[34.96, 29.56], 0],
];

/** Height in metres above sea level at a geographic point. */
export function reliefMetres(lon, lat) {
  // coastal plain, rising gently inland
  let h = 20 + 100 * smooth((lon - 34.72) / 0.40);
  // Carmel
  h += ridge(lon, lat, [34.98, 32.83], [35.13, 32.55], 0.05, 450);
  // Galilee: upper (Meron), lower, Tabor
  h += blob(lon, lat, [35.34, 33.02], 0.26, 0.19, 820) + blob(lon, lat, [35.30, 32.78], 0.24, 0.13, 380) + blob(lon, lat, [35.39, 32.687], 0.03, 0.03, 380);
  // Golan plateau east of the Kinneret
  h += 800 * smooth((lon - 35.60) / 0.10) * smooth((lat - 32.55) / 0.10) * smooth((33.40 - lat) / 0.10);
  // Samaria and Judea spine, Hebron hills
  h += ridge(lon, lat, [35.27, 32.48], [35.22, 31.78], 0.16, 720) + ridge(lon, lat, [35.22, 31.78], [35.10, 31.28], 0.14, 820);
  // Shephelah foothills
  h += ridge(lon, lat, [34.96, 32.05], [34.92, 31.45], 0.11, 200);
  // Negev highlands and the Ramon crater (a long ellipse, dropped 350 m)
  h += blob(lon, lat, [34.88, 30.72], 0.36, 0.42, 720) + blob(lon, lat, [35.05, 30.98], 0.20, 0.15, 220);
  { const ex = ((lon - 34.86) * KLON) * Math.cos(-0.35) - (lat - 30.60) * Math.sin(-0.35);
    const ey = ((lon - 34.86) * KLON) * Math.sin(-0.35) + (lat - 30.60) * Math.cos(-0.35);
    const r = Math.hypot(ex / 0.30, ey / 0.075);
    h -= 350 * (1 - smooth((r - 0.85) / 0.25)); }
  // Eilat mountains, Sinai edge, Jordan and Lebanon highlands beyond the borders
  h += blob(lon, lat, [34.90, 29.62], 0.10, 0.16, 680) + blob(lon, lat, [34.76, 29.78], 0.12, 0.12, 520);
  h += blob(lon, lat, [34.45, 29.85], 0.30, 0.35, 650);
  h += ridge(lon, lat, [35.78, 32.55], [35.72, 30.25], 0.28, 950) + ridge(lon, lat, [35.90, 33.3], [35.85, 32.6], 0.25, 700);
  h += blob(lon, lat, [35.55, 33.50], 0.30, 0.16, 700);
  // the rift replaces whatever is there with its own floor
  let best = { d: 1e9, level: 0 };
  for (let i = 0; i + 1 < RIFT.length; i++) {
    const { d, t } = segDist(lon, lat, RIFT[i][0], RIFT[i + 1][0]);
    if (d < best.d) best = { d, level: RIFT[i][1] + (RIFT[i + 1][1] - RIFT[i][1]) * t };
  }
  // the trough is narrower where the Dead Sea escarpments are
  const width = 0.085 - 0.03 * gauss(lat - 31.45, 0.35);
  const w = gauss(best.d, width);
  h = h * (1 - w) + best.level * w;
  // texture
  h += (fbm(noise, lon * 30, lat * 30, 4) - 0.5) * (0.10 * Math.abs(h) + 40);
  return Math.min(h, 1450);
}

/* ------------------------------------------------------------------ mesh */

export function createTerrain(world, opts = {}) {
  const cellKm = opts.cellKm ?? 0.75;
  const mask = makeMask(world);
  const P = makeProjection(world.proj);
  const { bbox } = world;
  const [x0, zN] = P.toXZ(bbox.lon0, bbox.lat1);
  const [x1, zS] = P.toXZ(bbox.lon1, bbox.lat0);
  const W = x1 - x0, D = zS - zN;
  const nx = Math.round(W / cellKm), nz = Math.round(D / cellKm);

  // distance fields on the mask grid: to the open sea (beaches), to land (sea depth)
  const isWater = (k) => mask.ids[k] === 0 || mask.lake[k] !== 0;
  const toOcean = distanceTransform(mask, (k) => mask.ids[k] === 0);
  const toLand = distanceTransform(mask, (k) => !isWater(k));
  // distance to the core (Israel with the West Bank and Gaza): the neighbours are
  // shown for context, then sink into the sea, so the map stands as an island
  const psxId = world.mask.countries.findIndex((c) => c.a3 === 'PSX') + 1;
  const isCore = (k) => mask.ids[k] === mask.israelId || mask.ids[k] === psxId;
  const toCore = distanceTransform(mask, isCore);
  const FADE0 = 12, FADE1 = 32;                     // km beyond the border
  // one distance field per lake, so shores can ramp down smoothly to the water
  const lakeFields = world.lakes.map((lake, li) => ({
    level: LAKE_LEVEL[lake.name_en] ?? 0,
    dist: distanceTransform(mask, (k) => mask.lake[k] === li + 1),
  }));

  const geo = new THREE.PlaneGeometry(W, D, nx, nz);
  geo.rotateX(-Math.PI / 2);                        // lie flat: +x east, +z south
  geo.translate((x0 + x1) / 2, 0, (zN + zS) / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const heights = new Float32Array(pos.count);
  const tint = new THREE.Color();                   // converts sRGB hex to linear for the attribute

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const [lon, lat] = P.toLonLat(x, z);
    const country = mask.country(x, z), lake = mask.lakeId(x, z);
    const dOcean = sampleField(mask, toOcean, x, z), dLand = sampleField(mask, toLand, x, z);
    let m;                                            // metres
    let colour;
    if (country === 0) {
      // sea: shelve from the beach down to a deep floor
      m = -15 - 900 * smooth(dLand / 10);
      colour = mixHex(C.seaShallow, C.seaFloor, smooth(dLand / 6));
    } else if (lake) {
      const name = world.lakes[lake - 1]?.name_en || '';
      const level = LAKE_LEVEL[name] ?? 0;
      m = level - 25 - 90 * smooth(dLand / 2.5);
      colour = C.lakeFloor;
    } else {
      m = reliefMetres(lon, lat);
      // lake shores: the land settles to the water level over the last 2 km
      for (const lf of lakeFields) {
        const dl = sampleField(mask, lf.dist, x, z);
        if (dl < 2.5) { const t = smooth(dl / 2.5); m = m * t + (lf.level + 6) * (1 - t); }
      }
      // beaches: along the open coast the land comes down to the water over 3 km
      // and never dips below it; inland (the rift) it goes as deep as it likes
      const beach = 1 - smooth((dOcean - 0.3) / 3);
      m = m * (1 - beach) + 6 * beach;
      if (dOcean < 4) m = Math.max(m, 4);
      colour = biomeColour(lon, lat, m, dOcean, country === mask.israelId);
      // beyond the neighbours' margin the land sinks away
      const dIsr = sampleField(mask, toCore, x, z);
      if (dIsr > FADE0) {
        const f = smooth((dIsr - FADE0) / (FADE1 - FADE0));
        m = m * (1 - f) + (-400) * f;
        colour = mixHex(colour, C.seaFloor, smooth(f * 1.6));
      }
    }
    heights[i] = m;
    pos.setY(i, yOf(m));
    tint.setHex(colour);
    const k = fbm(noise, lon * 90, lat * 90, 2) * 0.16 + 0.92;   // fine tonal grain
    col[i * 3] = tint.r * k; col[i * 3 + 1] = tint.g * k; col[i * 3 + 2] = tint.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();

  const normalMap = groundNormal();
  normalMap.repeat.set(W / 2.8, D / 2.8);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, metalness: 0.0,
    normalMap, normalScale: new THREE.Vector2(0.32, 0.32),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.castShadow = true;
  mesh.name = 'terrain';

  /** ground height (world y) at x, z by bilinear lookup of the vertex grid */
  const heightAt = (x, z) => {
    const fx = ((x - x0) / W) * nx, fz = ((z - zN) / D) * nz;
    const ix = Math.max(0, Math.min(nx - 1, Math.floor(fx))), iz = Math.max(0, Math.min(nz - 1, Math.floor(fz)));
    const tx = clamp01(fx - ix), tz = clamp01(fz - iz);
    const row = nx + 1;
    const a = heights[iz * row + ix], b = heights[iz * row + ix + 1], c = heights[(iz + 1) * row + ix], d = heights[(iz + 1) * row + ix + 1];
    return yOf((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz);
  };

  return { mesh, heightAt, mask, P, bounds: { x0, x1, zN, zS, W, D }, toLand, toOcean, toCore, FADE1 };
}

/* --------------------------------------------------------------- biomes */

function biomeColour(lon, lat, m, dWater, israel) {
  // latitude bands: green north, golden centre, tan south, red far south
  const north = smooth((lat - 32.35) / 0.25);
  const centre = smooth((lat - 31.55) / 0.25) * (1 - north);
  const negev = (1 - smooth((lat - 31.15) / 0.30));
  const deepSouth = 1 - smooth((lat - 30.15) / 0.35);
  const eilat = 1 - smooth((lat - 29.75) / 0.22);
  const rift = gauss(((lon - 35.50) * KLON), 0.10) * smooth((lat - 30.4) / 0.2);
  const east = smooth((lon - 35.32) / 0.12);          // Judean desert side

  let c = mixHex(C.plain, C.galilee, north);
  c = mixHex(c, C.judea, centre * smooth((m - 250) / 300));
  c = mixHex(c, C.olive, north * (1 - east) * smooth((m - 300) / 400) * 0.5);
  c = mixHex(c, C.judeanDesert, centre * east * smooth((31.95 - lat) / 0.3));
  c = mixHex(c, C.negev, negev);
  c = mixHex(c, C.negevSouth, deepSouth);
  c = mixHex(c, C.eilat, eilat * smooth((m - 150) / 300));
  c = mixHex(c, C.arava, rift * (1 - north) * (1 - eilat));
  // relief: forests on the wetter northern hills, pale stone on the high ground
  c = mixHex(c, C.forest, north * smooth((m - 350) / 400) * 0.8);
  c = mixHex(c, C.golan, smooth((lon - 35.62) / 0.08) * north);
  c = mixHex(c, C.stone, smooth((m - 550) / 500) * (1 - north) * 0.55);
  c = mixHex(c, C.ramon, deepSouth * smooth((m - 500) / 350) * 0.6);
  // beaches and dunes
  c = mixHex(c, C.sand, 1 - smooth((dWater - 0.4) / 1.6));
  // fields in the Sharon and the northern Negev, hinted by noise patches
  const patch = fbm(noise, lon * 55 + 7, lat * 55, 2);
  c = mixHex(c, C.fields, (patch > 0.6 ? 0.55 : 0) * centre * (1 - east));
  if (!israel) c = mixHex(c, C.abroad, 0.55);
  return c;
}
