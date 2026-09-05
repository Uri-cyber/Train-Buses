/**
 * OpenStreetMap via the Overpass API: the queries and the parser that turns
 * Overpass JSON into the projected rails and stations buildNetwork expects.
 * Pure JS, shared by scripts/fetch-osm.mjs (Node) and src/osm.js (browser).
 *
 * Data (c) OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright
 */
import { makeProjection, makeMask, dist } from './geo.js';

export const bboxString = (world) => { const { lat0, lon0, lat1, lon1 } = world.bbox; return `${lat0},${lon0},${lat1},${lon1}`; };

export const QUERIES = {
  // running lines only: no yard/siding/spur tracks, no preserved lines
  rails: (bbox) => `[out:json][timeout:240];
  way["railway"="rail"][!"service"]["railway:preserved"!="yes"](${bbox});
  out geom;`,
  stations: (bbox) => `[out:json][timeout:180];
  ( node["railway"="station"](${bbox}); way["railway"="station"](${bbox}); node["railway"="halt"](${bbox}); );
  out center tags;`,
};

const slug = (s) => s.toLowerCase().replace(/['’"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @param railsJson     Overpass response for QUERIES.rails
 * @param stationsJson  Overpass response for QUERIES.stations
 * @param world         data/world.json (projection + masks)
 * @param curated       the curated station list; OSM stations near one of them
 *                      take its id so the route definitions keep working
 */
export function parseOverpass({ railsJson, stationsJson, world, curated }) {
  const P = makeProjection(world.proj);
  const mask = makeMask(world);
  const inIsrael = (lon, lat) => { const [x, z] = P.toXZ(lon, lat); return mask.nearIsrael(x, z, 2); };

  const rails = [];
  for (const w of railsJson.elements || []) {
    if (w.type !== 'way' || !w.geometry) continue;
    const pts = w.geometry.filter((g) => inIsrael(g.lon, g.lat)).map((g) => P.toXZ(g.lon, g.lat).map(r3));
    if (pts.length < 2) continue;
    const t = w.tags || {};
    rails.push({ id: w.id, pts, tunnel: t.tunnel === 'yes', bridge: !!t.bridge, name: t.name || '', line: t['name:en'] || t.name || 'osm', real: true });
  }

  const curatedXZ = (curated || []).map((c) => ({ ...c, p: c.x !== undefined ? [c.x, c.z] : P.toXZ(c.lon, c.lat) }));
  const stations = [];
  const seen = new Set();
  for (const e of stationsJson.elements || []) {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    const t = e.tags || {};
    if (lat === undefined || !inIsrael(lon, lat)) continue;
    if (t.subway === 'yes' || t.light_rail === 'yes' || t.tram === 'yes' || t.station === 'light_rail' || t.station === 'subway') continue;
    const he = t['name:he'] || t.name || '';
    const en = t['name:en'] || t.int_name || '';
    if (!he && !en) continue;
    const [x, z] = P.toXZ(lon, lat);
    let id = null;
    for (const c of curatedXZ) if (dist(c.p, [x, z]) < 3 && !seen.has(c.id)) { id = c.id; break; }
    if (!id) id = slug(en) || `osm-${e.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    stations.push({ id, he, en: en || he, x: r3(x), z: r3(z), osm: e.id, approx: false });
  }
  return { rails, stations };
}
