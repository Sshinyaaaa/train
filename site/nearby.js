// Nearest stations to a point (PLAN.md §4g). Pure: the point never leaves this function.
import { distanceM } from "./router.js";

// A station's distance is to its nearest line-stop (big interchanges span hundreds of metres).
// Returns [{station, dist_m}] closest first.
export function nearestStations(net, point, n = 5) {
  const out = [];
  for (const [id, st] of Object.entries(net.stations)) {
    let best = Infinity;
    for (const s of st.stops) best = Math.min(best, distanceM(point, net.stops[s]));
    out.push({ station: id, dist_m: best });
  }
  return out.sort((a, b) => a.dist_m - b.dist_m || a.station.localeCompare(b.station)).slice(0, n);
}
