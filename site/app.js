import { computeFares, fareSummary, FARE_TYPES, DEFAULT_FARE_TYPE } from "./fares.js";
import { CONFIG } from "./config.js";
import { createWalkService, walkAllowed } from "./walk.js";
import { createFavStore, usableStorage } from "./favs.js";
import { nearestStations } from "./nearby.js";
import { buildSearchIndex, searchIndex } from "./search.js";
import { queryString, paramsToState, hasSearchParams, nowInKL } from "./state.js";
import { routeSummaryText, lastTrainText, clock } from "./share.js";
import { loadNetwork, route, alternatives, suggestModes, blockedNearby, accessCandidates, linesNotRunning, DEFAULT_QUERY, MODES, MAX_WALK_OPTIONS, distanceM, walkSec } from "./router.js";

// Photon geocoder (PLAN.md §4b): only the typed text (plus a fixed Klang Valley bbox) is sent.
const PHOTON = "https://photon.komoot.io/api/";
const BBOX = "101.2,2.6,102.0,3.4"; // minLon,minLat,maxLon,maxLat
const DEBOUNCE_MS = 350;
const MIN_PLACE_CHARS = 3;
const ATTRIBUTION = `Places: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors`;

const ACRONYMS = new Set(["KL", "KLCC", "KLIA", "PWTC", "UOB", "USJ", "USJ7", "SS", "TRX", "UKM", "UPM", "IOI",
  "CBP", "BU", "BK", "UITM", "KTM", "T1", "T2", "SA", "MRT", "LRT", "DR"]);

const $ = (id) => document.getElementById(id);
let net, graph, stations = [];
// Endpoint per role: {type: "station", id} | {type: "place", lat, lon, name, geo?: true}
const picked = { from: null, to: null };
let favs;                 // favourites + recent trips (PLAN.md §4g), created once the network is loaded
const isOnline = () => navigator.onLine !== false;
let sortBy = "fastest";   // fastest | fewest | cheapest (PLAN.md §4f)
const walkService = createWalkService(CONFIG);
// Opt-in (off by default): send the current location to the walking-route service. Remembered locally.
let geoWalkOptIn = false;
try { geoWalkOptIn = localStorage.getItem("klrail.geoWalk") === "1"; } catch {}
// Fare type (PLAN.md §4d): cashless (default) / cash / concession. Remembered locally.
let fareType = DEFAULT_FARE_TYPE;
try { const v = localStorage.getItem("klrail.fareType"); if (FARE_TYPES.includes(v)) fareType = v; } catch {}
const FARE_TYPE_TEXT = { cashless: "Adult one-way, cashless", cash: "Adult one-way, cash", concession: "Concession, one-way" };
// Route filters (PLAN.md §4c): enabled modes + max first/last walk. Persisted per browser.
const DEFAULT_FILTERS = { modes: [...MODES], maxWalkM: DEFAULT_QUERY.maxWalkM };
let filters = { ...DEFAULT_FILTERS, modes: [...DEFAULT_FILTERS.modes] };
const filtersAreDefault = () => filters.modes.length === MODES.length && filters.maxWalkM === DEFAULT_FILTERS.maxWalkM;
const modeList = (ms) => MODES.filter((m) => ms.includes(m)).join(", ");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const color = (lid) => net.lines[lid].color || "#888";
const lineLabel = (lid) => net.lines[lid].display.label;   // e.g. "12 · MRT Putrajaya Line"
// Badge text on an official line colour: white or near-black, whichever has the higher WCAG
// contrast ratio (e.g. dark on Monorail green, white on Kelana Jaya red).
function relLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function ink(hex) {
  const L = relLum(hex);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / (relLum("#1c1c1c") + 0.05)) ? "#fff" : "#1c1c1c";
}
const badge = (lid) => `<span class="badge" style="background:${color(lid)};color:${ink(color(lid))}" title="${esc(lineLabel(lid))}">${esc(net.lines[lid].display.number)}</span>`;
const fmtMin = (m) => `${Math.round(m)} min`;
const fmtDist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

function pretty(name) {
  if (name !== name.toUpperCase()) return name; // manual names are already mixed case
  return name.split(/(\s+|-|\/)/).map((w) => {
    if (!/[A-Z]/.test(w)) return w;
    if (ACRONYMS.has(w) || /\d/.test(w)) return w;
    return w[0] + w.slice(1).toLowerCase();
  }).join("");
}

function stationLines(st) {
  const ids = [];
  for (const s of st.stops) for (const l of net.stops[s].lines) if (!ids.includes(l)) ids.push(l);
  // map order: 1..12, then B1
  const rank = (l) => { const n = net.lines[l].display.number; return /^\d+$/.test(n) ? Number(n) : 100; };
  return ids.sort((a, b) => rank(a) - rank(b));
}

function buildIndex() {
  stations = Object.entries(net.stations).map(([id, st]) => {
    const lines = stationLines(st);
    return { id, name: pretty(st.name), key: st.name.toLowerCase().replace(/[^a-z0-9]/g, ""), lines };
  });
  const counts = {};
  for (const s of stations) counts[s.name.toLowerCase()] = (counts[s.name.toLowerCase()] || 0) + 1;
  for (const s of stations) s.dup = counts[s.name.toLowerCase()] > 1;
  stations.sort((a, b) => a.name.localeCompare(b.name));
  searchIdx = buildSearchIndex(stations, net.aliases || []);
}

const badges = (lines) => `<span class="badges">${lines.map(badge).join("")}</span>`;
const linesText = (lines) => lines.map((l) => net.lines[l].display.name).join(", ");
const stationLabel = (s) => (s.dup ? `${s.name} (${linesText(s.lines)})` : s.name);
const stationById = (id) => stations.find((x) => x.id === id);
const endpointLabel = (e) => (!e ? "" : e.type === "station" ? stationLabel(stationById(e.id)) : e.name);

// Station names + aliases (overrides/aliases.json), typo-tolerant (PLAN.md §4h). [{s, alias}]
let searchIdx = [];
function searchStations(q) {
  return searchIndex(searchIdx, q).map((m) => ({ s: stationById(m.station), alias: m.alias })).filter((x) => x.s);
}

