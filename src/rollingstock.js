import * as THREE from 'three';
import { VoxelBuilder, standardMat, emissiveMat } from './voxel.js';
import { C } from './palette.js';
import { LOOP, ZONES } from './layout.js';
import { reg } from './occupancy.js';

/** Build one vehicle body into a fresh builder and return a Mesh group. */
function bodyMesh(build, litBuild) {
  const vb = new VoxelBuilder(), lb = new VoxelBuilder();
  build(vb, lb);
  const g = new THREE.Group();
  const m = vb.mesh(standardMat());
  g.add(m);
  const lg = lb.build();
  if (lg) {
    const lm = new THREE.Mesh(lg, emissiveMat());
    lm.userData.isWindow = true;
    g.add(lm);
  }
  void litBuild;
  return g;
}

/* --------------------------------------------------------------- wheels */
// Wheels are inset so they never poke through the frames, and their tread
// bottom sits exactly on the railhead (y = LOOP.railTopY).
const WHEEL_R = 0.0058;
const RAIL_Y = LOOP.railTopY;

function wheelset(vb, z, halfGauge = LOOP.gauge) {
  const y = RAIL_Y + WHEEL_R;
  for (const s of [-1, 1]) {
    vb.cyl(halfGauge * s, y, z, WHEEL_R, 0.0045, 0x33383d, 10, { rotZ: Math.PI / 2 });
  }
  vb.cyl(0, y, z, 0.0022, halfGauge * 1.7, 0x3d434a, 6, { rotZ: Math.PI / 2 });
}

/* ----------------------------------------------------------------- loco */

export function steamLoco() {
  return bodyMesh((vb, lb) => {
    const yb = RAIL_Y + WHEEL_R * 2;              // top of the wheels
    // frames sit above the wheel tops so nothing intersects
    vb.box(0, yb + 0.006, 0, 0.030, 0.010, 0.150, 0x2a2f34);
    // boiler
    vb.cyl(0, yb + 0.030, -0.012, 0.021, 0.100, C.loco, 12, { rotX: Math.PI / 2 });
    vb.cyl(0, yb + 0.030, -0.062, 0.023, 0.006, 0x1a1d20, 12, { rotX: Math.PI / 2 });
    // smokebox + chimney + dome
    vb.cyl(0, yb + 0.055, -0.052, 0.008, 0.022, 0x24282c, 8);
    vb.cyl(0, yb + 0.066, -0.052, 0.011, 0.006, 0x24282c, 8);
    vb.cyl(0, yb + 0.054, -0.014, 0.009, 0.014, C.locoTrim, 8);
    // cab
    vb.box(0, yb + 0.034, 0.046, 0.040, 0.048, 0.044, C.loco, { jitter: 0.05 });
    vb.box(0, yb + 0.060, 0.046, 0.044, 0.006, 0.048, 0x1f2327);
    lb.box(0.0205, yb + 0.042, 0.046, 0.004, 0.020, 0.026, 0xffd9a0);
    lb.box(-0.0205, yb + 0.042, 0.046, 0.004, 0.020, 0.026, 0xffd9a0);
    // running boards + lining
    for (const s of [-1, 1]) {
      vb.box(0.019 * s, yb + 0.012, -0.015, 0.010, 0.004, 0.110, C.locoTrim);
    }
    // buffer beams
    vb.box(0, yb + 0.008, -0.076, 0.034, 0.012, 0.006, C.signalRed);
    vb.box(0, yb + 0.008, 0.070, 0.034, 0.012, 0.006, C.signalRed);
    // headlamp
    lb.box(0, yb + 0.020, -0.079, 0.008, 0.008, 0.004, 0xfff0c0);
    // wheels
    wheelset(vb, -0.040); wheelset(vb, -0.008); wheelset(vb, 0.028);
  });
}

export function tender() {
  return bodyMesh((vb) => {
    const yb = RAIL_Y + WHEEL_R * 2;
    vb.box(0, yb + 0.005, 0, 0.030, 0.008, 0.090, 0x2a2f34);
    vb.box(0, yb + 0.026, 0, 0.038, 0.036, 0.086, C.loco, { jitter: 0.05 });
    vb.box(0, yb + 0.046, -0.005, 0.030, 0.010, 0.060, 0x1a1a1a, { jitter: 0.2 }); // coal
    vb.box(0, yb + 0.008, -0.048, 0.034, 0.012, 0.006, C.signalRed);
    wheelset(vb, -0.026); wheelset(vb, 0.026);
  });
}

export function coach(colour = C.coach) {
  return bodyMesh((vb, lb) => {
    const yb = RAIL_Y + WHEEL_R * 2;
    vb.box(0, yb + 0.005, 0, 0.032, 0.008, 0.155, 0x2a2f34);
    vb.box(0, yb + 0.032, 0, 0.040, 0.046, 0.150, colour, { jitter: 0.05 });
    vb.box(0, yb + 0.057, 0, 0.042, 0.008, 0.152, 0xd8d3c6);
    vb.box(0, yb + 0.012, 0, 0.043, 0.005, 0.152, C.coachTrim);
    for (let i = 0; i < 7; i++) {
      const z = -0.060 + i * 0.020;
      lb.box(0.0205, yb + 0.038, z, 0.004, 0.018, 0.013, 0xffdca8);
      lb.box(-0.0205, yb + 0.038, z, 0.004, 0.018, 0.013, 0xffdca8);
    }
    wheelset(vb, -0.052); wheelset(vb, -0.040);
    wheelset(vb, 0.040); wheelset(vb, 0.052);
  });
}

