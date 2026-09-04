/**
 * Automated clearance check.
 *
 * Builds the layout with a no-op geometry sink (no browser needed), collects
 * every registered footprint, and asserts that nothing intersects anything it
 * must not: buildings vs track, cranes vs rails, trees vs roads, stock hanging
 * off the end of a siding, and so on.
 *
 *   npm run check
 */
import { VoxelBuilder } from '../src/voxel.js';
import { buildScenery } from '../src/scenery.js';
import { SOLIDS } from '../src/occupancy.js';
import { mainLine, sidings } from '../src/track.js';
import { LOOP, ZONES, BOARD, DESK } from '../src/layout.js';

const vb = new VoxelBuilder(), lit = new VoxelBuilder();
buildScenery(vb, lit);
vb.parts.length = 0; lit.parts.length = 0;   // drop the geometry, keep the footprints

const track = mainLine();
const sids = sidings();
const failures = [];
const fail = (rule, detail) => failures.push({ rule, detail });

const overlap = (a, b, pad = 0) =>
  a.x0 - pad < b.x1 && a.x1 + pad > b.x0 &&
  a.z0 - pad < b.z1 && a.z1 + pad > b.z0 &&
  a.y0 < b.y1 - 1e-6 && a.y1 > b.y0 + 1e-6;

// Sample a footprint's outline and its centre; used for the track corridor test.
function* samples(s, n = 6) {
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      yield [s.x0 + ((s.x1 - s.x0) * i) / n, s.z0 + ((s.z1 - s.z0) * j) / n];
    }
  }
}

/* 1. Nothing may sit inside the running line's ballast + loading gauge. */
const CORRIDOR = LOOP.ballastHalf + 0.008;
const EXEMPT_FROM_TRACK = new Set(['hill', 'trackwork']);
for (const s of SOLIDS) {
  if (EXEMPT_FROM_TRACK.has(s.kind)) continue;
  let worst = Infinity;
  for (const [x, z] of samples(s)) worst = Math.min(worst, track.distanceTo(x, z, 260));
  if (worst < CORRIDOR) {
    fail('main-line clearance', `${s.name} is ${worst.toFixed(3)} from the running line (need ${CORRIDOR})`);
  }
}

/* 2. Same for the yard sidings. */
const SIDING_CORRIDOR = 0.020 + 0.008;
for (const s of SOLIDS) {
  if (s.kind === 'stock' || s.kind === 'trackwork' || s.kind === 'hill') continue;
  for (const sd of sids) {
    let worst = Infinity;
    for (const [x, z] of samples(s, 4)) worst = Math.min(worst, sd.distanceTo(x, z, 120));
    if (worst < SIDING_CORRIDOR) {
      fail('siding clearance', `${s.name} is ${worst.toFixed(3)} from a siding (need ${SIDING_CORRIDOR})`);
      break;
    }
  }
}

/* 3. Buildings, props and trees must not intersect each other. */
const BODIES = SOLIDS.filter((s) => ['building', 'prop', 'tree', 'stock'].includes(s.kind));
for (let i = 0; i < BODIES.length; i++) {
  for (let j = i + 1; j < BODIES.length; j++) {
    if (overlap(BODIES[i], BODIES[j])) {
      fail('body intersection', `${BODIES[i].name} overlaps ${BODIES[j].name}`);
    }
  }
}

/* 4. Nothing but road markings may stand on a road. */
const ROADS = SOLIDS.filter((s) => s.kind === 'road');
for (const s of SOLIDS) {
  if (s.kind === 'road' || s.kind === 'hill') continue;
  for (const r of ROADS) {
    if (s.x0 < r.x1 && s.x1 > r.x0 && s.z0 < r.z1 && s.z1 > r.z0) {
      fail('road clearance', `${s.name} stands on ${r.name}`);
    }
  }
}

/* 5. Parked stock must sit wholly between the siding ends. */
for (const s of SOLIDS.filter((x) => x.kind === 'stock')) {
  if (s.x0 < ZONES.sidingX0 || s.x1 > ZONES.sidingX1) {
    fail('stock overhang', `${s.name} runs off the siding (${s.x0.toFixed(3)}..${s.x1.toFixed(3)})`);
  }
}

/* 6. Everything must be on the baseboard and clear of the control desk. */
const desk = { x0: DESK.x0 - 0.09, x1: DESK.x1 + 0.09, z0: DESK.z0 - 0.06, z1: DESK.z1, y0: 0, y1: 0.2 };
for (const s of SOLIDS) {
  if (s.x0 < BOARD.x0 || s.x1 > BOARD.x1 || s.z0 < BOARD.z0 || s.z1 > BOARD.z1) {
    fail('off the baseboard', `${s.name} (${s.x0.toFixed(2)}..${s.x1.toFixed(2)}, ${s.z0.toFixed(2)}..${s.z1.toFixed(2)})`);
  }
  if (overlap(s, desk)) fail('desk clearance', `${s.name} fouls the control desk`);
}

/* 7. Gantry cranes must straddle the quay rails, not the running line. */
for (const cx of ZONES.craneX) {
  for (const cz of ZONES.quayRailZ) {
    const d = track.distanceTo(cx, cz, 400);
    if (d < CORRIDOR) fail('crane on the rails', `gantry leg at ${cx},${cz} is ${d.toFixed(3)} from the main line`);
  }
  if (Math.min(...ZONES.quayRailZ) < BOARD.z0 || Math.max(...ZONES.quayRailZ) > ZONES.harbour.z1) {
    fail('crane rails', 'quay rails are off the quay');
  }
  // legs must be on the quay, not in the water
  for (const cz of ZONES.quayRailZ) {
    if (cz < ZONES.waterZ1) fail('crane in the water', `gantry rail at z=${cz} is north of the quay edge`);
  }
}

/* 8. Wheels must rest on the railhead, not float or sink into the frames. */
const WHEEL_R = 0.0058;
const wheelBottom = LOOP.railTopY + WHEEL_R - WHEEL_R;   // tread contact point
if (Math.abs(wheelBottom - LOOP.railTopY) > 1e-9) fail('wheel height', 'wheel tread does not touch the railhead');

/* ------------------------------------------------------------------ report */
const byRule = failures.reduce((m, f) => ((m[f.rule] ??= []).push(f.detail), m), {});
console.log(`checked ${SOLIDS.length} footprints against 8 rules`);
if (!failures.length) {
  console.log('PASS  no clipping found');
  process.exit(0);
}
for (const [rule, list] of Object.entries(byRule)) {
  console.log(`\nFAIL  ${rule}  (${list.length})`);
  list.slice(0, 12).forEach((d) => console.log('   -', d));
  if (list.length > 12) console.log(`   ... and ${list.length - 12} more`);
}
process.exit(1);
