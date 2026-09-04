import { C } from './palette.js';
import { BOARD, LOOP, ZONES } from './layout.js';
import { reg, rng, SOLIDS } from './occupancy.js';
import { Path2, line, mainLine, sidings, buildTrack, bufferStop } from './track.js';

const R = rng(20240917);
const rand = (a, b) => a + R() * (b - a);
const pick = (arr) => arr[Math.floor(R() * arr.length) % arr.length];

/* ------------------------------------------------------------------ ground */

function ground(vb) {
  const { x0, x1, z0, z1 } = BOARD;
  // Grass laid as coarse tiles with varied tone: still one merged mesh.
  const n = 30, m = 18;
  const tw = (x1 - x0) / n, td = (z1 - z0) / m;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const x = x0 + (i + 0.5) * tw, z = z0 + (j + 0.5) * td;
      const r = R();
      const c = r < 0.16 ? C.grassDark : r < 0.34 ? C.grassLight : C.grass;
      vb.box(x, 0.0035, z, tw * 1.02, 0.007, td * 1.02, c, { jitter: 0.06 });
    }
  }
}

/* ------------------------------------------------------------- hill/tunnel */

/** Height of the hillside at (x, z); 0 outside the hill footprint. */
export function hillHeight(x, z) {
  const H = ZONES.hill;
  const cx = (H.x0 + H.x1) / 2, cz = (H.z0 + H.z1) / 2;
  const rx = (H.x1 - H.x0) / 2, rz = (H.z1 - H.z0) / 2;
  const u = (x - cx) / rx, v = (z - cz) / rz;
  const r2 = u * u + v * v;
  if (r2 > 1) return 0;
  return 0.215 * Math.pow(1 - r2, 0.8) + 0.012;
}

function hill(vb, track) {
  const H = ZONES.hill;
  const cx = (H.x0 + H.x1) / 2, cz = (H.z0 + H.z1) / 2;
  const rx = (H.x1 - H.x0) / 2, rz = (H.z1 - H.z0) / 2;
  const step = 0.034;
  const BORE_R = 0.055;         // clearance around the centreline
  const BORE_H = 0.070;         // top of the loading gauge
  for (let x = H.x0; x < H.x1; x += step) {
    for (let z = H.z0; z < H.z1; z += step) {
      const px = x + step / 2, pz = z + step / 2;
      const u = (px - cx) / rx, v = (pz - cz) / rz;
      const r2 = u * u + v * v;
      if (r2 > 1) continue;
      let h = 0.215 * Math.pow(1 - r2, 0.8) + 0.012;
      h += (R() - 0.5) * 0.012;
      const dTrack = track.distanceTo(px, pz, 420);
      if (dTrack < BORE_R) {
        // carve the bore: keep only the rock above the loading gauge
        if (h <= BORE_H) continue;
        vb.box(px, BORE_H + (h - BORE_H) / 2, pz, step * 1.05, h - BORE_H, step * 1.05,
          R() < 0.3 ? C.rock : C.rockDark, { jitter: 0.12 });
        continue;
      }
      const c = h > 0.185 ? (R() < 0.45 ? C.rock : C.rockDark)
        : R() < 0.28 ? C.grassDark : R() < 0.55 ? C.grass : C.grassLight;
      vb.box(px, h / 2, pz, step * 1.05, h, step * 1.05, c, { jitter: 0.13 });
    }
  }
  reg('hill', 'hill', H.x0, H.x1, H.z0, H.z1, 0, 0.24);

  // stone portals, sized to the loading gauge rather than the hillside
  for (const d of portalDistances(track)) {
    const p = track.at(d);
    const rot = Math.atan2(p.tx, p.tz);
    const nx = -p.tz, nz = p.tx;
    // arch surround: two jambs plus a lintel, leaving the bore clear
    for (const sgn of [-1, 1]) {
      vb.box(p.x + nx * sgn * 0.062, 0.036, p.z + nz * sgn * 0.062, 0.030, 0.072, 0.024,
        C.rockDark, { rotY: rot, jitter: 0.08 });
    }
    vb.box(p.x, 0.080, p.z, 0.154, 0.020, 0.024, C.rockDark, { rotY: rot, jitter: 0.06 });
    vb.box(p.x, 0.094, p.z, 0.168, 0.010, 0.028, C.rock, { rotY: rot });
    // wing walls tapering back into the cutting
    for (const sgn of [-1, 1]) {
      vb.box(p.x + nx * sgn * 0.098 - p.tx * 0.030, 0.026,
        p.z + nz * sgn * 0.098 - p.tz * 0.030, 0.028, 0.052, 0.055,
        C.rockDark, { rotY: rot, jitter: 0.07 });
    }
  }
}