// --- Photon -------------------------------------------------------------------------------------
function placeName(p) {
  const main = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.street;
  const where = [p.district || p.locality, p.city].filter((x) => x && x !== main);
  return { main: main || "Unnamed place", where: [...new Set(where)].join(", ") };
}

async function geocode(q, signal) {
  const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=5&lang=en&bbox=${BBOX}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const seen = new Set();
  return (data.features || []).map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const { main, where } = placeName(f.properties || {});
    return { lat, lon, main, where };
  }).filter((p) => {
    const k = `${p.main}|${p.where}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --- Pickers ------------------------------------------------------------------------------------
function setupPicker(role) {
  const input = $(role), list = $(`${role}-list`), msg = $(`${role}-msg`);
  let items = [], active = -1, timer = null, ctrl = null;
  let placeState = { status: "idle", results: [] }; // idle | loading | done | error

  const showMsg = (text) => { msg.textContent = text || ""; msg.hidden = !text; };
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const selectable = () => items.filter((x) => x.kind !== "info");

  const compose = () => {
    const q = input.value.trim();
    const st = searchStations(q);
    items = [{ kind: "here" }, ...st.map((m) => ({ kind: "station", s: m.s, alias: m.alias }))];
    if (q.length >= MIN_PLACE_CHARS && !isOnline()) {
      items.push({ kind: "info", html: "Place search needs internet. Showing stations only." });
    } else if (q.length >= MIN_PLACE_CHARS) {
      if (placeState.status === "loading") items.push({ kind: "info", html: "Searching places…" });
      if (placeState.status === "error") items.push({ kind: "info", html: "Place search unavailable. Showing stations only." });
      if (placeState.status === "done") items.push(...placeState.results.map((p) => ({ kind: "place", p })));
      if (placeState.status === "done" && !st.length && !placeState.results.length) {
        items.push({ kind: "info", html: "No matching stations or places." });
      }
      if (placeState.status === "done" && placeState.results.length) items.push({ kind: "info", html: ATTRIBUTION, cls: "attr" });
    } else if (q && !st.length) {
      items.push({ kind: "info", html: "No matching stations. Type 3+ letters to search places." });
    }
  };

  const draw = () => {
    let n = -1;
    list.innerHTML = items.map((it) => {
      if (it.kind === "info") return `<li class="info ${it.cls || ""}" role="presentation">${it.html}</li>`;
      n++;
      const sel = `role="option" id="${role}-opt-${n}" aria-selected="${n === active}" data-n="${n}"`;
      if (it.kind === "here") return `<li ${sel}><span class="icon" aria-hidden="true">◎</span><span class="name">Current location</span></li>`;
      if (it.kind === "station") {
        const via = it.alias ? `${esc(it.alias)} · ` : "";
        return `<li ${sel}>${badges(it.s.lines)}<span class="name">${esc(it.s.name)}<span class="lines">${via}${esc(linesText(it.s.lines))}</span></span></li>`;
      }
      return `<li ${sel}><span class="icon" aria-hidden="true">⌖</span><span class="name">${esc(it.p.main)}<span class="lines">${esc(it.p.where)}</span></span></li>`;
    }).join("");
    list.hidden = items.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${role}-opt-${active}`);
  };

  // Default highlight is the first station/place, never "Current location" (that needs a tap or arrow).
  let userMoved = false;
  const defaultActive = () => (selectable().length > 1 ? 1 : -1);
  const refresh = () => {
    compose();
    if (!userMoved || active >= selectable().length) active = defaultActive();
    draw();
  };

  const choose = (it) => {
    showMsg("");
    if (it.kind === "here") return locate();
    if (it.kind === "station") picked[role] = { type: "station", id: it.s.id };
    else picked[role] = { type: "place", lat: it.p.lat, lon: it.p.lon, name: it.p.where ? `${it.p.main}, ${it.p.where}` : it.p.main };
    input.value = endpointLabel(picked[role]);
    syncClear(role);
    close(); save(); render(); afterPick(role);
  };

  // Current location: requested only on tap; coordinates stay in this page (not stored or sent).
  const locate = () => {
    close();
    if (!("geolocation" in navigator)) { showMsg("This browser can't share your location. Type a station or place instead."); return; }
    input.value = "Locating…";
    syncClear(role);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        picked[role] = { type: "place", lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Current location", geo: true };
        input.value = "Current location";
        save(); render(); afterPick(role);
      },
      (err) => {
        picked[role] = null;
        input.value = "";
        syncClear(role);
        showMsg(err.code === err.PERMISSION_DENIED
          ? "Location permission denied. Type a station or place instead."
          : "Couldn't get your location. Type a station or place instead.");
        render();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const scheduleGeocode = () => {
    clearTimeout(timer);
    if (ctrl) ctrl.abort();
    const q = input.value.trim();
    if (q.length < MIN_PLACE_CHARS || !isOnline()) { placeState = { status: "idle", results: [] }; return; }
    placeState = { status: "loading", results: [] };
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try {
        const results = await geocode(q, ctrl.signal);
        if (input.value.trim() !== q) return;
        placeState = { status: "done", results };
      } catch (e) {
        if (e.name === "AbortError") return;
        placeState = { status: "error", results: [] };
      }
      if (document.activeElement === input) refresh();
    }, DEBOUNCE_MS);
  };

  // Clear (× button, or Escape while focused): empties the field and the pick, keeps focus.
  const clearField = () => {
    clearTimeout(timer);
    if (ctrl) ctrl.abort();
    placeState = { status: "idle", results: [] };
    const had = picked[role];
    picked[role] = null;
    input.value = "";
    showMsg(""); close(); syncClear(role);
    if (had) { updatePlaceMap(role); save(); render(); }
    input.focus();
  };
  $(`${role}-clear`).addEventListener("click", clearField);

  input.addEventListener("input", () => {
    if (picked[role]) { picked[role] = null; updatePlaceMap(role); }
    showMsg(""); syncClear(role);
    scheduleGeocode();
    userMoved = false;
    compose(); active = defaultActive(); draw(); render();
  });
  // Tapping a filled field selects all its text, so typing replaces it. The mouseup that follows the
  // focusing tap would otherwise move the caret and drop the selection.
  let selectOnUp = false;
  input.addEventListener("focus", () => {
    if (input.value) { input.select(); selectOnUp = true; }
    if (!picked[role]) { compose(); active = -1; draw(); }
  });
  input.addEventListener("mouseup", (e) => { if (selectOnUp) { e.preventDefault(); selectOnUp = false; } });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (input.value || picked[role]) clearField(); else close(); e.preventDefault(); return; }
    if (list.hidden) return;
    const sel = selectable();
    if (e.key === "ArrowDown") { userMoved = true; active = Math.min(active + 1, sel.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { userMoved = true; active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter") { if (sel[active]) choose(sel[active]); e.preventDefault(); }
  });
  list.addEventListener("mousedown", (e) => {
    if (e.target.closest("a")) return; // attribution links
    const li = e.target.closest("li[data-n]");
    if (li) { e.preventDefault(); choose(selectable()[Number(li.dataset.n)]); }
  });
  input.addEventListener("blur", () => { selectOnUp = false; setTimeout(close, 150); });
  return { locate };
}

