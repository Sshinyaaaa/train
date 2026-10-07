// Shareable search state in the URL, and "now" in Malaysia time (PLAN.md §4h). Pure module.
//
// ?from=rapid:KJ10&to=ktmb:19205&day=weekday&time=08:30
//   station: its id without the "st:" prefix (st:rapid:KJ10 -> rapid:KJ10)
//   typed place: "lat,lon" (5 decimals, ~1 m) plus fromName / toName
//   current location: always "here", never coordinates; "here" asks for the location again on load

export const DAYS = ["weekday", "saturday", "sunday"];
const COORDS = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_NAME = 120;

export function encodeEndpoint(ep) {
  if (!ep) return null;
  if (ep.geo) return "here";
  if (ep.type === "station") return ep.id.replace(/^st:/, "");
  return `${ep.lat.toFixed(5)},${ep.lon.toFixed(5)}`;
}

// {from, to, day, time} -> URLSearchParams (missing parts left out)
export function stateToParams({ from, to, day, time }) {
  const p = new URLSearchParams();
  for (const [role, ep] of [["from", from], ["to", to]]) {
    const v = encodeEndpoint(ep);
    if (!v) continue;
    p.set(role, v);
    if (ep.type === "place" && !ep.geo && ep.name) p.set(`${role}Name`, ep.name.slice(0, MAX_NAME));
  }
  if (DAYS.includes(day)) p.set("day", day);
  if (time && TIME.test(time)) p.set("time", time);
  return p;
}

// Readable query string: ":" and "," are legal in a query, so keep them unescaped.
export const queryString = (state) => stateToParams(state).toString().replace(/%3A/gi, ":").replace(/%2C/gi, ",");

// URLSearchParams (or query string) -> {from, to, day, time}; anything invalid comes back null.
// Endpoints: {type: "station", id} | {type: "place", lat, lon, name} | {type: "here"}.
export function paramsToState(params, net) {
  const p = typeof params === "string" ? new URLSearchParams(params) : params;
  const endpoint = (role) => {
    const v = (p.get(role) || "").trim();
    if (!v) return null;
    if (v === "here") return { type: "here" };
    const m = v.match(COORDS);
    if (m) {
      const lat = Number(m[1]), lon = Number(m[2]);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      const name = (p.get(`${role}Name`) || "").trim().slice(0, MAX_NAME) || "Shared place";
      return { type: "place", lat, lon, name };
    }
    const id = v.startsWith("st:") ? v : `st:${v}`;
    if (net.stations[id]) return { type: "station", id };
    // a line-stop id also works (e.g. a station that was merged into a bigger one later)
    const viaStop = net.stops[v]?.station;
    return viaStop ? { type: "station", id: viaStop } : null;
  };
  const day = p.get("day");
  const time = p.get("time");
  return {
    from: endpoint("from"),
    to: endpoint("to"),
    day: DAYS.includes(day) ? day : null,
    time: time && TIME.test(time) ? time : null,
  };
}

export const hasSearchParams = (params) => {
  const p = typeof params === "string" ? new URLSearchParams(params) : params;
  return ["from", "to", "day", "time"].some((k) => p.has(k));
};

// Current day type and time in Kuala Lumpur (the device may be in another time zone).
// Before 04:00 the trains still running belong to the previous day's service (GTFS times past
// 24:00), so the previous day's type is used; the router tries early times as +24 h.
export function nowInKL(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const order = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let wd = order.indexOf(parts.weekday);
  const hour = Number(parts.hour);
  if (hour < 4) wd = (wd + 6) % 7;
  return { day: wd === 0 ? "sunday" : wd === 6 ? "saturday" : "weekday", time: `${parts.hour}:${parts.minute}` };
}