/** the two distances along the loop where it crosses the tunnel mouth plane */
function portalDistances(track) {
  const out = [];
  const N = 1400;
  let prev = track.at(0).x < ZONES.tunnelX;
  for (let i = 1; i <= N; i++) {
    const d = (i / N) * track.length;
    const inside = track.at(d).x < ZONES.tunnelX;
    if (inside !== prev) out.push(d);
    prev = inside;
  }
  return out;
}

/* ------------------------------------------------------------- structures */

/**
 * A grid of windows. Each pane is drawn twice: a dark sheet of glass in the
 * solid mesh (so daytime windows read as glass, not as glowing holes) and a
 * slightly smaller pane in the emissive mesh that lights up after dusk.
 */
function windowGrid(vb, lit, x, y, z, w, h, cols, rows, face, out = 1, glowCol = 0xffd08a) {
  const gw = w / cols, gh = h / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const px = x - w / 2 + (i + 0.5) * gw, py = y - h / 2 + (j + 0.5) * gh;
      const pw = gw * 0.55, ph = gh * 0.6;
      if (face === 'z') {
        vb.box(px, py, z, pw, ph, 0.004, C.window, { jitter: 0.10 });
        lit.box(px, py, z + out * 0.0015, pw * 0.86, ph * 0.86, 0.004, glowCol, { jitter: 0.10 });
      } else {
        vb.box(z, py, px, 0.004, ph, pw, C.window, { jitter: 0.10 });
        lit.box(z + out * 0.0015, py, px, 0.004, ph * 0.86, pw * 0.86, glowCol, { jitter: 0.10 });
      }
    }
  }
}