const syncClear = (role) => { $(`${role}-clear`).hidden = !$(role).value; };

function setPicked(role, ep) {
  picked[role] = ep;
  $(role).value = endpointLabel(ep);
  syncClear(role);
  afterPick(role);
}

// --- After a pick: place map + real walking distances (PLAN.md §4e) -----------------------------
function afterPick(role) { updatePlaceMap(role); ensureWalks(role); }

// Typed places always; current location only with the opt-in toggle.
async function ensureWalks(role) {
  const ep = picked[role];
  if (!walkAllowed(ep, { geoOptIn: geoWalkOptIn }) || !walkService.enabled() || !isOnline()) return;   // offline: estimates
  const cands = accessCandidates(net, ep, { modes: filters.modes, maxDistM: filters.maxWalkM });
  const stops = cands.flatMap((c) => c.stops.map((x) => ({ id: x.stop, lat: net.stops[x.stop].lat, lon: net.stops[x.stop].lon })))
    .filter((x) => !ep.walks?.[x.id]);
  if (!stops.length) return;
  const walks = await walkService.walksFrom(ep, stops);
  if (walks && picked[role] === ep) { ep.walks = { ...(ep.walks || {}), ...walks }; render(); }
}

let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletLoading) {
    leafletLoading = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = CONFIG.leafletCss; css.crossOrigin = "anonymous";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = CONFIG.leafletJs; js.crossOrigin = "anonymous";
      js.onload = () => resolve(window.L); js.onerror = () => { leafletLoading = null; reject(new Error("leaflet")); };
      document.head.appendChild(js);
    });
  }
  return leafletLoading;
}

