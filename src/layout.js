// Single source of truth for where everything sits on the baseboard.
// Every module reads these numbers; scripts/overlap-check.mjs asserts against them.
export const BOARD = { w: 3.60, d: 2.20, x0: -1.80, x1: 1.80, z0: -1.10, z1: 1.10 };
export const TABLE_TOP_Y = 0.95;   // baseboard sits at world y = 0, table structure below
export const EYE_Y = 0.80;         // standing eye height above the baseboard
export const EYE_Z = 1.72;         // just behind the front edge of the table

// Main line: a stadium loop (two straights + two semicircles)
export const LOOP = {
  cz: -0.10,        // centre line in Z
  halfX: 0.85,      // half length of the straights
  r: 0.45,          // semicircle radius
  zFront: 0.35,     // cz + r
  zBack: -0.55,     // cz - r
  // 1 world unit ~ 90 m of prototype, so standard gauge is ~0.016 across the
  // rail heads; `gauge` is the half-offset from the centreline.
  gauge: 0.0080,
  ballastHalf: 0.030,
  railTopY: 0.0105,
};

export const ZONES = {
  hill:      { x0: -1.80, x1: -1.02, z0: -0.78, z1: 0.58 },
  tunnelX:   -1.02,                       // bore where track x < this
  factory:   { x0: -1.02, x1: -0.15, z0: -1.06, z1: -0.70 },
  harbour:   { x0: 0.30, x1: 1.78, z0: -1.095, z1: -0.700 },
  waterZ1:   -0.865,                      // quay edge; water lies north of it
  quayRailZ: [-0.845, -0.725],            // the two crane rails on the quay
  craneX:    [0.62, 1.10],                // gantry positions along the quay
  townFront: { x0: -1.00, x1: 1.36, z0: 0.62, z1: 0.84 },
  townRight: { x0: 1.58, x1: 1.78, z0: -0.40, z1: 0.84 },
  roadFront: { z: 0.545, half: 0.055 },   // road runs along X
  roadRight: { x: 1.49, half: 0.055 },    // road runs along Z
  station:   { x0: -0.70, x1: 0.10, z0: 0.10, z1: 0.25 },
  // the shed sits behind the turntable so neither hides the other from the front
  shed:      { x0: 0.28, x1: 0.74, z0: -0.45, z1: -0.30 },
  turntable: { cx: 0.50, cz: -0.10, r: 0.18 },
  sidings:   [-0.02, -0.14, -0.26],
  sidingX0:  -0.75, sidingX1: 0.10,
};

export const DESK = { z0: 0.88, z1: 1.12, y: 0.02, x0: -0.62, x1: 0.62 };