function station(vb, lit) {
  const S = ZONES.station;
  const cz = (S.z0 + S.z1) / 2, d = S.z1 - S.z0;
  const cxS = (S.x0 + S.x1) / 2, wS = S.x1 - S.x0;
  const PH = 0.022;                       // platform height: about a metre above the railhead

  vb.box(cxS, PH / 2, cz, wS, PH, d, C.concrete, { jitter: 0.05 });
  vb.box(cxS, PH + 0.002, S.z1 - 0.005, wS, 0.004, 0.010, C.concreteDk);
  vb.box(cxS, PH + 0.003, S.z1 - 0.014, wS, 0.003, 0.007, 0xd9b24a);   // safety line

  // station building, set back from the platform edge
  const bx = -0.44, bw = 0.26, bd = 0.085;
  const bz = S.z0 + bd / 2 + 0.010;
  const by = PH;
  vb.box(bx, by + 0.042, bz, bw, 0.084, bd, C.brick, { jitter: 0.06 });
  vb.box(bx, by + 0.087, bz, bw + 0.012, 0.006, bd + 0.012, C.roofSlate);
  vb.gable(bx, by + 0.090, bz, bw + 0.012, 0.030, bd + 0.012, C.roofSlate);
  windowGrid(vb, lit, bx, by + 0.052, bz + bd / 2 + 0.002, 0.18, 0.032, 4, 1, 'z');
  vb.box(bx + 0.075, by + 0.024, bz + bd / 2 + 0.003, 0.024, 0.048, 0.006, C.timber);
  vb.cyl(bx - 0.085, by + 0.112, bz, 0.007, 0.028, C.brickDark, 6);

  // canopy over the platform, on slim posts clear of the loading gauge
  vb.box(bx + 0.03, by + 0.046, S.z1 - 0.036, 0.36, 0.004, 0.052, C.roofSlate);
  vb.box(bx + 0.03, by + 0.043, S.z1 - 0.011, 0.36, 0.006, 0.004, C.roofSlate); // valance
  for (const px of [bx - 0.14, bx + 0.03, bx + 0.19]) {
    vb.cyl(px, by + 0.022, S.z1 - 0.030, 0.0028, 0.044, C.steelDark, 6);
  }
  // benches, a barrow and a name board
  for (const px of [-0.12, -0.05, 0.02]) {
    vb.box(px, PH + 0.007, S.z1 - 0.048, 0.030, 0.003, 0.009, C.timber);
    vb.box(px, PH + 0.005, S.z1 - 0.052, 0.030, 0.009, 0.003, C.timber);
  }
  vb.box(-0.30, PH + 0.008, S.z0 + 0.026, 0.026, 0.016, 0.012, 0x6f4a3a, { jitter: 0.1 });
  vb.box(-0.20, PH + 0.020, S.z0 + 0.016, 0.055, 0.011, 0.003, C.plaster);
  for (const px of [-0.225, -0.175]) vb.cyl(px, PH + 0.008, S.z0 + 0.016, 0.0022, 0.016, C.steelDark, 5);

  reg('building', 'station', S.x0, S.x1, S.z0, S.z1, 0, 0.16);
  return { lampSpots: [] };
}

function engineShed(vb, lit) {
  const S = ZONES.shed;
  const cx = (S.x0 + S.x1) / 2, cz = (S.z0 + S.z1) / 2;
  const w = S.x1 - S.x0, d = S.z1 - S.z0;
  vb.box(cx, 0.005, cz, w, 0.010, d, C.concreteDk);
  vb.box(cx, 0.010 + 0.085, cz, w, 0.17, d, C.brick, { jitter: 0.06 });
  vb.gable(cx, 0.180, cz, w + 0.02, 0.06, d + 0.02, C.roofSlate);
  windowGrid(vb, lit, cx, 0.14, S.z0 - 0.002, w * 0.7, 0.045, 5, 1, 'z', -1);
  // two arched doorways facing the turntable
  for (const ox of [-0.10, 0.10]) {   // doorways face the turntable
    vb.box(cx + ox, 0.048, S.z1 + 0.003, 0.062, 0.095, 0.008, 0x2a2018);
  }
  for (const ox of [-0.19, 0, 0.19]) vb.cyl(cx + ox, 0.225, cz - 0.03, 0.010, 0.04, C.brickDark, 6);
  reg('building', 'engine-shed', S.x0, S.x1, S.z0, S.z1, 0, 0.24);
}

function turntable(vb) {
  const T = ZONES.turntable;
  // pit
  vb.cyl(T.cx, 0.006, T.cz, T.r, 0.012, C.concreteDk, 20);
  vb.cyl(T.cx, 0.014, T.cz, T.r - 0.012, 0.014, 0x3b3630, 20);
  // ring wall
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    vb.box(T.cx + Math.cos(a) * T.r, 0.011, T.cz + Math.sin(a) * T.r, 0.020, 0.013, 0.016,
      C.concrete, { rotY: -a, jitter: 0.07 });
  }
  reg('trackwork', 'turntable', T.cx - T.r, T.cx + T.r, T.cz - T.r, T.cz + T.r, 0, 0.05);
}