// Place confirmation: a small OSM map with a pin. Not for current location (tiles would reveal it).
const placeMaps = {};
async function updatePlaceMap(role) {
  const box = $(`${role}-map`), ep = picked[role];
  if (placeMaps[role]) { placeMaps[role].remove(); placeMaps[role] = null; }
  if (!ep || ep.type !== "place" || ep.geo) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = `<div class="placemap-name">${esc(ep.name)} <span class="meta">· check the pin is the right place</span></div>
    <div class="placemap-map" role="img" aria-label="Map showing ${esc(ep.name)}"></div>`;
  if (!isOnline()) { box.querySelector(".placemap-map").textContent = "Map needs internet."; return; }
  try {
    const L = await loadLeaflet();
    if (picked[role] !== ep) return;
    const m = L.map(box.querySelector(".placemap-map"), { scrollWheelZoom: false }).setView([ep.lat, ep.lon], 16);
    L.tileLayer(CONFIG.tileUrl, { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    L.circleMarker([ep.lat, ep.lon], { radius: 8, color: "#7c1d35", weight: 3, fillColor: "#f0c35a", fillOpacity: 1 }).addTo(m);
    placeMaps[role] = m;
  } catch {
    box.querySelector(".placemap-map").textContent = "Map unavailable.";
  }
}

// --- Results ------------------------------------------------------------------------------------
function stopName(sid) { return pretty(net.stops[sid].name); }
function stopLines(sid) { return net.stops[sid].lines.map(lineLabel).join(", "); }

const FLAG_TEXT = {
  estimated_run: "estimated ride time",
  typical_headway: "average wait (not timetable)",
  estimated_walk: "estimated walk",
};
const estTags = (flags) => flags.filter((f) => FLAG_TEXT[f]).map((f) => `<span class="est">${FLAG_TEXT[f]}</span>`).join("");
const farAccess = (dist, station) => `${fmtDist(dist)} to ${station}, consider e-hailing`;
const farEgress = (dist, station, place) => `${fmtDist(dist)} from ${station} to ${place}, consider e-hailing`;

// A closer station that only switched-off modes serve, for the first/last stretch of a place search.
function blockedHint(leg, point) {
  if (!point || point.type !== "place") return "";
  const b = blockedNearby(net, point, { modes: filters.modes, maxDistM: filters.maxWalkM }).find((x) => x.dist_m < leg.dist_m);
  if (!b) return "";
  const ms = b.modes.join(", ");
  return `<div class="hint">${esc(pretty(net.stations[b.station].name))} (${esc(ms)}) is ${fmtDist(b.dist_m)} away, but ${esc(ms)} ${b.modes.length > 1 ? "are" : "is"} switched off.
    <button type="button" class="linkbtn" data-enable-modes="${b.modes.join(",")}">Turn on ${esc(ms)}</button></div>`;
}

// Plain Google Maps directions URL (no key). Nothing is sent until the user taps it.
function dirLink(a, b) {
  if (!a || !b) return "";
  const pt = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  return `<a class="dirlink" href="https://www.google.com/maps/dir/?api=1&amp;origin=${pt(a)}&amp;destination=${pt(b)}&amp;travelmode=walking" target="_blank" rel="noopener noreferrer">Open walking directions</a>`;
}

const OSM_WALK_ATTR = `Walking routes: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors
  (<a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">ODbL</a>), routed by
  <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">FOSSGIS OSRM</a> ·
  <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">report a map error</a>`;

function journeyHtml(r) {
  const rows = [];
  const node = (c, st, detail) => rows.push(`<li class="stop"><div class="rail" style="--c:${c}"><span class="node"></span></div>
    <div class="body"><div class="st">${st}</div>${detail ? `<div class="detail">${detail}</div>` : ""}</div></li>`);
  const seg = (c, dashed, detail, extra = "") => rows.push(`<li class="stop"><div class="rail${dashed ? " dashed" : ""}" style="--c:${c}"></div>
    <div class="body"><div class="detail">${detail}</div>${extra}</div></li>`);
  const W = "var(--walk)";
  r.legs.forEach((leg, i) => {
    if (leg.type === "access") {
      node(W, esc(leg.place), "Start");
      seg(W, true, leg.far
        ? `<span class="far">${esc(farAccess(leg.dist_m, stopName(leg.stop)))}</span>`
        : `Walk ${fmtDist(leg.dist_m)} (~${fmtMin(leg.walk_min)}) to ${esc(stopName(leg.stop))} ${estTags(leg.flags)}<br>${dirLink(leg.place_point, net.stops[leg.stop])}`,
        blockedHint(leg, picked.from));
    } else if (leg.type === "egress") {
      seg(W, true, leg.far
        ? `<span class="far">${esc(farEgress(leg.dist_m, stopName(leg.stop), leg.place))}</span>`
        : `Walk ${fmtDist(leg.dist_m)} (~${fmtMin(leg.walk_min)}) to ${esc(leg.place)} ${estTags(leg.flags)}<br>${dirLink(net.stops[leg.stop], leg.place_point)}`,
        blockedHint(leg, picked.to));
      node(W, esc(leg.place), "Arrive");
    } else if (leg.type === "ride") {
      const c = color(leg.line);
      const mid = leg.stops.slice(1, -1).map(stopName);
      node(c, esc(stopName(leg.from)), r.legs[i - 1]?.kind === "same_stop" ? "Change trains here" : "");
      seg(c, false, `${badge(leg.line)} <strong>${esc(leg.line_name)}</strong><br>
        towards ${esc(stopName(leg.towards))}<br>
        ${leg.first ? `wait up to ${fmtMin(leg.headway_min)}` : `wait ~${fmtMin(leg.wait_min)}`} · ride ${fmtMin(leg.ride_min)}, ${leg.stops.length - 1} stop${leg.stops.length === 2 ? "" : "s"}
        ${estTags(leg.flags)}${leg.last_train ? `<span class="est">last train ~${clock(leg.last_train.last_sec)}</span>` : ""}
        ${mid.length ? `<details class="stops"><summary>${mid.length} intermediate stop${mid.length === 1 ? "" : "s"}</summary>${mid.map(esc).join(" · ")}</details>` : ""}`);
      const next = r.legs[i + 1];
      if (!next) node(c, esc(stopName(leg.to)), "Arrive");
      else if (next.type !== "ride" && next.kind !== "same_stop") node(c, esc(stopName(leg.to)), "Get off");
    } else if (leg.kind === "same_stop") {
      // drawn by the next ride leg's first node
    } else {
      if (i === 0) node(W, esc(stopName(leg.from)), `Start · ${esc(stopLines(leg.from))}`);
      const gates = leg.exits_gates === true ? ` · exits fare gates (+${leg.gate_penalty_min} min)` : "";
      seg(W, true, `Walk ~${fmtMin(leg.walk_min)} to ${esc(stopName(leg.to))} (${esc(stopLines(leg.to))})${gates} ${estTags(leg.flags)}<br>${dirLink(net.stops[leg.from], net.stops[leg.to])}`);
      if (i === r.legs.length - 1) node(W, esc(stopName(leg.to)), "Arrive");
    }
  });
  return `<ol class="journey">${rows.join("")}</ol>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

// Fare block (PLAN.md §4d): per-operator segments, added together; unknown segments link out.
function fareHtml(r) {
  const f = computeFares(net, r, { fareType });
  if (!f || !f.segments.length) return "";
  const total = fareSummary(f);
  const segs = f.segments.map((s) => {
    const where = `${esc(stopName(s.from))} → ${esc(stopName(s.to))}`;
    const link = s.fare_url ? `<a href="${esc(s.fare_url)}" target="_blank" rel="noopener">${esc(s.link_text)}</a>` : "";
    const value = s.price != null ? `<strong>RM ${s.price.toFixed(2)}</strong>${s.status && /unverified/.test(s.status) ? `<br><span class="meta">(${esc(s.status)})</span>` : ""}`
      : s.type_text ? `<span class="meta">${esc(s.type_text)}${s.type_url ? ` <a href="${esc(s.type_url)}" target="_blank" rel="noopener">Details</a>` : ""}</span>`
      : s.system === "rapidkl" ? link : `fare unavailable${link ? ` · ${link}` : ""}`;
    return `<li><span>${esc(s.name)}: ${where}</span> <span class="fare-val">${value}</span></li>`;
  }).join("");
  const typeNotes = [...new Set(f.segments.filter((s) => s.price != null).flatMap((s) => [
    s.type_label ? `${s.name}: ${s.type_label}.` : null, s.type_note ? `${s.name}: ${s.type_note}.` : null]).filter(Boolean))];
  const notes = [...new Set(f.segments.flatMap((s) => (net.fares.systems[s.system]?.notes || []).map((n) => n.text)))];
  const kind = FARE_TYPE_TEXT[fareType];
  return `<div class="fare">
    <div class="fare-total">Fare: <strong>${total ? esc(total) : "unavailable"}</strong></div>
    <div class="meta">${f.added_together ? `Fares from each operator, added together (${esc(kind.toLowerCase())}).` : `${esc(kind)}.`}</div>
    <ul class="fare-segs">${segs}</ul>
    ${typeNotes.map((t) => `<div class="meta">${esc(t)}</div>`).join("")}
    ${f.sources.map((x) => x.caveat
      ? `<div class="meta fare-caveat">${esc(x.caveat)}. Source: <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></div>`
      : `<div class="meta">Fares as of ${esc(fmtDate(x.as_of))}, source: <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></div>`).join("")}
    ${notes.length ? `<details class="stops"><summary>Concessions and other fares</summary>${notes.map((t) => `<p>${esc(t)}</p>`).join("")}</details>` : ""}
  </div>`;
}

// Short fare text for a card summary.
function fareShort(f) {
  if (!f || !f.segments.length) return "";
  const s = fareSummary(f);
  if (s) return s;
  return f.missing_names.length === 1 && f.missing_names[0] === "Rapid KL" ? "check MyRapid" : "unavailable";
}

function routeCard(r, res, f, open, rank) {
  const lines = [...new Set(r.lines)];
  const changes = r.transfers === 0 ? "direct" : `${r.transfers} change${r.transfers === 1 ? "" : "s"}`;
  const walkAlt = res.direct_walk_min != null && res.direct_walk_min < r.expected_min
    ? `<div class="note ok">Walking directly may be quicker: ~${fmtMin(res.direct_walk_min)}.</div>` : "";
  const osm = r.legs.some((l) => l.walk_source === "osm" || l.walk_source === "osm-routed");
  const fs = fareShort(f);
  return `<details class="card alt"${open ? " open" : ""}>
    <summary class="summary">
      <span class="alt-rank">Route ${rank}</span>
      <div class="big">~${fmtMin(r.journey_min)} <span class="meta">+ up to ${fmtMin(r.initial_headway_min)} wait</span></div>
      <div class="meta">${badges(lines)} ${changes}${r.walk_min > 0 ? ` · walk ~${fmtMin(r.walk_min)}` : ""}${fs ? ` · fare ${esc(fs)}` : ""}</div>
      <div class="meta">Expected ~${fmtMin(r.expected_min)} with an average first wait${r.transfer_wait_min > 0 ? ` · includes ~${fmtMin(r.transfer_wait_min)} waiting at changes` : ""}</div>
      ${r.excludes_far_access ? `<div class="meta">Times exclude getting to or from a station beyond your ${fmtDist(filters.maxWalkM)} max walk.</div>` : ""}
      ${r.legs.filter((l) => l.last_train).map((l) => `<div class="note lasttrain"><strong>${l.last_train.missed ? "Last train may be gone" : "Last train"}:</strong> ${esc(lastTrainText(l, stopName(l.from)))}</div>`).join("")}
    </summary>
    <div class="card-actions"><button type="button" class="chip share" data-share="${rank - 1}">Share</button><span class="share-msg" role="status"></span></div>
    ${fareHtml(r)}
    ${walkAlt}
    ${journeyHtml(r)}
    ${osm ? `<div class="meta osm-attr">${OSM_WALK_ATTR}</div>` : ""}
    ${r.uses_estimate ? `<div class="note">This route uses estimated values (marked above). Times may differ from the real service.</div>` : ""}
  </details>`;
}

const pointOf = (e) => (e.type === "station" ? net.stations[e.id] : e);

function render() {
  const out = $("results");
  const { from, to } = picked;
  if (!from || !to) { out.innerHTML = ""; return; }
  if (from.type === "station" && to.type === "station" && from.id === to.id) {
    out.innerHTML = `<p class="msg">Origin and destination are the same station.</p>`; return;
  }
  if (!filters.modes.length) { out.innerHTML = `<p class="msg">Select at least one mode.</p>`; return; }
  const q = { day: $("day").value, time: $("time").value || DEFAULT_QUERY.time, modes: filters.modes, maxWalkM: filters.maxWalkM };
  let res;
  try { res = route(graph, from, to, q); } catch (e) { out.innerHTML = `<p class="msg">${esc(e.message)}</p>`; return; }
  const note = filtersAreDefault() ? "" : `<p class="filters-note">Filters active: ${esc(modeList(filters.modes))} · max walk ${fmtDist(filters.maxWalkM)} · <button type="button" class="linkbtn" data-reset>Reset filters</button></p>`;
  if (!res) {
    const d = distanceM(pointOf(from), pointOf(to));
    const walk = from.type === "place" || to.type === "place"
      ? ` Walking directly is about ${fmtMin(walkSec(d) / 60)} (${fmtDist(d)}).` : "";
    let html = `<p class="msg">No train route found at this time.${notRunningText(from, q)}${walk}</p>`;
    if (filters.modes.length < MODES.length) {
      const sug = suggestModes(graph, from, to, q);
      const only = filters.modes.length === 1 ? `${filters.modes[0]} only` : modeList(filters.modes);
      html = sug.length
        ? `<p class="msg">No route with ${esc(only)}. Enabling <button type="button" class="linkbtn" data-enable="${sug[0].mode}">${sug[0].mode}</button> gives ~${fmtMin(sug[0].journey_min)}.${sug.length > 1 ? ` Also works: ${sug.slice(1).map((x) => `<button type="button" class="linkbtn" data-enable="${x.mode}">${x.mode}</button> (~${fmtMin(x.journey_min)})`).join(", ")}.` : ""}</p>`
        : `<p class="msg">No route with ${esc(only)}, and enabling any single other mode doesn't help.${walk}</p>`;
    }
    out.innerHTML = note + html;
    wireResultButtons(out);
    syncUrl(q);
    return;
  }
  if (favs?.addTrip(from, to)) drawSaved();   // recent trips (PLAN.md §4g); skips current location
  // Alternatives (PLAN.md §4f), each with its fare (§4d)
  const items = alternatives(graph, from, to, q).map((r) => ({ r, f: computeFares(net, r, { fareType }) }));
  const fareKey = ({ f }) => (!f || !f.segments.length ? [2, 0] : f.complete ? [0, f.known_total] : f.known_total > 0 ? [1, f.known_total] : [2, 0]);
  const order = {
    fastest: (a, b) => a.r.expected_min - b.r.expected_min,
    fewest: (a, b) => a.r.transfers - b.r.transfers || a.r.expected_min - b.r.expected_min,
    cheapest: (a, b) => { const x = fareKey(a), y = fareKey(b); return x[0] - y[0] || x[1] - y[1] || a.r.expected_min - b.r.expected_min; },
  };
  items.sort(order[sortBy]);
  const sorter = items.length > 1 ? `<div class="tabs sortbar" role="group" aria-label="Sort routes">
      ${[["fastest", "Fastest"], ["fewest", "Fewest changes"], ["cheapest", "Cheapest"]].map(([k, t]) =>
        `<button type="button" data-sort="${k}" aria-pressed="${sortBy === k}">${t}</button>`).join("")}
    </div>
    <p class="filters-note">${items.length} route${items.length > 1 ? "s" : ""}${sortBy === "cheapest" && items.some((x) => !x.f?.complete)
      ? ` · Some fares aren't available (${esc([...new Set(items.flatMap((x) => x.f?.missing_names || []))].join(", "))}), so those routes are ranked by their known fares only` : ""}</p>` : "";
  out.innerHTML = note + sorter + items.map((x, i) => routeCard(x.r, res, x.f, i === 0, i + 1)).join("");
  out.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { sortBy = b.dataset.sort; render(); }));
  out.querySelectorAll("[data-share]").forEach((b) => b.addEventListener("click", () => shareRoute(items[Number(b.dataset.share)], q, b)));
  wireResultButtons(out);
  syncUrl(q);
}

