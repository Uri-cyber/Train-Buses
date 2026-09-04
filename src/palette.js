// Central colour palette. Muted, slightly desaturated "model-maker" tones so
// that the strong directional sunlight does not blow anything out.
export const C = {
  // room
  floor:      0x6b5a4a,
  rug:        0x7d5b52,
  wallLower:  0xa8a394,
  wallUpper:  0xcfcabd,
  skirting:   0xe6e0d4,
  ceiling:    0xf0ece2,
  windowFrm:  0xe8e2d6,

  // table
  tableTop:   0xa9773f,
  tableEdge:  0x7a5230,
  tableLeg:   0x6b4526,

  // baseboard / ground
  grass:      0x6f8f4a,
  grassDark:  0x688747,
  grassLight: 0x789750,
  dirt:       0x9a7d55,
  rock:       0x9c9488,
  rockDark:   0x827a6d,

  // track
  ballast:    0x9b9287,
  ballastDk:  0x847c72,
  sleeper:    0x50412f,
  rail:       0xb9bcc2,

  // water
  waterDeep:  0x1d4d63,
  waterShall: 0x2f7f96,
  foam:       0xdcecef,

  // structures
  brick:      0xa2564a,
  brickDark:  0x86443b,
  plaster:    0xe3d9c6,
  timber:     0x7b5636,
  roofTile:   0x8c4a3f,
  roofSlate:  0x4e565e,
  roofGreen:  0x4a6b55,
  concrete:   0xbdb7ac,
  concreteDk: 0x9a948a,
  steel:      0x8f98a2,
  steelDark:  0x5d666f,
  quay:       0xa9a396,

  // accents
  signalRed:  0xc0392b,
  loco:       0x1e5a3a,
  locoTrim:   0xc9a227,
  coach:      0x8c2f2f,
  coachTrim:  0xe7d9a8,
  freightA:   0x6d4c33,
  freightB:   0x3d5a70,
  freightC:   0x7a6a45,
  hull:       0x8c2f2f,
  hullDark:   0x5f2020,
  superstr:   0xe8e4da,
  crane:      0xd08a2a,
  road:       0x4a4a4c,
  roadLine:   0xd9d3bd,
  pavement:   0xb2ada1,
  treeTrunk:  0x5c4630,
  leafA:      0x4e7a3c,
  leafB:      0x3f6a34,
  leafC:      0x648a44,
  window:     0x2b3440,
  windowLit:  0xffd08a,
  desk:       0x4a3b2c,
  deskTop:    0x2f2620,
  brass:      0xc9a227,
};

// Small helper: jitter a hex colour a little so large merged surfaces do not
// look like flat plastic.
export function shade(hex, amount) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amount))));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