function factory(vb, lit) {
  const F = ZONES.factory;
  const cz = (F.z0 + F.z1) / 2, d = F.z1 - F.z0;
  // main hall
  vb.box(-0.72, 0.005, cz, 0.56, 0.010, d, C.concreteDk);
  vb.box(-0.72, 0.115, cz, 0.54, 0.21, d - 0.03, C.brick, { jitter: 0.06 });
  // saw-tooth roof
  for (let i = 0; i < 4; i++) {
    const zz = F.z0 + 0.055 + i * 0.075;
    vb.box(-0.72, 0.228, zz, 0.54, 0.016, 0.050, C.roofSlate);
    vb.box(-0.72, 0.246, zz + 0.026, 0.50, 0.030, 0.006, C.window, { jitter: 0.08 });
    lit.box(-0.72, 0.244, zz + 0.0295, 0.46, 0.018, 0.004, 0x8fb6c8, { jitter: 0.08 });
  }
  windowGrid(vb, lit, -0.72, 0.13, F.z1 - 0.012, 0.44, 0.075, 6, 2, 'z');
  // annexe + chimney
  vb.box(-0.30, 0.085, cz + 0.03, 0.24, 0.17, 0.20, C.brickDark, { jitter: 0.06 });
  vb.box(-0.30, 0.178, cz + 0.03, 0.26, 0.016, 0.22, C.roofSlate);
  vb.cyl(-0.22, 0.24, F.z0 + 0.07, 0.026, 0.46, C.brickDark, 10, { rBottom: 0.034 });
  vb.cyl(-0.22, 0.472, F.z0 + 0.07, 0.028, 0.02, 0x4a3129, 10);
  // silos
  for (const ox of [0, 0.07]) {
    vb.cyl(-0.98 + ox * 0, 0.16, F.z1 - 0.06 - ox * 1.4, 0.045, 0.32, C.concrete, 12);
    vb.cyl(-0.98, 0.325, F.z1 - 0.06 - ox * 1.4, 0.048, 0.018, C.steelDark, 12);
  }
  // yard fence
  for (let x = F.x0 + 0.02; x < F.x1; x += 0.06) {
    vb.box(x, 0.028, F.z1 + 0.005, 0.008, 0.056, 0.008, C.steelDark);
  }
  reg('building', 'factory', F.x0, F.x1, F.z0, F.z1, 0, 0.5);
}

/* ---------------------------------------------------------------- harbour */

