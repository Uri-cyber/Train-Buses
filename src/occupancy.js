// Footprints of every solid thing placed on the baseboard, recorded at build
// time so that scripts/overlap-check.mjs can prove nothing intersects.
export const SOLIDS = [];
export function reg(kind, name, x0, x1, z0, z1, y0 = 0, y1 = 0.1) {
  SOLIDS.push({ kind, name, x0, x1, z0, z1, y0, y1 });
}
export function resetSolids() { SOLIDS.length = 0; }

/** deterministic RNG so layouts (and screenshots) are reproducible */
export function rng(seed = 1337) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