// --- Share (PLAN.md §4h): plain-text summary to the clipboard -------------------------------------
const plainName = (ep) => (ep.type === "station" ? stationById(ep.id).name : ep.name);
const shareUrl = (q) => `${location.origin}${location.pathname}?${queryString({ from: picked.from, to: picked.to, day: q.day, time: q.time })}`;

async function shareRoute(item, q, btn) {
  if (!item) return;
  const fs = fareShort(item.f);
  const text = routeSummaryText(item.r, {
    fromName: plainName(picked.from), toName: plainName(picked.to), day: q.day, time: q.time, stopName,
    fare: fs === "check MyRapid" ? "Rapid KL: check fare on MyRapid" : fs || null,
    fareKind: FARE_TYPE_TEXT[fareType].toLowerCase(), url: shareUrl(q),
  });
  const msg = btn.nextElementSibling;
  try {
    await navigator.clipboard.writeText(text);
    msg.textContent = "Copied to clipboard.";
  } catch {
    // clipboard blocked (permissions, insecure context): show the text to copy by hand
    msg.textContent = "Couldn't copy automatically. Select and copy:";
    const ta = document.createElement("textarea");
    ta.readOnly = true; ta.className = "share-text"; ta.value = text; ta.rows = Math.min(14, text.split("\n").length);
    msg.append(ta);
    ta.select();
  }
}