function harbour(vb, lit) {
  const H = ZONES.harbour;
  const qz0 = ZONES.waterZ1, qz1 = H.z1;      // quay strip, water is north of qz0
  const cxA = (H.x0 + H.x1) / 2;

  // quay deck and its coping stones
  vb.box(cxA, 0.017, (qz0 + qz1) / 2, H.x1 - H.x0, 0.034, qz1 - qz0, C.quay, { jitter: 0.06 });
  for (let x = H.x0; x < H.x1; x += 0.06) {
    vb.box(x + 0.03, 0.038, qz0 + 0.010, 0.056, 0.008, 0.020, C.concrete, { jitter: 0.08 });
  }
  // basin floor beneath the water plane
  vb.box(cxA, 0.002, (BOARD.z0 + qz0) / 2, H.x1 - H.x0 + 0.12, 0.004, qz0 - BOARD.z0,
    0x233a45, { jitter: 0.05 });
  // low sea wall along the back edge, kept short so the water stays visible
  vb.box(cxA, 0.014, BOARD.z0 + 0.010, H.x1 - H.x0 + 0.12, 0.028, 0.020, C.quay);

  // bollards
  for (let x = H.x0 + 0.07; x < H.x1; x += 0.14) {
    vb.cyl(x, 0.042, qz0 + 0.024, 0.005, 0.014, C.steelDark, 6);
  }
  // crane rails straddling the quay
  for (const cz of ZONES.quayRailZ) {
    vb.box(cxA + 0.04, 0.036, cz, H.x1 - H.x0 - 0.10, 0.004, 0.009, C.rail);
  }

  // warehouse at the east end of the quay
  vb.box(1.50, 0.034 + 0.048, -0.762, 0.26, 0.096, 0.075, C.timber, { jitter: 0.06 });
  vb.gable(1.50, 0.130, -0.762, 0.275, 0.032, 0.085, C.roofTile);
  windowGrid(vb, lit, 1.50, 0.070, -0.723, 0.20, 0.030, 4, 1, 'z');
  reg('building', 'quay-warehouse', 1.37, 1.63, -0.80, -0.724, 0, 0.17);

  // containers under the gantries, between the crane rails
  const cols = [0x2f6f8f, 0xb4553f, 0x4a7a52, 0xc0a13f];
  const CW = 0.070, CH = 0.028, CD = 0.030;
  for (let i = 0; i < 9; i++) {
    const x = H.x0 + 0.10 + i * 0.105;
    if (x > 1.30) break;
    // never stack a container where a gantry leg stands
    if (ZONES.craneX.some((cx2) => Math.abs(x - cx2) < 0.075)) continue;
    const z = -0.785 + (i % 2 ? 0.022 : -0.022);
    const n = 1 + (i % 3 === 0 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      vb.box(x, 0.034 + CH / 2 + k * CH, z, CW, CH, CD, pick(cols), { jitter: 0.07 });
    }
    reg('prop', 'containers' + i, x - CW / 2, x + CW / 2, z - CD / 2, z + CD / 2, 0.034, 0.034 + n * CH);
  }
  // a few crates and oil drums for texture
  for (let i = 0; i < 6; i++) {
    const x = 0.40 + i * 0.16, z = -0.712;
    if (ZONES.craneX.some((cx2) => Math.abs(x - cx2) < 0.065)) continue;
    vb.cyl(x, 0.041, z, 0.005, 0.014, i % 2 ? 0x6f4a3a : 0x3f6a5a, 8);
    reg('prop', 'drum', x - 0.005, x + 0.005, z - 0.005, z + 0.005, 0.034, 0.05);
  }

  // lighthouse on the eastern mole
  vb.cyl(1.735, 0.055, -1.020, 0.020, 0.110, 0xe8e2d6, 10, { rBottom: 0.026 });
  vb.cyl(1.735, 0.090, -1.020, 0.021, 0.020, C.signalRed, 10);
  lit.cyl(1.735, 0.117, -1.020, 0.013, 0.018, 0xfff0b0, 10);
  vb.cyl(1.735, 0.132, -1.020, 0.015, 0.010, C.steelDark, 10);
  vb.box(1.735, 0.010, -1.020, 0.075, 0.020, 0.075, C.quay, { jitter: 0.06 });
  reg('prop', 'lighthouse', 1.697, 1.773, -1.058, -0.982, 0, 0.14);
}

/* ------------------------------------------------------------------- town */

function townBuilding(vb, lit, x, z, w, d, h, seed) {
  const wallCols = [C.brick, C.plaster, 0xc9b28f, 0xb8564a, 0xd8cdb4, 0x9fae9a, 0xc07a5a];
  const roofCols = [C.roofTile, C.roofSlate, C.roofGreen, 0x6d4a3f];
  const wc = wallCols[seed % wallCols.length];
  const rc = roofCols[(seed >> 1) % roofCols.length];
  vb.box(x, h / 2, z, w, h, d, wc, { jitter: 0.07 });
  if (seed % 3 === 0) {
    vb.box(x, h + 0.003, z, w + 0.010, 0.006, d + 0.010, rc);         // eaves
    vb.gable(x, h + 0.005, z, w + 0.010, 0.030, d + 0.010, rc);
  } else {
    vb.box(x, h + 0.005, z, w + 0.012, 0.010, d + 0.012, rc);
    vb.box(x, h + 0.016, z, w * 0.42, 0.012, d * 0.42, rc, { jitter: 0.05 });
  }
  // chimney: on the roof, not beside it
  vb.cyl(x + w * 0.24, h + 0.016, z - d * 0.12, 0.0055, 0.034, C.brickDark, 6);

  // windows sit above the door line so the two never share a wall square
  const sillY = 0.042, headY = h - 0.012;
  const rows = Math.max(1, Math.round((headY - sillY) / 0.038));
  const wy = (sillY + headY) / 2, wh = Math.max(0.020, headY - sillY);
  windowGrid(vb, lit, x, wy, z + d / 2 + 0.003, w * 0.70, wh, 3, rows, 'z');
  windowGrid(vb, lit, x, wy, z - d / 2 - 0.003, w * 0.70, wh, 3, rows, 'z', -1);
  // door and step
  vb.box(x, 0.016, z + d / 2 + 0.003, 0.017, 0.032, 0.005, C.timber);
  vb.box(x, 0.0025, z + d / 2 + 0.008, 0.024, 0.005, 0.012, C.pavement);
}

