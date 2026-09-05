import { QUERIES, bboxString, parseOverpass } from './osm-parse.js';

/**
 * The live network, fetched by the browser itself from the Overpass API
 * (OpenStreetMap), parsed, and kept in IndexedDB for a week. Falls back to
 * the bundled map when every mirror fails, so the page always works.
 *
 * Data (c) OpenStreetMap contributors, ODbL.
 */
export const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const DB = 'israel-by-rail', STORE = 'osm', KEY = 'network-v1';
const MAX_AGE = 7 * 24 * 3600 * 1000;

function idb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return resolve(null);
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet() {
  try {
    const db = await idb(); if (!db) return null;
    return await new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  } catch { return null; }
}
async function idbPut(value) {
  try {
    const db = await idb(); if (!db) return;
    await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch { /* storage is a nice-to-have */ }
}

/** POST a query to the first mirror that answers. */
export async function fetchOverpass(query, { timeoutMs = 150000, onStatus = () => {} } = {}) {
  let lastErr = null;
  for (const url of MIRRORS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      onStatus('mirror', url);
      const res = await fetch(url, {
        method: 'POST', body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      const json = await res.json();
      if (json.remark && /timed out|error/i.test(json.remark) && !(json.elements || []).length) throw new Error(json.remark);
      return json;
    } catch (e) { lastErr = e; }
    finally { clearTimeout(timer); }
  }
  throw lastErr || new Error('no Overpass mirror answered');
}

/**
 * @returns { rails, stations, fetched, source: 'cache' | 'live' | 'fixture' } or null
 */
export async function loadLiveNetwork({ world, curated, onStatus = () => {}, force = false, fixtureUrl = null }) {
  if (fixtureUrl) {
    onStatus('fetching', fixtureUrl);
    const j = await (await fetch(fixtureUrl)).json();
    const parsed = parseOverpass({ railsJson: j.rails, stationsJson: j.stations, world, curated });
    return { ...parsed, fetched: j.fetched || Date.now(), source: 'fixture' };
  }
  const cached = await idbGet();
  if (cached && !force && Date.now() - cached.fetched < MAX_AGE) return { ...cached, source: 'cache' };
  try {
    const bbox = bboxString(world);
    onStatus('fetching', 'rails');
    const railsJson = await fetchOverpass(QUERIES.rails(bbox), { onStatus });
    onStatus('fetching', 'stations');
    const stationsJson = await fetchOverpass(QUERIES.stations(bbox), { onStatus, timeoutMs: 90000 });
    const parsed = parseOverpass({ railsJson, stationsJson, world, curated });
    if (parsed.rails.length < 20 || parsed.stations.length < 20) throw new Error(`too little data: ${parsed.rails.length} ways, ${parsed.stations.length} stations`);
    const rec = { ...parsed, fetched: Date.now() };
    await idbPut(rec);
    return { ...rec, source: 'live' };
  } catch (e) {
    onStatus('failed', e?.message || String(e));
    if (cached) return { ...cached, source: 'cache' };       // stale beats nothing
    return null;
  }
}
