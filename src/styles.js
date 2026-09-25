import { C, mixHex } from './palette.js';
import { GRADIENT } from './builder.js';

/**
 * Looks for the world, chosen with ?style=. A preset rewrites the palette before anything
 * is built (the terrain bakes its colours into vertices), then tunes the toon steps and the
 * post chain once those exist. The default look is 'sunlit', which is the palette as written.
 */
export const STYLES = {
  sunlit: {},

  // A paper model on a table: matte, warm, pale, with a heavy brown pen line and only two
  // tones of shading, the way card looks under a desk lamp.
  diorama: {
    palette: {
      plain: 0xb9cf8c, fields: 0xd8d99a, sharon: 0xafc98a, carmel: 0x8fa77a, galilee: 0x9dbb84, forest: 0x6f8f6a,
      golan: 0xa3a586, olive: 0xb3b58f, hills: 0xd2c7a6, stone: 0xe6dcc6, shephelah: 0xd9cfae, judea: 0xc0bd9a,
      judeanDesert: 0xe8d2ac, negev: 0xecd6b0, negevSouth: 0xdfc4a2, ramon: 0xcfa98a, arava: 0xeadcbb, eilat: 0xc9967c,
      sand: 0xf3e6c4, dune: 0xe9dab8, abroad: 0xe4dccb, sinai: 0xe3d2b2, jordan: 0xdccdb0, lebanon: 0xb4bf96,
      seaDeep: 0x6f9fb8, seaMid: 0x8fbccf, seaShallow: 0xb9dbe4, foam: 0xfaf8f2, kinneret: 0x8fb9cc, deadSea: 0x9dc2d2, redSea: 0x86b3c8,
      seaFloor: 0x5f8aa2, lakeFloor: 0x6d93a6,
      zenithDay: 0x9fc0dc, horizonDay: 0xefe6d6,
      roofTile: 0xc98a72, asphalt: 0x8a8580, ballast: 0xd3ccbd, rail: 0xa79f94,
      trainBlue: 0x5f8fc7, trainRed: 0xe0806a,
    },
    gradient: [140, 140, 140, 255, 235, 235, 235, 255, 255, 255, 255, 255],
    edge: { color: [0.30, 0.20, 0.14], width: 2.0, strength: 1.0 },
    bloom: 0.25, tilt: 1.35, exposure: 1.05,
  },

  // A living circuit board: the country is dark glass, the lines are lit, everything that
  // moves glows. Day looks like the blue hour on purpose; this style is about the trains.
  neon: {
    palette: {
      plain: 0x18304a, fields: 0x1c3652, sharon: 0x17304a, carmel: 0x162a44, galilee: 0x183350, forest: 0x12263c,
      golan: 0x1b2f46, olive: 0x1d3148, hills: 0x243650, stone: 0x2b3d58, shephelah: 0x263a54, judea: 0x223650,
      judeanDesert: 0x2e3c56, negev: 0x2c3a54, negevSouth: 0x283650, ramon: 0x2a3450, arava: 0x2d3b54, eilat: 0x33364f,
      sand: 0x30405a, dune: 0x2d3c56, abroad: 0x1a2436, sinai: 0x27334b, jordan: 0x25334c, lebanon: 0x1d3048,
      seaDeep: 0x050d1c, seaMid: 0x071528, seaShallow: 0x0c2240, foam: 0x35e6ff, kinneret: 0x0b2038, deadSea: 0x0d2340, redSea: 0x0a1f3a,
      seaFloor: 0x040a16, lakeFloor: 0x06101e,
      zenithDay: 0x061226, horizonDay: 0x18305a, zenithDusk: 0x0a1633, horizonDusk: 0xff6a7a, sun: 0xdde8ff,
      stucco: 0x2a3550, stoneWall: 0x2e3a56, stoneDark: 0x27324c, roofFlat: 0x33405c, roofTile: 0x5a3a62, concrete: 0x2f3a54,
      asphalt: 0x1f2a42, roadLine: 0x35e6ff, ballast: 0x263452, rail: 0x7fe9ff, sleeper: 0x2b3a58, platform: 0x33436a, glass: 0x8ff7ff,
      trainBlue: 0x35c8ff, trainRed: 0xff4f9a, trainWhite: 0xeafcff, trainGrey: 0x6c7fa6,
      windowLit: 0xfff1a8, streetLamp: 0xffd36e,
    },
    gradient: [70, 70, 70, 255, 130, 130, 130, 255, 255, 255, 255, 255],
    edge: { color: [0.25, 0.90, 1.0], width: 1.0, strength: 0.7 },
    bloom: 2.4, bloomThreshold: -0.30, tilt: 0.8, exposure: 0.95,
    hemiGround: 0x101a2e, sunTint: 0xbfd4ff,
  },

  // A 1950s travel poster: five inks, no pen line, flat hard light, and the land drawn in
  // two colours only, ochre and green, so the sea and the trains carry the picture.
  poster: {
    palette: {
      plain: 0x4f9a5a, fields: 0x63a85f, sharon: 0x4f9a5a, carmel: 0x3f7f4c, galilee: 0x4f9a5a, forest: 0x3f7f4c,
      golan: 0x8aa062, olive: 0x8aa062, hills: 0xe0a85a, stone: 0xe7b566, shephelah: 0xe0a85a, judea: 0xd99a4e,
      judeanDesert: 0xe7b566, negev: 0xe7b566, negevSouth: 0xd99a4e, ramon: 0xc9843f, arava: 0xe7b566, eilat: 0xc9843f,
      sand: 0xf2d38a, dune: 0xe7b566, abroad: 0xe9d9a8, sinai: 0xe7b566, jordan: 0xe0a85a, lebanon: 0x8aa062,
      seaDeep: 0x0f5e78, seaMid: 0x16809b, seaShallow: 0x2aa6bb, foam: 0xfff5dc, kinneret: 0x16809b, deadSea: 0x2aa6bb, redSea: 0x16809b,
      seaFloor: 0x0c4a60, lakeFloor: 0x10586e,
      zenithDay: 0x1f6f9c, horizonDay: 0xf6e3b8, horizonDusk: 0xf08a3c,
      stucco: 0xfff3dc, stoneWall: 0xf6e3b8, stoneDark: 0xe0a85a, roofFlat: 0xf6e3b8, roofTile: 0xd8443a, concrete: 0xf0dcb0,
      asphalt: 0x3b3a44, roadLine: 0xfff5dc, ballast: 0xd4b27a, rail: 0x3b3a44, sleeper: 0xc9843f, platform: 0xf6e3b8,
      trainBlue: 0x1f4f8c, trainRed: 0xd8443a, trainWhite: 0xfff5dc, trainGrey: 0x3b3a44,
      eggedGreen: 0x3f7f4c, danBlue: 0x1f4f8c, carWhite: 0xfff5dc, taxi: 0xf2d38a,
    },
    gradient: [120, 120, 120, 255, 255, 255, 255, 255, 255, 255, 255, 255],
    edge: { strength: 0 },
    bloom: 0, tilt: 0.9, exposure: 1.08, hemiGround: 0xe0a85a,
  },
};

export function pickStyle(params) {
  const name = params.get('style');
  return STYLES[name] ? name : 'sunlit';
}

/** call before the world is built: rewrites the palette in place */
export function applyPalette(name) {
  const s = STYLES[name];
  if (!s?.palette) return;
  Object.assign(C, s.palette);
  if (s.gradient) { GRADIENT.image.data.set(s.gradient); GRADIENT.needsUpdate = true; }
}

/** call once post and lighting exist */
export function applyLook(name, { post, lights, renderer }) {
  const s = STYLES[name] || {};
  if (s.edge) {
    const u = post.edge.uniforms;
    if (s.edge.color) u.lineColor.value.setRGB(...s.edge.color);
    if (s.edge.width !== undefined) u.width.value = s.edge.width;
    if (s.edge.strength !== undefined) u.strength.value = s.edge.strength;
  }
  post.style.bloom = s.bloom ?? 1;
  post.style.bloomThreshold = s.bloomThreshold ?? 0;
  post.style.tilt = s.tilt ?? 1;
  post.style.exposure = s.exposure ?? 1;
  lights.style.ground = s.hemiGround ?? null;
  lights.style.sunTint = s.sunTint ?? null;
}
