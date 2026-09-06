/**
 * Israel by Rail: live delays proxy. A Cloudflare Worker (free plan is plenty).
 *
 * The journey planner behind rail.co.il refuses browsers on other sites, so
 * this worker asks it instead, once a minute at most, for a handful of
 * end-to-end journeys that together touch every passenger line. It folds the
 * answers into one small digest and serves it to the page with CORS.
 *
 * Deploy: Cloudflare dashboard > Workers & Pages > Create > Worker, paste this
 * file, Deploy. The worker's URL then goes in the page: ?live=https://....workers.dev
 *
 * Digest: { fetched, stations: { id: [lat, lon] }, trains: { number: { delay, cur, next, upd, stops: [[stationId, 'HH:MM'], ...] } } }
 */
const RAIL_API = 'https://rail-api.rail.co.il';
const RAIL_KEY = '5e64d66cf03f4547bcac5de2de06b566';        // the public web app's key
const PAIRS = [
  [1600, 7320],   // Nahariya - Beer Sheva Center: the coast, Ayalon, the south
  [1840, 400],    // Karmiel - Modiin Center: Galilee, Haifa, Ben Gurion, Modiin
  [680, 3500],    // Jerusalem Yitzhak Navon - Herzliya: the fast line and Tel Aviv
  [1280, 3700],   // Beit Shean - Tel Aviv Savidor: the valley line
  [2300, 5900],   // Haifa Hof HaCarmel - Ashkelon: coast to the south coast
  [8700, 9100],   // Kfar Saba Nordau - Rishon LeZion HaRishonim: the Sharon line
  [7500, 3700],   // Dimona - Tel Aviv Savidor: the Negev
  [9700, 3700],   // Ofakim - Tel Aviv Savidor: Sderot and Netivot
  [6700, 6300],   // Jerusalem Malha - Beit Shemesh: the old Jerusalem line
  [9800, 3500],   // Rishon LeZion Moshe Dayan - Herzliya: Ayalon suburban
  [2940, 4690],   // Raanana West - Bat Yam Komemiyut: the Raanana line
  [1300, 5800],   // Hutzot HaMifratz - Ashdod Ad Halom
];
const TTL_S = 60;                 // how old the digest may get before the API is asked again
const STATIONS_TTL_S = 86400;

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

let cache = { at: 0, body: null };
let stationsCache = { at: 0, data: null };

async function build() {
  if (Date.now() - stationsCache.at > STATIONS_TTL_S * 1000) stationsCache = { at: Date.now(), data: await fetchStations() };
  const lists = await Promise.all(PAIRS.map(([a, b]) => searchTrains(a, b).catch(() => [])));
  if (!lists.some((l) => l.length)) throw new Error('rail api: no journeys answered');
  return JSON.stringify(digest(lists, stationsCache.data));
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/live') return new Response('Israel by Rail live proxy: GET /live', { status: 404, headers: cors });
    try {
      if (!cache.body || Date.now() - cache.at > TTL_S * 1000) cache = { at: Date.now(), body: await build() };
      return new Response(cache.body, { headers: { ...cors, 'cache-control': `public, max-age=${TTL_S}` } });
    } catch (e) {
      if (cache.body) return new Response(cache.body, { headers: { ...cors, 'x-stale': '1' } });
      return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 502, headers: cors });
    }
  },
};
