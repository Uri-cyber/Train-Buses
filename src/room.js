import * as THREE from 'three';
import { VoxelBuilder } from './voxel.js';
import { C } from './palette.js';
import { TABLE_TOP_Y } from './layout.js';

const FLOOR = -TABLE_TOP_Y;
export const ROOM = { x: 3.3, zBack: -3.2, zFront: 3.6, ceil: 1.62 };

/** Static room shell. Returns { solid, glass } geometry builders' meshes. */
export function buildRoom(vb, lit) {
  const { x, zBack, zFront, ceil } = ROOM;
  const w = x * 2, d = zFront - zBack, cz = (zFront + zBack) / 2;
  const t = 0.12;

  // floor boards
  vb.box(0, FLOOR - 0.03, cz, w, 0.06, d, C.floor, { jitter: 0.10 });
  for (let i = -8; i <= 8; i++) {
    vb.box(i * 0.38, FLOOR + 0.001, cz, 0.012, 0.004, d, 0x5b4c3e, { jitter: 0.06 });
  }
  // rug under the table
  vb.box(0, FLOOR + 0.006, 0.1, 4.4, 0.012, 3.0, C.rug, { jitter: 0.07 });
  vb.box(0, FLOOR + 0.013, 0.1, 4.15, 0.004, 2.75, 0x8d6a60, { jitter: 0.05 });

  // walls (back + two sides), split into a darker dado and pale upper
  const wallY0 = FLOOR, wallH = ceil - FLOOR;
  const dado = 0.85;
  const wall = (px, pz, ww, dd) => {
    vb.box(px, wallY0 + dado / 2, pz, ww, dado, dd, C.wallLower, { jitter: 0.05 });
    vb.box(px, wallY0 + dado + (wallH - dado) / 2, pz, ww, wallH - dado, dd, C.wallUpper, { jitter: 0.05 });
    vb.box(px, wallY0 + dado, pz, ww * 1.002, 0.022, dd * 1.002, C.skirting);
    vb.box(px, wallY0 + 0.055, pz, ww * 1.004, 0.11, dd * 1.004, C.skirting, { jitter: 0.03 });
  };
  wall(0, zBack - t / 2, w + t * 2, t);
  wall(-x - t / 2, cz, t, d);
  wall(x + t / 2, cz, t, d);
  vb.box(0, ceil + 0.03, cz, w + t * 2, 0.06, d, C.ceiling);

  // window on the left wall, with a frame and a warm sill
  const wy = FLOOR + 1.10, wz = -0.75;
  vb.box(-x - 0.01, wy, wz, 0.05, 1.02, 1.34, C.windowFrm);
  for (const oz of [-0.33, 0.33]) {
    lit.box(-x + 0.02, wy, wz + oz, 0.012, 0.90, 0.56, 0xdfeeff, { jitter: 0.02 });
  }
  vb.box(-x + 0.06, wy - 0.53, wz, 0.14, 0.04, 1.30, C.skirting);
  // mullions
  vb.box(-x + 0.035, wy, wz, 0.02, 1.00, 0.045, C.windowFrm);
  vb.box(-x + 0.035, wy, wz, 0.02, 0.045, 1.30, C.windowFrm);

  // a couple of framed pictures on the back wall
  for (const px of [-1.5, 1.4]) {
    vb.box(px, FLOOR + 1.28, zBack + 0.04, 0.52, 0.40, 0.03, C.timber);
    vb.box(px, FLOOR + 1.28, zBack + 0.06, 0.46, 0.34, 0.01, px < 0 ? 0x86a2b8 : 0xbba07a);
  }
  // shelf with boxes, right wall
  vb.box(x - 0.16, FLOOR + 1.05, -1.4, 0.30, 0.035, 1.30, C.timber);
  for (let i = 0; i < 4; i++) {
    vb.box(x - 0.17, FLOOR + 1.14, -1.9 + i * 0.32, 0.20, 0.15, 0.22,
      [0xa8564a, 0x4f6d8a, 0x8b7a4f, 0x5f7a56][i], { jitter: 0.06 });
  }
  // pendant lamp over the table
  vb.cyl(0, 1.30, 0.2, 0.012, 0.5, 0x2b2b2b, 6);
  vb.cyl(0, 1.02, 0.2, 0.20, 0.14, 0x2f3a44, 12, { rBottom: 0.06 });
  lit.cyl(0, 0.955, 0.2, 0.17, 0.012, 0xfff0cf, 12);
}
