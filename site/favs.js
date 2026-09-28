// Favourites and recent trips (PLAN.md §4g). Pure module: works in the browser and in Node.
//
// Stored only in this browser (localStorage key klrail.favs), never sent anywhere. If storage is
// unavailable or throws, everything still works in memory for the current page (persistent: false).
// Current location is never stored, so it can't be saved or appear in a recent trip.

export const FAV_KEY = "klrail.favs";
export const MAX_RECENT = 5;
export const MAX_PLACES = 20;
export const MAX_NAME = 40;
const KIND_ORDER = { home: 0, work: 1, custom: 2 };

// A storage object that actually works (read + write), or null. Some browsers throw on access.
export function usableStorage(get) {
  try {
    const s = get();
    if (!s) return null;
    const k = "klrail.__probe";
    s.setItem(k, "1");
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export const sameEndpoint = (a, b) => Boolean(a && b && a.type === b.type &&
  (a.type === "station" ? a.id === b.id : a.lat === b.lat && a.lon === b.lon));

const storable = (ep) => Boolean(ep && !ep.geo && (
  (ep.type === "station" && typeof ep.id === "string") ||
  (ep.type === "place" && Number.isFinite(ep.lat) && Number.isFinite(ep.lon))));

// Only the fields worth keeping (no cached walks, no flags).
const clean = (ep) => (ep.type === "station"
  ? { type: "station", id: ep.id }
  : { type: "place", lat: ep.lat, lon: ep.lon, name: String(ep.name || "Place").slice(0, 120) });

// storage: a Storage-like object or null. isValid(ep): e.g. "station id still in network.json".
export function createFavStore(storage, { isValid = () => true } = {}) {
  const ok = (ep) => storable(ep) && isValid(ep);
  let data = { v: 1, places: [], trips: [] };
  if (storage) {
    try {
      const s = JSON.parse(storage.getItem(FAV_KEY) || "null");
      if (s && s.v === 1) {
        data.places = (Array.isArray(s.places) ? s.places : [])
          .filter((p) => p && KIND_ORDER[p.kind] !== undefined && typeof p.label === "string" && p.label && ok(p.ep))
          .map((p) => ({ kind: p.kind, label: p.label.slice(0, MAX_NAME), ep: clean(p.ep) }))
          .slice(0, MAX_PLACES);
        data.trips = (Array.isArray(s.trips) ? s.trips : [])
          .filter((t) => t && ok(t.from) && ok(t.to) && !sameEndpoint(t.from, t.to))
          .map((t) => ({ from: clean(t.from), to: clean(t.to) }))
          .slice(0, MAX_RECENT);
      }
    } catch { /* corrupt entry: start empty */ }
  }
  let persistent = Boolean(storage);
  const persist = () => {
    if (!storage) return;
    try { storage.setItem(FAV_KEY, JSON.stringify(data)); } catch { persistent = false; }
  };
  const sortPlaces = () => data.places.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    (a.kind === "custom" ? a.label.localeCompare(b.label) : 0));

  return {
    get persistent() { return persistent; },
    places: () => data.places.map((p) => ({ ...p, ep: { ...p.ep } })),
    trips: () => data.trips.map((t) => ({ from: { ...t.from }, to: { ...t.to } })),

    // kind: "home" | "work" | "custom". Returns {ok: true} or {ok: false, error}.
    savePlace(kind, name, ep) {
      if (KIND_ORDER[kind] === undefined) return { ok: false, error: "Unknown kind." };
      if (ep?.geo) return { ok: false, error: "Current location can't be saved. Pick a station or place." };
      if (!ok(ep)) return { ok: false, error: "Pick a station or place first." };
      const label = kind === "home" ? "Home" : kind === "work" ? "Work" : String(name || "").trim().slice(0, MAX_NAME);
      if (!label) return { ok: false, error: "Enter a name." };
      const same = (p) => (kind === "custom" ? p.kind === "custom" && p.label.toLowerCase() === label.toLowerCase() : p.kind === kind);
      const rest = data.places.filter((p) => !same(p));
      if (rest.length >= MAX_PLACES) return { ok: false, error: `At most ${MAX_PLACES} saved places. Remove one first.` };
      data.places = [...rest, { kind, label, ep: clean(ep) }];
      sortPlaces();
      persist();
      return { ok: true, label };
    },

    removePlace(label) {
      data.places = data.places.filter((p) => p.label !== label);
      persist();
    },

    // Newest first, no duplicates, at most MAX_RECENT. Skips current location and from == to.
    addTrip(from, to) {
      if (!ok(from) || !ok(to) || sameEndpoint(from, to)) return false;
      const t = { from: clean(from), to: clean(to) };
      const first = data.trips[0];
      if (first && sameEndpoint(first.from, t.from) && sameEndpoint(first.to, t.to)) return false;   // no-op
      data.trips = [t, ...data.trips.filter((x) => !(sameEndpoint(x.from, t.from) && sameEndpoint(x.to, t.to)))].slice(0, MAX_RECENT);
      persist();
      return true;
    },

    removeTrip(i) {
      data.trips = data.trips.filter((_, j) => j !== i);
      persist();
    },

    clearAll() {
      data = { v: 1, places: [], trips: [] };
      if (storage) { try { storage.removeItem(FAV_KEY); } catch { persistent = false; } }
    },
  };
}
