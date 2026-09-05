/**
 * Geometry shared by the app and the data scripts (plain JS, no three.js):
 * the projection defined in data/world.json and the run-length-encoded masks.
 *
 * World units: 1 = 1 km. +x is east, +z is south (three.js z points at the
 * viewer, so north is -z and the map reads correctly from above).
 */

export function makeProjection(proj) {
  return {
    toXZ: (lon, lat) => [(lon - proj.lon0) * proj.kx, -(lat - proj.lat0) * proj.kz],
    toLonLat: (x, z) => [x / proj.kx + proj.lon0, -z / proj.kz + proj.lat0],
  };
}

export function decodeRle(rle, length) {
  const out = new Uint8Array(length);
  let k = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const v = rle[i], n = rle[i + 1];
    out.fill(v, k, k + n);
    k += n;
  }
  return out;
}

/**
 * Sampler over the country/lake rasters. `x, z` are world units.
 * Row 0 of the raster is the north edge of the bounding box.
 */
export function makeMask(world) {
  const { mask, bbox, proj } = world;
  const { w, h, cell } = mask;
  const ids = decodeRle(mask.ids, w * h);
  const lake = decodeRle(mask.lake, w * h);
  const P = makeProjection(proj);
  const cellOf = (x, z) => {
    const [lon, lat] = P.toLonLat(x, z);
    const i = Math.floor((lon - bbox.lon0) / cell);
    const j = Math.floor((bbox.lat1 - lat) / cell);
    if (i < 0 || j < 0 || i >= w || j >= h) return -1;
    return j * w + i;
  };
  const country = (x, z) => { const c = cellOf(x, z); return c < 0 ? 0 : ids[c]; };
  const lakeId = (x, z) => { const c = cellOf(x, z); return c < 0 ? 0 : lake[c]; };
  const isLand = (x, z) => country(x, z) !== 0 && lakeId(x, z) === 0;
  const isIsrael = (x, z) => country(x, z) === mask.israelId && lakeId(x, z) === 0;
  /** true when any cell within `r` cells is land (coast-hugging track is not "in the water") */
  const isLandNear = (x, z, r = 3) => {
    const [lon, lat] = P.toLonLat(x, z);
    const ci = Math.floor((lon - bbox.lon0) / cell), cj = Math.floor((bbox.lat1 - lat) / cell);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      if (ids[j * w + i] !== 0 && lake[j * w + i] === 0) return true;
    }
    return false;
  };
  /** true when any cell within `r` cells is Israel: forgiving at borders and the coast */
  const nearIsrael = (x, z, r = 2) => {
    const [lon, lat] = P.toLonLat(x, z);
    const ci = Math.floor((lon - bbox.lon0) / cell), cj = Math.floor((bbox.lat1 - lat) / cell);
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        if (ids[j * w + i] === mask.israelId) return true;
      }
    }
    return false;
  };
  /** distance in km to the nearest non-land cell, capped at `maxKm` (coarse, for coast tinting) */
  const seaDistance = (x, z, maxKm = 6) => {
    const step = cell * 111;                       // km per cell, roughly
    const r = Math.ceil(maxKm / step);
    const [lon, lat] = P.toLonLat(x, z);
    const ci = Math.floor((lon - bbox.lon0) / cell), cj = Math.floor((bbox.lat1 - lat) / cell);
    let best = maxKm;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        if (ids[j * w + i] === 0 || lake[j * w + i] !== 0) {
          const d = Math.hypot(di, dj) * step;
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
  return { w, h, cell, ids, lake, P, bbox, israelId: mask.israelId, cellOf, country, lakeId, isLand, isLandNear, isIsrael, nearIsrael, seaDistance };
}

/* ------------------------------------------------------------ polylines */

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** nearest point on segment ab to p: returns { t, d, x, z } */
export function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  const x = a[0] + t * dx, z = a[1] + t * dz;
  return { t, d: Math.hypot(p[0] - x, p[1] - z), x, z };
}

/** nearest point on a polyline: { seg, t, d, x, z } */
export function nearestOnPolyline(p, pts) {
  let best = { d: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const r = nearestOnSegment(p, pts[i - 1], pts[i]);
    if (r.d < best.d) best = { ...r, seg: i - 1 };
  }
  return best;
}

/** Catmull-Rom through control points, sampled every `step` km. */
export function catmullRom(ctrl, step = 0.25) {
  if (ctrl.length < 2) return ctrl.slice();
  const pts = [];
  const P = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const n = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      pts.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  pts.push(ctrl[ctrl.length - 1].slice());
  return pts;
}

/** Arc-length lookup table over a polyline: at(d) -> { x, z, tx, tz } (tangent unit). */
export function makePathLookup(pts) {
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + dist(pts[i - 1], pts[i]);
  const length = cum[pts.length - 1];
  return {
    length,
    at(d) {
      d = Math.max(0, Math.min(length, d));
      let lo = 0, hi = pts.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
      const a = pts[lo], b = pts[Math.min(hi, pts.length - 1)];
      const segLen = cum[hi] - cum[lo] || 1e-9;
      const t = (d - cum[lo]) / segLen;
      const tx = (b[0] - a[0]) / segLen, tz = (b[1] - a[1]) / segLen;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx, tz };
    },
  };
}

/**
 * Chamfer distance transform over the mask grid: distance in km from every
 * cell to the nearest cell where `pred(cellIndex)` is true. Two passes, O(n).
 */
export function distanceTransform(mask, pred) {
  const { w, h, cell } = mask;
  const km = cell * 111;                          // one cell edge, roughly, in km
  const D = new Float32Array(w * h).fill(1e9);
  for (let i = 0; i < w * h; i++) if (pred(i)) D[i] = 0;
  const d1 = 1, d2 = Math.SQRT2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (i > 0) D[k] = Math.min(D[k], D[k - 1] + d1);
      if (j > 0) { D[k] = Math.min(D[k], D[k - w] + d1);
        if (i > 0) D[k] = Math.min(D[k], D[k - w - 1] + d2);
        if (i < w - 1) D[k] = Math.min(D[k], D[k - w + 1] + d2); }
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      if (i < w - 1) D[k] = Math.min(D[k], D[k + 1] + d1);
      if (j < h - 1) { D[k] = Math.min(D[k], D[k + w] + d1);
        if (i < w - 1) D[k] = Math.min(D[k], D[k + w + 1] + d2);
        if (i > 0) D[k] = Math.min(D[k], D[k + w - 1] + d2); }
    }
  }
  for (let i = 0; i < D.length; i++) D[i] *= km;
  return D;
}

/** Bilinear sample of a mask-grid field at world (x, z). */
export function sampleField(mask, field, x, z) {
  const { w, h, cell } = mask;
  const [lon, lat] = mask.P.toLonLat(x, z);
  const fi = (lon - mask.bbox.lon0) / cell - 0.5, fj = (mask.bbox.lat1 - lat) / cell - 0.5;
  const i0 = Math.max(0, Math.min(w - 2, Math.floor(fi))), j0 = Math.max(0, Math.min(h - 2, Math.floor(fj)));
  const tx = Math.max(0, Math.min(1, fi - i0)), tz = Math.max(0, Math.min(1, fj - j0));
  const a = field[j0 * w + i0], b = field[j0 * w + i0 + 1], c = field[(j0 + 1) * w + i0], d = field[(j0 + 1) * w + i0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
