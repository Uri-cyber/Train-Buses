/**
 * Live delays from Israel Railways.
 *
 * There is no public feed of train positions, but the journey planner behind
 * rail.co.il answers with every train of the day between two stations, and
 * each train that is out on the line carries a `trainPosition`: how many
 * minutes late it is, the last station it passed and the next one. Asking for
 * a handful of end-to-end journeys covers nearly the whole network.
 *
 * Two ways to reach it:
 *   direct  the browser posts to rail-api.rail.co.il itself (works when the
 *           API allows other sites, which is checked at run time)
 *   proxy   ?live=<url> or LIVE_URL: a tiny server (worker/rail-live.js) that
 *           polls the API once for everybody and serves the digest below
 *
 * Both produce the same digest:
 *   { fetched, stations: { id: [lat, lon] }, trains: { number: { delay, cur, next, upd, stops: [[stationId, 'HH:MM'], ...] } } }
 */
export const RAIL_API = 'https://rail-api.rail.co.il';
export const RAIL_KEY = '5e64d66cf03f4547bcac5de2de06b566';        // the public web app's key

/** end-to-end journeys that together touch every passenger line (Israel Railways station ids) */
export const PAIRS = [
  [1600, 7300],   // Nahariya - Beer Sheva Center: the coast, Ayalon, the south
  [1820, 400],    // Karmiel - Modiin Center: Galilee, Haifa, Ben Gurion, Modiin
  [680, 3500],    // Jerusalem Yitzhak Navon - Herzliya: the fast line and Tel Aviv
  [1840, 3700],   // Beit Shean - Tel Aviv Savidor: the valley line
  [2300, 5800],   // Haifa Hof HaCarmel - Ashkelon: coast to the south coast
  [8700, 9800],   // Kfar Saba Nordau - Rishon LeZion HaRishonim: Sharon line
  [7500, 3700],   // Dimona - Tel Aviv: the Negev
  [1220, 6300],   // Hutzot HaMifratz - Ashdod Ad Halom
];

const railDay = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
};

const headers = { 'content-type': 'application/json', accept: 'application/json', 'ocp-apim-subscription-key': RAIL_KEY };

/** one journey search: the whole day's trains between two stations */
export async function searchTrains(from, to, fetchFn = fetch) {
  const { date, hour } = railDay();
  const r = await fetchFn(`${RAIL_API}/rjpa/api/v1/timetable/searchTrain`, {
    method: 'POST', headers,
    body: JSON.stringify({ fromStation: String(from), toStation: String(to), date, hour, scheduleType: 'ByDeparture', systemType: '2', languageId: 'Hebrew' }),
  });
  if (!r.ok) throw new Error(`rail api ${r.status}`);
  const d = await r.json();
  return d?.result?.travels || [];
}

export async function fetchStations(fetchFn = fetch) {
  const r = await fetchFn(`${RAIL_API}/common/api/v1/stations?languageId=Hebrew&systemType=2`, { headers });
  if (!r.ok) throw new Error(`rail api stations ${r.status}`);
  const d = await r.json();
  const out = {};
  for (const s of d?.result || []) out[s.stationId] = [s.location?.latitude, s.location?.lontitude ?? s.location?.longitude];
  return out;
}

/** fold journey searches into the digest; trains seen twice are kept once */
export function digest(travelLists, stations, fetched = Date.now()) {
  const trains = {};
  for (const travels of travelLists) {
    for (const tv of travels || []) {
      for (const t of tv.trains || []) {
        const n = t.trainNumber;
        if (!n || trains[n]) continue;
        const p = t.trainPosition;
        trains[n] = {
          delay: p ? +p.calcDiffMinutes || 0 : null,          // null: not out on the line yet (or already done)
          cur: p ? p.currentLastStation ?? null : null,
          next: p ? p.nextStation ?? null : null,
          upd: p ? `${p.updateDate || ''} ${p.updateTime || ''}`.trim() : null,
          stops: (t.routeStations || []).map((s) => [s.stationId, s.arrivalTime]),
        };
      }
    }
  }
  return { fetched, stations, trains };
}

/** gather the digest straight from the API (browser or worker) */
export async function gatherLive(fetchFn = fetch, stations = null) {
  const st = stations || await fetchStations(fetchFn);
  const lists = await Promise.all(PAIRS.map(([a, b]) => searchTrains(a, b, fetchFn).catch(() => [])));
  if (!lists.some((l) => l.length)) throw new Error('rail api: no journeys answered');
  return digest(lists, st);
}

/**
 * Keep a digest fresh. `source` is a proxy URL, or 'direct'. The callback
 * gets every new digest; `status` tells the HUD what is going on.
 */
export function createLive({ source, every = 120, onData }) {
  let timer = null, status = { state: 'idle', trains: 0, positioned: 0, error: null, fetched: 0 };
  let stationsCache = null;
  const tick = async () => {
    try {
      let d;
      if (source === 'direct') { d = await gatherLive(fetch, stationsCache); stationsCache = d.stations; }
      else {
        const r = await fetch(source, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`live ${r.status}`);
        d = await r.json();
      }
      const list = Object.values(d.trains || {});
      status = { state: 'ok', trains: list.length, positioned: list.filter((t) => t.delay !== null).length, error: null, fetched: d.fetched };
      onData?.(d);
    } catch (e) {
      status = { ...status, state: 'error', error: String(e?.message || e) };
    }
  };
  return {
    get status() { return status; },
    start() { if (!timer) { tick(); timer = setInterval(tick, every * 1000); } },
    stop() { clearInterval(timer); timer = null; },
    refresh: tick,
  };
}
