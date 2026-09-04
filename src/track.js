import * as THREE from 'three';
import { C } from './palette.js';
import { LOOP, ZONES } from './layout.js';

/** A polyline/arc path on the XZ plane with arc-length lookup. */
export class Path2 {
  constructor(segs) {
    this.segs = segs;
    let L = 0;
    for (const s of segs) { s.s0 = L; L += s.len; }
    this.length = L;
  }
  /** distance -> { x, z, tx, tz } (tangent is unit) */
  at(d) {
    d = ((d % this.length) + this.length) % this.length;
    for (const s of this.segs) {
      if (d <= s.s0 + s.len || s === this.segs[this.segs.length - 1]) {
        const t = d - s.s0;
        if (s.type === 'line') {
          const ux = (s.x2 - s.x1) / s.len, uz = (s.z2 - s.z1) / s.len;
          return { x: s.x1 + ux * t, z: s.z1 + uz * t, tx: ux, tz: uz };
        }
        const a = s.a1 + (s.a2 - s.a1) * (t / s.len);
        const dir = s.a2 > s.a1 ? 1 : -1;
        return {
          x: s.cx + s.r * Math.cos(a), z: s.cz + s.r * Math.sin(a),
          tx: -Math.sin(a) * dir, tz: Math.cos(a) * dir,
        };
      }
    }
  }
  /** shortest distance from a point to the centreline (approximate, dense sample) */
  distanceTo(x, z, samples = 900) {
    let best = Infinity;
    for (let i = 0; i < samples; i++) {
      const p = this.at((i / samples) * this.length);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < best) best = d;
    }
    return best;
  }
}

export function line(x1, z1, x2, z2) {
  return { type: 'line', x1, z1, x2, z2, len: Math.hypot(x2 - x1, z2 - z1) };
}
export function arc(cx, cz, r, a1, a2) {
  return { type: 'arc', cx, cz, r, a1, a2, len: Math.abs(a2 - a1) * r };
}

const HP = Math.PI / 2;

/** The main running line, clockwise seen from above. */
export function mainLine() {
  const { halfX, r, cz, zFront, zBack } = LOOP;
  return new Path2([
    line(-halfX, zFront, halfX, zFront),
    arc(halfX, cz, r, HP, -HP),
    line(halfX, zBack, -halfX, zBack),
    arc(-halfX, cz, r, -HP, -3 * HP),
  ]);
}

/** Straight yard sidings (used for parked stock and the overlap check). */
export function sidings() {
  return ZONES.sidings.map((z) => new Path2([line(ZONES.sidingX0, z, ZONES.sidingX1, z)]));
}

/**
 * Emits ballast, sleepers and rails for a path into a VoxelBuilder.
 * `opts.ballast` false gives bare yard track.
 */
export function buildTrack(vb, path, opts = {}) {
  const half = opts.ballastHalf ?? LOOP.ballastHalf;
  const gauge = LOOP.gauge;
  const skipTunnel = opts.skipTunnel;
  const inTunnel = (p) => skipTunnel && p.x < ZONES.tunnelX;

  // Coarse pass: ballast bed and the continuous rails. Long segments here keep
  // the triangle count sane; only the sleepers need a fine pitch.
  const coarse = opts.coarseStep ?? 0.048;
  const nc = Math.max(6, Math.round(path.length / coarse));
  const segC = path.length / nc;
  for (let i = 0; i < nc; i++) {
    const p = path.at((i + 0.5) * segC);
    if (inTunnel(p)) continue;
    const rot = Math.atan2(p.tx, p.tz);
    if (opts.ballast !== false) {
      vb.box(p.x, 0.0045, p.z, half * 2, 0.009, segC * 1.06,
        i % 4 === 0 ? C.ballastDk : C.ballast, { rotY: rot, jitter: 0.11 });
      vb.box(p.x, 0.0092, p.z, half * 1.35, 0.002, segC * 1.06, C.ballastDk,
        { rotY: rot, jitter: 0.10 });
    }
    const nx = -p.tz, nz = p.tx;
    for (const s of [-1, 1]) {
      vb.box(p.x + nx * s * gauge, LOOP.railTopY - 0.0025, p.z + nz * s * gauge,
        0.0032, 0.005, segC * 1.04, C.rail, { rotY: rot, jitter: 0.03 });
    }
  }

  // Fine pass: sleepers.
  const pitch = opts.step ?? 0.0135;
  const ns = Math.max(8, Math.round(path.length / pitch));
  for (let i = 0; i < ns; i++) {
    const p = path.at((i + 0.5) * (path.length / ns));
    if (inTunnel(p)) continue;
    vb.box(p.x, 0.0095, p.z, 0.030, 0.0030, 0.0060, C.sleeper,
      { rotY: Math.atan2(p.tx, p.tz), jitter: 0.16 });
  }
}

/** Buffer stop at the end of a siding. */
export function bufferStop(vb, x, z, dirX) {
  vb.box(x, 0.0155, z, 0.012, 0.013, 0.032, C.sleeper, { jitter: 0.08 });
  vb.box(x + 0.007 * dirX, 0.023, z, 0.006, 0.010, 0.034, C.signalRed);
}

export { LOOP };
