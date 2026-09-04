import { C } from './palette.js';
import { BOARD, TABLE_TOP_Y } from './layout.js';

const FLOOR = -TABLE_TOP_Y;

/** Wooden table the layout stands on, plus the baseboard fascia. */
export function buildTable(vb) {
  const { x0, x1, z0, z1 } = BOARD;
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

  // table top: the baseboard grass sits at y = 0, so the slab is just below it
  vb.box(cx, -0.028, cz, w + 0.10, 0.056, d + 0.10, C.tableTop, { jitter: 0.07 });
  // moulded edge
  vb.box(cx, -0.060, cz, w + 0.14, 0.022, d + 0.14, C.tableEdge, { jitter: 0.05 });

  // apron rails
  vb.box(cx, -0.115, z0 - 0.02, w + 0.02, 0.09, 0.05, C.tableEdge);
  vb.box(cx, -0.115, z1 + 0.02, w + 0.02, 0.09, 0.05, C.tableEdge);
  vb.box(x0 - 0.02, -0.115, cz, 0.05, 0.09, d + 0.02, C.tableEdge);
  vb.box(x1 + 0.02, -0.115, cz, 0.05, 0.09, d + 0.02, C.tableEdge);

  // legs
  const legH = TABLE_TOP_Y - 0.08;
  for (const lx of [x0 + 0.10, x1 - 0.10]) {
    for (const lz of [z0 + 0.10, z1 - 0.10]) {
      vb.box(lx, FLOOR + legH / 2, lz, 0.085, legH, 0.085, C.tableLeg, { jitter: 0.05 });
      vb.box(lx, FLOOR + 0.012, lz, 0.10, 0.024, 0.10, C.tableEdge);
    }
  }
  // stretcher
  vb.box(cx, FLOOR + 0.22, z0 + 0.10, w - 0.20, 0.05, 0.05, C.tableLeg);
  vb.box(cx, FLOOR + 0.22, z1 - 0.10, w - 0.20, 0.05, 0.05, C.tableLeg);
}
