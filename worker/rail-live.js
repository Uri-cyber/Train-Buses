/**
 * Israel by Rail: live delays proxy. A Cloudflare Worker (free plan is plenty).
 *
 * The journey planner behind rail.co.il refuses browsers on other sites, so
 * this worker asks it instead, for every origin-destination pair in today's
 * timetable, each refreshed about once a minute in batches. It folds the
 * answers into one digest and serves it to the page with CORS.
 *
 * Deploy: Cloudflare dashboard > Workers & Pages > Create > Worker, paste this
 * file, Deploy. The worker's URL then goes in the page: ?live=https://....workers.dev
 *
 * Digest: { fetched, stations: { id: [lat, lon] }, trains: { number: { delay, cur, next, upd, stops: [[stationId, 'HH:MM'], ...] } } }
 */
const RAIL_API = 'https://rail-api.rail.co.il';
const RAIL_KEY = '5e64d66cf03f4547bcac5de2de06b566';        // the public web app's key
// A journey search only lists trains that call at both ends, so to see every
// train the worker asks about every origin-destination pair in the timetable.
// It learns those pairs from the page's own timetable.json a few times a day;
// until that loads, these end-to-end journeys cover most of the network.
const TIMETABLE_URL = 'https://uri-cyber.github.io/Train-Buses/timetable.json';
const FALLBACK_PAIRS = [
  [1600, 7320], [1840, 400], [680, 3500], [1280, 3700], [2300, 5900], [8700, 9100],
  [7500, 3700], [9700, 3700], [6700, 6300], [9800, 3500], [2940, 4690], [1300, 5800],
];
const MAX_REFRESH = 20;           // searches per request (the free plan allows 50 subrequests)
const TTL_S = 60;                 // how old the digest may get before the API is asked again
const STATIONS_TTL_S = 86400;
const PAIRS_TTL_S = 6 * 3600;

const headers = { 'content-type': 'application/json', accept: 'application/json', 'ocp-apim-subscription-key': RAIL_KEY, 'user-agent': 'Mozilla/5.0 (israel-by-rail live proxy)' };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*', 'content-type': 'application/json; charset=utf-8' };

const railDay = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
};

async function searchTrains(from, to) {
  const { date, hour } = railDay();
  const r = await fetch(`${RAIL_API}/rjpa/api/v1/timetable/searchTrain`, {
    method: 'POST', headers,
    body: JSON.stringify({ fromStation: String(from), toStation: String(to), date, hour, scheduleType: 'ByDeparture', systemType: '2', languageId: 'Hebrew' }),
  });
  if (!r.ok) throw new Error(`rail api ${r.status}`);
  return (await r.json())?.result?.travels || [];
}

async function fetchStations() {
  const r = await fetch(`${RAIL_API}/common/api/v1/stations?languageId=Hebrew&systemType=2`, { headers });
  if (!r.ok) throw new Error(`rail api stations ${r.status}`);
  const out = {};
  for (const s of (await r.json())?.result || []) out[s.stationId] = [s.location?.latitude, s.location?.lontitude ?? s.location?.longitude];
  return out;
}

function digest(travelLists, stations) {
  const trains = {};
  for (const travels of travelLists) for (const tv of travels) for (const t of tv.trains || []) {
    const n = t.trainNumber;
    if (!n || trains[n]) continue;
    const p = t.trainPosition;
    trains[n] = {
      delay: p ? +p.calcDiffMinutes || 0 : null,
      cur: p ? p.currentLastStation ?? null : null,
      next: p ? p.nextStation ?? null : null,
      upd: p ? `${p.updateDate || ''} ${p.updateTime || ''}`.trim() : null,
      stops: (t.routeStations || []).map((s) => [s.stationId, s.arrivalTime]),
    };
  }
  return { fetched: Date.now(), stations, trains };
}

let stationsCache = { at: 0, data: null };
let pairsCache = { at: 0, list: null, source: 'fallback' };
const searches = new Map();        // 'from-to' -> { at, travels }
let lastBody = null;

