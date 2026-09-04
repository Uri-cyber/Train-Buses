/**
 * Colour palette for a stylised, sunlit Israel. Saturated but not garish;
 * the tone mapping and bloom in post.js take the edge off.
 */
export const C = {
  // water
  seaDeep: 0x0d4a70, seaMid: 0x1d7e9f, seaShallow: 0x52c1cf, foam: 0xeaf7f8,
  kinneret: 0x2f8ab0, deadSea: 0x63bcc8, redSea: 0x1b93a8,

  // land, north to south
  sand: 0xead9ab, dune: 0xe2cf9c,
  plain: 0x9cb85a, fields: 0xb8c66c, sharon: 0x8db354, carmel: 0x5f8f44,
  galilee: 0x6c9c4a, forest: 0x3f7442, golan: 0x707c48, olive: 0x8f9c60,
  hills: 0xb9aa7a, stone: 0xe3d5b4, shephelah: 0xc6ba8b, judea: 0xc9b184,
  judeanDesert: 0xdbbb8c, negev: 0xdec59a, negevSouth: 0xd1a878, ramon: 0xb8825a,
  arava: 0xe7d2a2, eilat: 0xb45f3e, sinai: 0xd9b98b, jordan: 0xcdb48c, lebanon: 0x8fa564,
  seaFloor: 0x0a3a56, lakeFloor: 0x1a4f5e,
  abroad: 0xd6cbb2,           // neighbours are drawn paler so Israel reads

  // built things
  stucco: 0xf4f0e6, stoneWall: 0xe6d8b8, stoneDark: 0xcdbb95, roofFlat: 0xdad3c4, roofTile: 0xb8563a,
  solar: 0x22344d, heater: 0xf2f0ea, glass: 0x7fb6d6, concrete: 0xc9c3b6, asphalt: 0x575c62,
  roadLine: 0xf1eadb, ballast: 0xbdb6a8, rail: 0x9aa0a6, sleeper: 0xd2cdc2, platform: 0xd9d2c3,

  // Israel Railways and street livery
  irBlue: 0x1d4f9c, irRed: 0xd0342c, irWhite: 0xf3f3f1, irGrey: 0x8f959c,
  steamBlack: 0x23272b, steamGreen: 0x2f5f45, brass: 0xd4a83a, woodCoach: 0x8a5a34,
  potash: 0x9aa1a3, container: [0x2f6fae, 0xc94a3b, 0xe0b23a, 0x3f8f5f, 0xe8e6df],
  eggedGreen: 0x1f8a4c, danBlue: 0x2a63b8, carWhite: 0xf2f2ee, carGrey: 0x9ea3a8, taxi: 0xf5f3ee,

  // sky
  zenithDay: 0x3f8fd8, horizonDay: 0xcfe6f6, zenithDusk: 0x2b3f7a, horizonDusk: 0xf6a35a,
  zenithNight: 0x050b18, horizonNight: 0x0e1c33, sun: 0xfff2d0, moon: 0xe8ecf5,
  windowLit: 0xffd48a, streetLamp: 0xffe0a0,
};

const _tmp = [0, 0, 0];
export function hexToRgb(hex, out = _tmp) {
  out[0] = ((hex >> 16) & 255) / 255; out[1] = ((hex >> 8) & 255) / 255; out[2] = (hex & 255) / 255;
  return out;
}
export function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
