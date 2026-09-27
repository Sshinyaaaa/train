// Real walking distances from a typed place to candidate station stops (PLAN.md §4e).
// One OSRM `table` request per place (all its candidate stops at once), queued so requests are at
// least `osrmMinIntervalMs` apart, cached for the session, with a timeout. Any failure returns
// null, and the router then falls back to the straight-line estimate ("estimated walk").

// Cache survives reloads within the tab (sessionStorage); after HTTP 429 the service is left alone
// for `osrmBackoffMs` (estimates are used meanwhile).
const STORE_KEY = "klrail.walks";

export function createWalkService(config, { fetchImpl = (...a) => fetch(...a), now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  storage = (typeof sessionStorage !== "undefined" ? sessionStorage : null) } = {}) {
  const cache = new Map();          // key -> { at, walks }
  try { for (const [k, v] of Object.entries(JSON.parse(storage?.getItem(STORE_KEY) || "{}"))) cache.set(k, v); } catch {}
  const persist = () => {
    try {
      const fresh = [...cache].filter(([, v]) => now() - v.at < config.walkCacheMs).slice(-50);
      storage?.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(fresh)));
    } catch {}
  };
  let queue = Promise.resolve();
  let lastAt = -Infinity;
  let blockedUntil = -Infinity;
  const stats = { requests: 0, cacheHits: 0, failures: 0, backoffSkips: 0 };

  const enabled = () => Boolean(config.contactEmail && config.osrmFootUrl);

  // place: {lat, lon}; stops: [{id, lat, lon}] (max a handful). Returns {stopId: {dist_m}} or null.
  async function walksFrom(place, stops) {
    if (!enabled() || !stops.length) return null;
    const key = `${place.lat.toFixed(5)},${place.lon.toFixed(5)}|${stops.map((s) => s.id).sort().join(",")}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < config.walkCacheMs) { stats.cacheHits++; return hit.walks; }

    const run = async () => {
      if (now() < blockedUntil) { stats.backoffSkips++; return null; }
      const wait = lastAt + config.osrmMinIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastAt = now();
      stats.requests++;
      const coords = [place, ...stops].map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
      const url = `${config.osrmFootUrl}/table/v1/driving/${coords}?sources=0&annotations=distance`;
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), config.osrmTimeoutMs) : null;
      try {
        const res = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : {});
        if (res.status === 429) blockedUntil = now() + (config.osrmBackoffMs ?? 60000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.code !== "Ok" || !Array.isArray(data.distances?.[0])) throw new Error(`OSRM ${data.code}`);
        const walks = {};
        stops.forEach((s, i) => {
          const d = data.distances[0][i + 1];
          if (Number.isFinite(d)) walks[s.id] = { dist_m: d };
        });
        cache.set(key, { at: now(), walks });
        persist();
        return walks;
      } catch {
        stats.failures++;
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  return { walksFrom, enabled, stats };
}
