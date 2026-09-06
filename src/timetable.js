/**
 * The real Israel Railways timetable (see scripts/fetch-gtfs.mjs) and what
 * is running at a given moment. Service days come from the GTFS calendar,
 * the clock is Israel's, and a trip's position is interpolated between its
 * stops along the network.
 */
const DAY = 86400;

/** Israel's calendar date and weekday right now */
export function israelDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  const ymd = `${get('year')}${get('month')}${get('day')}`;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { ymd, weekday };
}
const shiftYmd = (ymd, days) => {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + days);
  return { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), weekday: d.getUTCDay() };
};

export async function loadTimetable(url = './timetable.json') {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    const t = await r.json();
    if (!t || !Array.isArray(t.trips) || t.trips.length < 20) return null;
    return t;
  } catch { return null; }
}

/** is this service running on the given YYYYMMDD / weekday? */
export function serviceRuns(svc, ymd, weekday) {
  if (!svc) return false;
  if (svc.drop?.includes(ymd)) return false;
  if (svc.add?.includes(ymd)) return true;
  return svc.days[weekday] === 1 && ymd >= svc.from && ymd <= svc.to;
}

/**
 * The trips that could be on the move on a given day: today's services, plus
 * yesterday's trips that run past midnight (their times shifted by a day).
 * Returns [{ trip, offset }] where offset is added to the trip's times.
 */
export function tripsForDay(timetable, ymd, weekday) {
  const out = [];
  const y = shiftYmd(ymd, -1);
  for (const trip of timetable.trips) {
    const svc = timetable.services[trip.service];
    if (serviceRuns(svc, ymd, weekday)) out.push({ trip, offset: 0 });
    if (trip.stops[trip.stops.length - 1][1] >= DAY && serviceRuns(svc, y.ymd, y.weekday)) out.push({ trip, offset: -DAY });
  }
  return out;
}

/** the share of a hop spent accelerating (and again braking): about 90 s, never less than 8% or more than 40% */
export const rampFraction = (secs) => Math.max(0.08, Math.min(0.4, 90 / Math.max(1, secs)));
/**
 * Trapezoid speed profile as a distance fraction: quadratic pull-away, steady
 * cruise, quadratic braking. f(0) = 0, f(1) = 1, smooth at both joins and
 * monotone for any ramp up to 0.4.
 */
export function tripCurve(u, secs) {
  const ra = rampFraction(secs), k = 1 - ra;
  if (u < ra) return u * u / (2 * ra * k);
  if (u > 1 - ra) return 1 - (1 - u) * (1 - u) / (2 * ra * k);
  return (u - ra / 2) / k;
}

/**
 * Where a trip is at time T (seconds after midnight): { i, f, stopped }
 * i = index of the stop just departed, f = 0..1 fraction to the next one,
 * phase = 'accel' | 'cruise' | 'brake' | 'stop' (toDep = seconds until departure);
 * null when the trip has not started or is finished.
 */
export function tripProgress(stops, T) {
  const first = stops[0], last = stops[stops.length - 1];
  if (T < first[2] - 45 || T > last[1] + 30) return null;
  for (let i = 0; i < stops.length - 1; i++) {
    const dep = stops[i][2], arr = stops[i + 1][1];
    if (T < dep) return { i, f: 0, stopped: true, phase: 'stop', toDep: dep - T };
    if (T < arr) {
      const u = (T - dep) / Math.max(1, arr - dep);
      return { i, f: tripCurve(u, arr - dep), stopped: false, phase: u < rampFraction(arr - dep) ? 'accel' : u > 1 - rampFraction(arr - dep) ? 'brake' : 'cruise' };
    }
  }
  return { i: stops.length - 1, f: 0, stopped: true, phase: 'stop', toDep: Infinity };
}

/** how many trips are moving at time T, for the status line and the quiet-hours fallback */
export function activeCount(dayTrips, T) {
  let n = 0;
  for (const { trip, offset } of dayTrips) if (tripProgress(trip.stops, T - offset)) n++;
  return n;
}