function town(vb, lit) {
  const lamps = [];
  // --- front terrace, north of the road
  const T = ZONES.townFront;
  let x = T.x0 + 0.06;
  let i = 0;
  while (x < T.x1 - 0.08) {
    const w = rand(0.09, 0.15);
    const d = rand(0.10, 0.16);
    // low roofline, and a gap left of centre so the layout stays visible
    const h = rand(0.075, 0.125);
    const z = T.z0 + d / 2 + rand(0.01, 0.05);
    if (x > -0.34 && x < 0.46) { x += 0.10; i++; continue; }
    townBuilding(vb, lit, x + w / 2, z, w, d, h, i);
    reg('building', 'town-f' + i, x, x + w, z - d / 2, z + d / 2, 0, h + 0.07);
    x += w + rand(0.035, 0.075);
    i++;
  }
  // --- right-hand block, east of the vertical road
  const Rz = ZONES.townRight;
  let z = Rz.z0 + 0.06; let j = 0;
  while (z < Rz.z1 - 0.08) {
    const d = rand(0.09, 0.15);
    const w = rand(0.10, 0.16);
    const bx = Rz.x0 + w / 2 + rand(0.005, 0.03);
    townBuilding(vb, lit, bx, z + d / 2, w, d, rand(0.085, 0.155), j + 5);
    reg('building', 'town-r' + j, bx - w / 2, bx + w / 2, z, z + d, 0, 0.26);
    z += d + rand(0.03, 0.07);
    j++;
  }
  // church with a spire, front-left of the terrace
  const cx = -1.36, cz = 0.72;
  vb.box(cx, 0.075, cz, 0.13, 0.15, 0.19, C.plaster, { jitter: 0.05 });
  vb.gable(cx, 0.15, cz, 0.14, 0.05, 0.20, C.roofSlate);
  vb.box(cx - 0.10, 0.115, cz - 0.05, 0.07, 0.23, 0.07, C.plaster, { jitter: 0.05 });
  vb.roof(cx - 0.10, 0.23, cz - 0.05, 0.075, 0.10, 0.075, C.roofSlate);
  lit.box(cx - 0.10, 0.20, cz - 0.014, 0.030, 0.030, 0.006, 0xffe6b0);
  windowGrid(vb, lit, cx, 0.088, cz + 0.096, 0.09, 0.045, 2, 1, 'z');
  reg('building', 'church', cx - 0.15, cx + 0.07, cz - 0.10, cz + 0.10, 0, 0.34);

  // street lamps down both roads
  for (let lx = -1.6; lx <= 1.35; lx += 0.34) lamps.push([lx, ZONES.roadFront.z + 0.075]);
  for (let lz = -0.30; lz <= 0.78; lz += 0.30) lamps.push([ZONES.roadRight.x + 0.075, lz]);
  for (const [lx, lz] of lamps) {
    vb.cyl(lx, 0.024, lz, 0.0030, 0.048, C.steelDark, 5);
    vb.box(lx, 0.050, lz, 0.014, 0.004, 0.007, C.steelDark);
    lit.box(lx, 0.0465, lz, 0.011, 0.004, 0.005, 0xffdf9e);
    reg('prop', 'lamp', lx - 0.007, lx + 0.007, lz - 0.007, lz + 0.007, 0, 0.055);
  }
  return lamps;
}