// --- Shareable URL (PLAN.md §4h): ?from=&to=&day=&time= ------------------------------------------
// Each search updates the URL; separate searches become history entries (back steps through them),
// while quick successive changes (< 1.5 s, e.g. editing the time) replace the current entry.
// Current location is written as "here", never as coordinates.
let replaceNextUrl = true, lastUrlChange = 0, applyingUrl = false;
function syncUrl(q) {
  if (applyingUrl || !picked.from || !picked.to) return;
  const qs = queryString({ from: picked.from, to: picked.to, day: q.day, time: q.time });
  // compare normalised, so a shared link written with %3A escapes counts as the same search
  const cur = new URLSearchParams(location.search).toString().replace(/%3A/gi, ":").replace(/%2C/gi, ",");
  if (cur === qs) { replaceNextUrl = false; return; }
  const url = `${location.pathname}?${qs}`, now = Date.now();
  try {
    if (replaceNextUrl || now - lastUrlChange < 1500) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
  } catch { /* some embedded browsers block history changes */ }
  replaceNextUrl = false; lastUrlChange = now;
}

// Restore a search from the URL (page load, or back/forward), then run it.
const pickers = {};
function applyUrlState(search) {
  const st = paramsToState(search, net);
  const now = nowInKL();
  const askHere = [];
  applyingUrl = true;
  try {
    $("day").value = st.day || now.day;
    $("time").value = st.time || now.time;
    for (const role of ["from", "to"]) {
      const ep = st[role];
      if (ep?.type === "here") { askHere.push(role); continue; }
      if (ep) setPicked(role, ep);
      else { picked[role] = null; $(role).value = ""; syncClear(role); updatePlaceMap(role); }
    }
    render();
  } finally {
    applyingUrl = false;
  }
  // this history entry already is that search, so the next new search adds an entry after it
  replaceNextUrl = false;
  for (const role of askHere) pickers[role].locate();   // asks for the location again
}

// Why no route: which lines at the origin can't be boarded at the chosen time (service hours / bands).
function notRunningText(from, q) {
  const stops = from.type === "station" ? net.stations[from.id].stops
    : accessCandidates(net, from, { modes: q.modes, maxDistM: q.maxWalkM }).flatMap((c) => c.stops.map((x) => x.stop));
  const enabled = new Set(q.modes);
  const lines = [...new Set(stops.flatMap((s) => net.stops[s].lines))].filter((l) => enabled.has(net.lines[l].display.mode));
  const off = linesNotRunning(graph, lines, q, stops);
  if (!off.length) return " Lines may not be running.";
  const names = off.map((l) => lineLabel(l)).join(", ");
  return ` ${esc(names)} ${off.length > 1 ? "aren't" : "isn't"} running from here at ${esc(q.time)}.`;
}

function wireResultButtons(out) {
  out.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", resetFilters));
  out.querySelectorAll("[data-enable], [data-enable-modes]").forEach((b) => b.addEventListener("click", () => {
    const add = (b.dataset.enable || b.dataset.enableModes).split(",");
    filters.modes = MODES.filter((m) => filters.modes.includes(m) || add.includes(m));
    applyFilters();
  }));
}

