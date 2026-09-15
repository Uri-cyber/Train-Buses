/**
 * Live delays from Israel Railways.
 *
 * There is no public feed of train positions, but the journey planner behind
 * rail.co.il answers with every train of the day between two stations, and
 * each train that is out on the line carries how many minutes late it is,
 * the last station it passed and the next one. That planner refuses browsers
 * on other sites, so a small proxy (worker/rail-live.js) asks it for every
 * origin-destination pair of the day and serves one digest:
 *
 *   { fetched, stations: { id: [lat, lon] }, pairs: { total, fresh, source },
 *     trains: { number: { delay, cur, next, upd, stops: [[stationId, 'HH:MM'], ...] } } }
 *
 * The page reads it with ?live=<proxy url> (or LIVE_URL in main.js).
 */

/** Keep a digest fresh: poll the proxy, hand every new digest to `onData`. */
export function createLive({ source, every = 60, onData }) {
  let timer = null, retry = null, fails = 0;
  let status = { state: 'idle', trains: 0, positioned: 0, error: null, fetched: 0, pairs: null };
  const tick = async () => {
    clearTimeout(retry); retry = null;
    try {
      const r = await fetch(source, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`live ${r.status}`);
      const d = await r.json();
      if (!d || !d.trains) throw new Error(d?.error || 'live: not a digest');
      const list = Object.values(d.trains);
      fails = 0;
      status = { state: 'ok', trains: list.length, positioned: list.filter((t) => t.delay !== null).length, error: null, fetched: d.fetched, pairs: d.pairs || null };
      onData?.(d);
    } catch (e) {
      status = { ...status, state: 'error', error: String(e?.message || e) };
      // The planner behind the proxy sometimes takes longer than its gateway allows and the
      // call comes back 504. Waiting a whole minute for the next poll would leave the first
      // screen without live trains, so try again soon, backing off to the normal interval.
      if (timer && fails < 4) { const wait = 2000 * 2 ** fails; fails++; retry = setTimeout(tick, Math.min(wait, every * 1000)); }
    }
  };
  return {
    get status() { return status; },
    start() { if (!timer) { tick(); timer = setInterval(tick, every * 1000); } },
    stop() { clearInterval(timer); clearTimeout(retry); timer = null; retry = null; },
    refresh: tick,
  };
}