/** Israel's calendar date, for the timetable's service days */
function israelToday() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { ymd: `${g('year')}${g('month')}${g('day')}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')) };
}
const serviceRuns = (svc, ymd, weekday) => !!svc && !svc.drop?.includes(ymd) && (svc.add?.includes(ymd) || (svc.days[weekday] === 1 && ymd >= svc.from && ymd <= svc.to));

/** every origin-destination pair of today's trips, as Israel Railways station ids */
async function learnPairs(stations) {
  const r = await fetch(TIMETABLE_URL, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw new Error(`timetable ${r.status}`);
  const tt = await r.json();
  const ids = Object.keys(stations);
  const nearest = (lat, lon) => {
    let best = null, bd = 0.03;                      // about 3 km
    for (const id of ids) { const [la, lo] = stations[id]; const d = Math.hypot(la - lat, (lo - lon) * 0.85); if (d < bd) { bd = d; best = +id; } }
    return best;
  };
  const stopStation = {};
  for (const [id, st] of Object.entries(tt.stops)) stopStation[id] = nearest(st.lat, st.lon);
  const { ymd, weekday } = israelToday();
  const seen = new Set(), list = [];
  for (const trip of tt.trips) {
    if (!serviceRuns(tt.services[trip.service], ymd, weekday)) continue;
    const a = stopStation[trip.stops[0][0]], b = stopStation[trip.stops[trip.stops.length - 1][0]];
    if (!a || !b || a === b || seen.has(`${a}-${b}`)) continue;
    seen.add(`${a}-${b}`); list.push([a, b]);
  }
  if (list.length < 5) throw new Error('timetable: too few pairs');
  return list;
}

async function build() {
  const now = Date.now();
  if (now - stationsCache.at > STATIONS_TTL_S * 1000) stationsCache = { at: now, data: await fetchStations() };
  if (now - pairsCache.at > PAIRS_TTL_S * 1000) {
    try { pairsCache = { at: now, list: await learnPairs(stationsCache.data), source: 'timetable' }; }
    catch (e) { pairsCache = { at: now - PAIRS_TTL_S * 1000 + 600 * 1000, list: pairsCache.list || FALLBACK_PAIRS, source: `fallback (${e.message})` }; }
  }
  const pairs = pairsCache.list;
  // refresh the stalest searches, a batch per request, so no call exceeds the subrequest limit
  const stale = pairs.filter(([a, b]) => now - (searches.get(`${a}-${b}`)?.at || 0) > TTL_S * 1000)
    .sort((p, q) => (searches.get(`${p[0]}-${p[1]}`)?.at || 0) - (searches.get(`${q[0]}-${q[1]}`)?.at || 0)).slice(0, MAX_REFRESH);
  await Promise.all(stale.map(async ([a, b]) => {
    try { searches.set(`${a}-${b}`, { at: Date.now(), travels: await searchTrains(a, b) }); }
    catch { const old = searches.get(`${a}-${b}`); searches.set(`${a}-${b}`, { at: (old?.at || 0) + 15000, travels: old?.travels || [] }); }
  }));
  const lists = pairs.map(([a, b]) => searches.get(`${a}-${b}`)?.travels || []);
  if (!lists.some((l) => l.length)) throw new Error('rail api: no journeys answered');
  const d = digest(lists, stationsCache.data);
  d.pairs = { total: pairs.length, fresh: pairs.filter(([a, b]) => Date.now() - (searches.get(`${a}-${b}`)?.at || 0) <= TTL_S * 1000).length, source: pairsCache.source };
  return JSON.stringify(d);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/live') return new Response('Israel by Rail live proxy: GET /live', { status: 404, headers: cors });
    try {
      lastBody = await build();
      return new Response(lastBody, { headers: { ...cors, 'cache-control': 'public, max-age=20' } });
    } catch (e) {
      if (lastBody) return new Response(lastBody, { headers: { ...cors, 'x-stale': '1' } });
      return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 502, headers: cors });
    }
  },
};