// --- Filters ------------------------------------------------------------------------------------
function loadFilters() {
  try {
    const s = JSON.parse(localStorage.getItem("klrail.filters") || "null");
    if (s && Array.isArray(s.modes) && MAX_WALK_OPTIONS.includes(s.maxWalkM)) {
      filters = { modes: MODES.filter((m) => s.modes.includes(m)), maxWalkM: s.maxWalkM };
    }
  } catch {}
}
function saveFilters() {
  try { localStorage.setItem("klrail.filters", JSON.stringify(filters)); } catch {}
}
function drawFilters() {
  $("modes").innerHTML = MODES.map((m) => `<button type="button" class="chip" data-mode="${m}" aria-pressed="${filters.modes.includes(m)}">${m}</button>`).join("");
  $("maxwalk").value = String(filters.maxWalkM);
  $("reset-filters").hidden = filtersAreDefault();
}
function applyFilters() { saveFilters(); drawFilters(); render(); ensureWalks("from"); ensureWalks("to"); }
function resetFilters() { filters = { ...DEFAULT_FILTERS, modes: [...DEFAULT_FILTERS.modes] }; applyFilters(); }
function setupFareType() {
  const sel = $("faretype");
  sel.value = fareType;
  sel.addEventListener("change", () => {
    if (!FARE_TYPES.includes(sel.value)) return;
    fareType = sel.value;
    try { localStorage.setItem("klrail.fareType", fareType); } catch {}
    render();
  });
}
function setupGeoWalkToggle() {
  const box = $("geowalk"), row = $("geowalk-row");
  if (!walkService.enabled()) { row.hidden = true; return; }   // nothing to opt into
  row.hidden = false;
  box.checked = geoWalkOptIn;
  box.addEventListener("change", () => {
    geoWalkOptIn = box.checked;
    try { localStorage.setItem("klrail.geoWalk", geoWalkOptIn ? "1" : "0"); } catch {}
    for (const role of ["from", "to"]) {
      const ep = picked[role];
      if (ep?.geo) { if (geoWalkOptIn) ensureWalks(role); else { delete ep.walks; } }
    }
    render();
  });
}

function setupFilters() {
  loadFilters();
  $("modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    const m = b.dataset.mode;
    filters.modes = filters.modes.includes(m) ? filters.modes.filter((x) => x !== m) : MODES.filter((x) => x === m || filters.modes.includes(x));
    applyFilters();
  });
  $("maxwalk").addEventListener("change", () => { filters.maxWalkM = Number($("maxwalk").value); applyFilters(); });
  $("reset-filters").addEventListener("click", resetFilters);
  drawFilters();
}

// --- Favourites and recent trips (PLAN.md §4g) ---------------------------------------------------
const shortName = (ep) => {
  if (ep.type === "station") return stationById(ep.id)?.name || "?";
  const n = ep.name.split(",")[0];
  return n.length > 28 ? `${n.slice(0, 27)}…` : n;
};
const tripText = (t) => `${shortName(t.from)} → ${shortName(t.to)}`;

function drawSaved() {
  const places = favs.places(), trips = favs.trips();
  const chips = places.map((p, i) => `<button type="button" class="chip fav" data-fav="${i}" title="${esc(endpointLabel(p.ep))}"><strong>${esc(p.label)}</strong> ${esc(shortName(p.ep))}</button>`);
  if (trips.length) chips.push(`<span class="saved-label">Recent</span>`, ...trips.map((t, i) =>
    `<button type="button" class="chip trip" data-trip="${i}" aria-label="Recent trip ${esc(tripText(t))}">${esc(tripText(t))}</button>`));
  $("saved-chips").innerHTML = chips.join("");
  $("saved-chips").hidden = !chips.length;
  $("saved-list").innerHTML = [
    ...places.map((p) => `<li><span><strong>${esc(p.label)}</strong>: ${esc(endpointLabel(p.ep))}</span> <button type="button" class="linkbtn" data-remove-fav="${esc(p.label)}" aria-label="Remove ${esc(p.label)}">Remove</button></li>`),
    ...trips.map((t, i) => `<li><span>Recent: ${esc(tripText(t))}</span> <button type="button" class="linkbtn" data-remove-trip="${i}" aria-label="Remove recent trip ${esc(tripText(t))}">Remove</button></li>`),
  ].join("") || `<li class="meta">Nothing saved yet.</li>`;
  $("clear-saved").hidden = !places.length && !trips.length;
  $("saved-note").textContent = favs.persistent
    ? "Saved only in this browser. Nothing is sent anywhere."
    : "This browser isn't allowing storage, so saved places and trips last only until you close this page.";
}

function setupSaved() {
  favs = createFavStore(usableStorage(() => localStorage), {
    isValid: (ep) => ep.type !== "station" || Boolean(net.stations[ep.id]),
  });
  const msg = $("save-msg");
  const say = (text, ok) => { msg.textContent = text; msg.hidden = !text; msg.classList.toggle("ok", Boolean(ok)); };
  // One tap: a place fills the first empty field (From, then To), else replaces To. A trip fills both.
  $("saved-chips").addEventListener("click", (e) => {
    const f = e.target.closest("[data-fav]"), t = e.target.closest("[data-trip]");
    if (f) {
      const p = favs.places()[Number(f.dataset.fav)];
      if (!p) return;
      setPicked(!picked.from ? "from" : "to", p.ep);
    } else if (t) {
      const trip = favs.trips()[Number(t.dataset.trip)];
      if (!trip) return;
      setPicked("from", trip.from); setPicked("to", trip.to);
    } else return;
    save(); render();
  });
  $("save-kind").addEventListener("change", () => { $("save-name").hidden = $("save-kind").value !== "custom"; say(""); });
  $("save-btn").addEventListener("click", () => {
    const which = $("save-which").value;
    const r = favs.savePlace($("save-kind").value, $("save-name").value, picked[which]);
    if (!r.ok) { say(r.error); return; }
    say(`Saved ${endpointLabel(picked[which])} as ${r.label}.`, true);
    $("save-name").value = "";
    drawSaved();
  });
  $("saved-list").addEventListener("click", (e) => {
    const f = e.target.closest("[data-remove-fav]"), t = e.target.closest("[data-remove-trip]");
    if (f) favs.removePlace(f.dataset.removeFav);
    else if (t) favs.removeTrip(Number(t.dataset.removeTrip));
    else return;
    say(""); drawSaved();
  });
  // Clear all: a second tap within 5 s confirms.
  const clear = $("clear-saved"), clearText = clear.textContent;
  let armed = null;
  clear.addEventListener("click", () => {
    if (!armed) {
      clear.textContent = "Tap again to clear everything saved";
      armed = setTimeout(() => { armed = null; clear.textContent = clearText; }, 5000);
      return;
    }
    clearTimeout(armed); armed = null; clear.textContent = clearText;
    favs.clearAll(); say("Cleared.", true); drawSaved();
  });
  drawSaved();
}