export function wagon(kind = 0) {
  return bodyMesh((vb) => {
    const yb = RAIL_Y + WHEEL_R * 2;
    vb.box(0, yb + 0.005, 0, 0.030, 0.008, 0.090, 0x2a2f34);
    if (kind === 0) {                      // open wagon with a load
      vb.box(0, yb + 0.020, 0, 0.036, 0.024, 0.086, C.freightA, { jitter: 0.06 });
      vb.box(0, yb + 0.030, 0, 0.028, 0.008, 0.070, 0x35302a, { jitter: 0.2 });
    } else if (kind === 1) {               // van
      vb.box(0, yb + 0.026, 0, 0.036, 0.038, 0.086, C.freightB, { jitter: 0.06 });
      vb.box(0, yb + 0.047, 0, 0.038, 0.006, 0.088, 0xb9b3a6);
    } else {                               // tank wagon
      vb.cyl(0, yb + 0.024, 0, 0.017, 0.078, C.freightC, 12, { rotX: Math.PI / 2 });
      vb.box(0, yb + 0.042, 0, 0.010, 0.008, 0.010, C.steelDark);
    }
    wagon_buffers(vb, yb);
    wheelset(vb, -0.026); wheelset(vb, 0.026);
  });
}
function wagon_buffers(vb, yb) {
  vb.box(0, yb + 0.008, -0.048, 0.032, 0.010, 0.005, 0x4a3f34);
  vb.box(0, yb + 0.008, 0.048, 0.032, 0.010, 0.005, 0x4a3f34);
}

/** A train = ordered vehicles with fixed spacing along the path. */
export function makeTrain(spec) {
  const g = new THREE.Group();
  const cars = spec.map((s) => {
    const m = s();
    g.add(m);
    return m;
  });
  return { group: g, cars };
}

/* ---------------------------------------------------------------- ships */

export function ship(scale = 1, colour = C.hull) {
  const g = bodyMesh((vb, lb) => {
    const L = 0.34 * scale, W = 0.085 * scale;
    vb.box(0, 0.014, 0, W, 0.028, L, colour, { jitter: 0.05 });
    vb.box(0, 0.030, 0, W * 0.96, 0.008, L * 0.98, 0x2c2c2c);
    vb.box(0, 0.031, -L * 0.18, W * 0.92, 0.006, L * 0.5, 0x6b5f4e);
    // superstructure aft
    vb.box(0, 0.052, L * 0.24, W * 0.62, 0.036, L * 0.20, C.superstr, { jitter: 0.04 });
    vb.box(0, 0.076, L * 0.24, W * 0.44, 0.018, L * 0.14, C.superstr);
    lb.box(0, 0.078, L * 0.312, W * 0.40, 0.010, 0.004, 0xffe0aa);
    vb.cyl(0, 0.098, L * 0.26, 0.010 * scale, 0.030, 0xd34a3a, 8);
    vb.cyl(0, 0.114, L * 0.26, 0.011 * scale, 0.008, 0x24282c, 8);
    // bow flare
    vb.box(0, 0.020, -L * 0.52, W * 0.55, 0.030, L * 0.06, colour);
    // deck cargo
    for (let i = 0; i < 3; i++) {
      vb.box(0, 0.044, -L * 0.30 + i * L * 0.13, W * 0.60, 0.022, L * 0.10,
        [0x2f6f8f, 0xb4553f, 0x4a7a52][i], { jitter: 0.06 });
    }
    // masts
    vb.cyl(0, 0.072, -L * 0.42, 0.003, 0.070, 0xc9c3b4, 5);
  });
  return g;
}

export function tugboat() {
  return bodyMesh((vb, lb) => {
    vb.box(0, 0.011, 0, 0.048, 0.022, 0.115, 0x2b4a6b, { jitter: 0.05 });
    vb.box(0, 0.024, 0, 0.046, 0.006, 0.112, 0x54402c);
    vb.box(0, 0.042, 0.012, 0.032, 0.030, 0.036, C.superstr);
    lb.box(0, 0.048, 0.031, 0.024, 0.010, 0.004, 0xffe0aa);
    vb.cyl(0, 0.068, 0.008, 0.008, 0.024, 0xc0392b, 8);
    vb.box(0, 0.020, -0.056, 0.030, 0.020, 0.006, 0x2b4a6b);
  });
}