/* ------------------------------------------------------------------ roads */

function roads(vb) {
  const F = ZONES.roadFront, Rr = ZONES.roadRight;
  const x0 = -1.74, x1 = Rr.x + Rr.half;
  // front road
  vb.box((x0 + x1) / 2, 0.009, F.z, x1 - x0, 0.008, F.half * 2, C.road, { jitter: 0.05 });
  for (let x = x0 + 0.03; x < x1 - 0.05; x += 0.10) {
    vb.box(x, 0.0135, F.z, 0.055, 0.002, 0.008, C.roadLine);
  }
  // right road, running north from the front road
  const z0 = -0.44, z1 = F.z;
  vb.box(Rr.x, 0.009, (z0 + z1) / 2, Rr.half * 2, 0.008, z1 - z0, C.road, { jitter: 0.05 });
  for (let z = z0 + 0.03; z < z1 - 0.06; z += 0.10) {
    vb.box(Rr.x, 0.0135, z, 0.008, 0.002, 0.055, C.roadLine);
  }
  // pavements
  vb.box((x0 + x1) / 2, 0.011, F.z + F.half + 0.014, x1 - x0, 0.012, 0.028, C.pavement, { jitter: 0.05 });
  vb.box((x0 + x1) / 2, 0.011, F.z - F.half - 0.014, x1 - x0, 0.012, 0.028, C.pavement, { jitter: 0.05 });
  vb.box(Rr.x + Rr.half + 0.014, 0.011, (z0 + z1) / 2 - 0.02, 0.028, 0.012, z1 - z0 - 0.04,
    C.pavement, { jitter: 0.05 });

  reg('road', 'road-front', x0, x1, F.z - F.half, F.z + F.half, 0, 0.02);
  reg('road', 'road-right', Rr.x - Rr.half, Rr.x + Rr.half, z0, z1, 0, 0.02);
}

/* ------------------------------------------------------------------ trees */

function trees(vb, track, sids) {
  const spots = [];
  // snapshot of everything placed before the trees, so none of them lands on a
  // building, a lamp post, a signal or a container
  const placedBodies = SOLIDS.filter((s) => ['building', 'prop', 'road'].includes(s.kind));
  const clear = (x, z) => {
    for (const b of placedBodies) {
      if (x > b.x0 - 0.030 && x < b.x1 + 0.030 && z > b.z0 - 0.030 && z < b.z1 + 0.030) return false;
    }
    if (track.distanceTo(x, z, 300) < 0.085) return false;
    for (const s of sids) if (s.distanceTo(x, z, 80) < 0.055) return false;
    const F = ZONES.roadFront, Rr = ZONES.roadRight;
    if (Math.abs(z - F.z) < F.half + 0.05 && x > -1.78 && x < Rr.x + 0.1) return false;
    if (Math.abs(x - Rr.x) < Rr.half + 0.05 && z > -0.50 && z < F.z) return false;
    for (const s of spots) if (Math.hypot(s[0] - x, s[1] - z) < 0.048) return false;
    return true;
  };
  const zones = [
    [-1.74, -1.06, -1.02, -0.84], [0.20, 1.72, 0.44, 0.56],
    [-1.76, -1.02, 0.62, 0.82], [-0.10, 0.86, 0.42, 0.56],
    [1.44, 1.76, -0.66, -0.44], [-1.74, -1.04, -0.74, 0.54],
    [-0.12, 0.26, -0.68, -0.60], [1.10, 1.44, -0.44, -0.20],
  ];
  let placed = 0;
  for (let attempt = 0; attempt < 1400 && placed < 96; attempt++) {
    const zn = zones[attempt % zones.length];
    const x = rand(zn[0], zn[1]), z = rand(zn[2], zn[3]);
    if (!clear(x, z)) continue;
    spots.push([x, z]); placed++;
    // trees on the hillside stand on the slope, not buried inside it
    const base = Math.max(0, hillHeight(x, z) - 0.006);
    const h = rand(0.030, 0.055);
    const r = rand(0.011, 0.019);
    vb.cyl(x, base + h * 0.28, z, 0.0035, h * 0.58, C.treeTrunk, 5);
    const leaf = pick([C.leafA, C.leafB, C.leafC]);
    if (R() < 0.45) {
      vb.cyl(x, base + h * 0.80, z, 0.001, h * 0.78, leaf, 7, { rBottom: r });
      vb.cyl(x, base + h * 0.56, z, r * 0.72, h * 0.40, leaf, 7, { rBottom: r * 1.05 });
    } else {
      vb.box(x, base + h * 0.72, z, r * 1.9, r * 1.6, r * 1.9, leaf, { jitter: 0.12 });
      vb.box(x, base + h * 0.94, z, r * 1.2, r * 1.1, r * 1.2, leaf, { jitter: 0.12 });
    }
    reg('tree', 'tree', x - r, x + r, z - r, z + r, base, base + h * 1.2);
  }
  // hedges along the front pavement
  for (let x = -1.70; x < -1.05; x += 0.040) {
    vb.box(x, 0.012, 0.60, 0.038, 0.024, 0.022, C.leafB, { jitter: 0.14 });
  }
}