// --- Nearby stations (PLAN.md §4g): location asked on tap, used here only, never stored or sent ---
function setupNearby() {
  const btn = $("nearby-btn"), box = $("nearby");
  const show = (html) => { box.innerHTML = html; box.hidden = false; };
  btn.addEventListener("click", () => {
    if (!("geolocation" in navigator)) { show(`<p class="pick-msg">This browser can't share your location.</p>`); return; }
    show(`<p class="msg">Locating…</p>`);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const near = nearestStations(net, { lat: pos.coords.latitude, lon: pos.coords.longitude }, 5);
        show(`<div class="nearby-head"><span>Nearest stations <span class="meta">· straight-line distance · tap to set as From</span></span>
            <button type="button" class="linkbtn" data-close>Close</button></div>
          <ul class="nearby-list">${near.map((n) => {
            const st = stationById(n.station);
            return `<li><button type="button" data-st="${esc(n.station)}">${badges(st.lines)}<span class="name">${esc(st.name)}<span class="lines">${esc(linesText(st.lines))}</span></span><span class="dist">${fmtDist(n.dist_m)}</span></button></li>`;
          }).join("")}</ul>`);
      },
      (err) => show(`<p class="pick-msg">${err.code === err.PERMISSION_DENIED ? "Location permission denied." : "Couldn't get your location."}</p>`),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-st]");
    if (b) { setPicked("from", { type: "station", id: b.dataset.st }); save(); render(); }
    if (b || e.target.closest("[data-close]")) { box.hidden = true; box.innerHTML = ""; }
  });
}

// --- Offline (PLAN.md §4g) ------------------------------------------------------------------------
// built_at is UTC; show the date where the reader is (e.g. 19:57Z on 27 Sep is 28 Sep in KL)
const localDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
function updateOffline() {
  const b = $("offline");
  b.hidden = isOnline();
  if (!b.hidden) {
    b.textContent = `You're offline. Planning with saved timetable data (built ${localDate(net.meta.built_at)}). Place search and real walking routes need internet.`;
  }
}
function setupOffline() {
  updateOffline();
  window.addEventListener("offline", updateOffline);
  window.addEventListener("online", () => {
    updateOffline();
    for (const role of ["from", "to"]) { ensureWalks(role); if (picked[role]?.type === "place") updatePlaceMap(role); }
  });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Stations and typed places are remembered; the current location never is.
function save() {
  const keep = (e) => (e && !e.geo ? { ...e, walks: undefined } : null);
  try { localStorage.setItem("klrail", JSON.stringify({ v: 2, from: keep(picked.from), to: keep(picked.to) })); } catch {}
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem("klrail") || "{}");
    const valid = (e) => e && ((e.type === "station" && net.stations[e.id]) ||
      (e.type === "place" && Number.isFinite(e.lat) && Number.isFinite(e.lon) && !e.geo));
    for (const role of ["from", "to"]) {
      let e = s[role];
      if (typeof e === "string") e = { type: "station", id: e }; // v1 stored station ids
      if (valid(e)) setPicked(role, e);
    }
  } catch {}
}

function showBanner() {
  const stale = (net.meta.warnings || []).filter((w) => w.startsWith("STALE"));
  if (!stale.length) return;
  const b = $("banner");
  b.textContent = "Timetable data is out of date or expiring soon: " + stale.map((w) => w.replace(/^STALE( SOON)?: /, "")).join("; ");
  b.hidden = false;
}

async function main() {
  net = await (await fetch("data/network.json")).json();
  graph = loadNetwork(net);
  buildIndex();
  pickers.from = setupPicker("from");
  pickers.to = setupPicker("to");
  $("swap").addEventListener("click", () => {
    const f = picked.from, t = picked.to;
    setPicked("from", t); setPicked("to", f); save(); render();
  });
  setupFilters();
  setupGeoWalkToggle();
  setupFareType();
  setupSaved();
  setupNearby();
  setupOffline();
  $("day").addEventListener("change", render);
  $("time").addEventListener("change", render);
  // Depart defaults to now (Malaysia time); "Now" resets it. Search re-runs (it also runs by itself).
  $("now").addEventListener("click", () => { const n = nowInKL(); $("day").value = n.day; $("time").value = n.time; render(); });
  $("form").addEventListener("submit", (e) => { e.preventDefault(); render(); });
  window.addEventListener("popstate", () => applyUrlState(location.search));
  showBanner();
  if (CONFIG.contactEmail) {
    const c = $("contact");
    c.innerHTML = `Contact: <a href="mailto:${esc(CONFIG.contactEmail)}">${esc(CONFIG.contactEmail)}</a>`;
    c.hidden = false;
  }
  // A shared/bookmarked URL wins over the remembered stations.
  if (hasSearchParams(location.search)) applyUrlState(location.search);
  else {
    const n = nowInKL();
    $("day").value = n.day; $("time").value = n.time;
    restore();
    render();
  }
}

main().catch((e) => { $("results").innerHTML = `<p class="msg">Could not load network data: ${esc(e.message)}</p>`; });