/* --------------------------------------------------------------- cranes */
// Portal crane: legs stand on the quay rails, never on the running line.
export function portalCrane() {
  const root = new THREE.Group();
  const RZ = ZONES.quayRailZ;
  const legZ = [RZ[0] - (RZ[0] + RZ[1]) / 2, RZ[1] - (RZ[0] + RZ[1]) / 2]; // local, centred
  const legX = 0.048;
  const y0 = 0.034;                                     // quay deck height
  const base = bodyMesh((vb) => {
    for (const sx of [-legX, legX]) {
      for (const sz of legZ) {
        vb.box(sx, y0 + 0.042, sz, 0.010, 0.084, 0.010, C.crane, { jitter: 0.04 });
        vb.box(sx, y0 + 0.005, sz, 0.018, 0.010, 0.018, C.steelDark);
      }
    }
    for (const sz of legZ) {
      vb.box(0, y0 + 0.088, sz, legX * 2 + 0.014, 0.010, 0.010, C.crane);
    }
    vb.box(0, y0 + 0.094, 0, 0.030, 0.006, RZ[1] - RZ[0] + 0.012, C.steelDark);
  });
  root.add(base);
  const jib = bodyMesh((vb, lb) => {
    const y = y0 + 0.112;
    vb.box(0, y, 0, 0.036, 0.026, 0.036, C.crane, { jitter: 0.04 });
    lb.box(0, y + 0.002, 0.019, 0.020, 0.010, 0.004, 0xffe6b4);
    vb.box(0, y + 0.019, -0.062, 0.009, 0.008, 0.150, C.crane);   // jib
    vb.box(0, y + 0.021, 0.044, 0.014, 0.014, 0.028, C.steelDark); // counterweight
    vb.cyl(0, y + 0.030, -0.020, 0.003, 0.040, C.steelDark, 5);    // hoist rope
  });
  root.add(jib);
  root.userData.jib = jib;
  return root;
}

/* ------------------------------------------------------------ road cars */

export function roadVehicle(kind = 0) {
  const cols = [0xc0392b, 0x2e6f9e, 0xd8c25a, 0x4f7a52, 0xdad4c8, 0x8a5a3a];
  const col = cols[kind % cols.length];
  return bodyMesh((vb, lb) => {
    if (kind === 5) {                      // bus
      vb.box(0, 0.020, 0, 0.030, 0.026, 0.086, 0x2f6f8f, { jitter: 0.04 });
      vb.box(0, 0.034, 0, 0.031, 0.004, 0.088, 0xe4dfd2);
      lb.box(0, 0.024, 0.044, 0.022, 0.010, 0.004, 0xfff0c8);
      for (let i = 0; i < 5; i++) {
        lb.box(0.0155, 0.024, -0.030 + i * 0.015, 0.003, 0.010, 0.009, 0xffe4b0);
        lb.box(-0.0155, 0.024, -0.030 + i * 0.015, 0.003, 0.010, 0.009, 0xffe4b0);
      }
      for (const z of [-0.028, 0.028]) axle(vb, z, 0.016);
    } else if (kind === 4) {               // lorry
      vb.box(0, 0.014, -0.018, 0.026, 0.018, 0.026, col, { jitter: 0.04 });
      vb.box(0, 0.022, 0.020, 0.028, 0.030, 0.052, 0xb9b3a6, { jitter: 0.04 });
      lb.box(0, 0.012, -0.032, 0.018, 0.006, 0.004, 0xfff0c8);
      for (const z of [-0.020, 0.024]) axle(vb, z, 0.014);
    } else {                               // car
      vb.box(0, 0.011, 0, 0.024, 0.014, 0.052, col, { jitter: 0.04 });
      vb.box(0, 0.022, 0.004, 0.020, 0.010, 0.026, col, { jitter: 0.04 });
      vb.box(0, 0.023, 0.004, 0.021, 0.008, 0.020, 0x2b3440);
      lb.box(0, 0.011, -0.027, 0.016, 0.005, 0.003, 0xfff0c8);
      lb.box(0, 0.011, 0.027, 0.016, 0.005, 0.003, 0xc0392b);
      for (const z of [-0.016, 0.016]) axle(vb, z, 0.012);
    }
  });
}
function axle(vb, z, halfW) {
  for (const s of [-1, 1]) {
    vb.cyl(halfW * s, 0.005, z, 0.005, 0.004, 0x2b2b2b, 8, { rotZ: Math.PI / 2 });
  }
}

/** Park a few wagons in the yard, entirely between the buffer stops. */
export function parkedStock(scene) {
  const out = [];
  const rows = ZONES.sidings;
  const layout = [
    [rows[0], [-0.60, -0.50, -0.40]],
    [rows[1], [-0.55, -0.45]],
    [rows[2], [-0.62, -0.52, -0.42, -0.32]],
  ];
  layout.forEach(([z, xs], ri) => {
    xs.forEach((x, i) => {
      const w = wagon((i + ri) % 3);
      w.position.set(x, 0, z);
      w.rotation.y = Math.PI / 2;
      scene.add(w);
      out.push(w);
      reg('stock', 'parked', x - 0.048, x + 0.048, z - 0.020, z + 0.020, 0, 0.07);
    });
  });
  return out;
}