/* ------------------------------------------------------------ signals etc */

function lineside(vb, lit, track) {
  const marks = [0.55, 2.2, 3.6, 5.3];
  for (const m of marks) {
    const p = track.at(m);
    const nx = -p.tz, nz = p.tx;
    const x = p.x + nx * 0.052, z = p.z + nz * 0.052;
    vb.cyl(x, 0.026, z, 0.0030, 0.052, C.steelDark, 5);
    vb.box(x, 0.058, z, 0.010, 0.020, 0.006, 0x2a2f35);
    lit.box(x, 0.062, z + 0.004, 0.005, 0.005, 0.003, 0x35d06a);
    lit.box(x, 0.054, z + 0.004, 0.005, 0.005, 0.003, 0x3a1418);
    reg('prop', 'signal', x - 0.008, x + 0.008, z - 0.008, z + 0.008, 0, 0.07);
  }
  // telegraph poles along the back straight
  for (let x = -0.7; x <= 0.7; x += 0.35) {
    const z = LOOP.zBack - 0.095;
    vb.cyl(x, 0.030, z, 0.0030, 0.060, C.treeTrunk, 5);
    vb.box(x, 0.056, z, 0.026, 0.004, 0.004, C.treeTrunk);
    reg('prop', 'pole', x - 0.006, x + 0.006, z - 0.006, z + 0.006, 0, 0.07);
  }
}

/* ------------------------------------------------------------------ entry */

export function buildScenery(vb, lit) {
  const track = mainLine();
  const sids = sidings();

  ground(vb);
  buildTrack(vb, track, { skipTunnel: false });
  for (const s of sids) buildTrack(vb, s, { ballastHalf: 0.020 });
  bufferStop(vb, ZONES.sidingX1 + 0.02, ZONES.sidings[0], 1);
  bufferStop(vb, ZONES.sidingX1 + 0.02, ZONES.sidings[1], 1);
  bufferStop(vb, ZONES.sidingX1 + 0.02, ZONES.sidings[2], 1);
  // stub track from the turntable towards the shed
  buildTrack(vb, new Path2([line(
    ZONES.turntable.cx, ZONES.turntable.cz - ZONES.turntable.r,
    ZONES.turntable.cx, ZONES.shed.z0,
  )]), { ballastHalf: 0.018 });

  turntable(vb);
  hill(vb, track);
  station(vb, lit);
  engineShed(vb, lit);
  factory(vb, lit);
  harbour(vb, lit);
  roads(vb);
  town(vb, lit);
  lineside(vb, lit, track);
  trees(vb, track, sids);

  return { track, sids };
}
