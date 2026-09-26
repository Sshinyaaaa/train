import { loadNetwork, route, suggestModes, blockedNearby, accessCandidates, linesNotRunning, DEFAULT_QUERY, MODES, MAX_WALK_OPTIONS, distanceM, walkSec } from "./router.js";

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
let tab = "fastest";
// Route filters (PLAN.md §4c): enabled modes + max first/last walk. Persisted per browser.
const DEFAULT_FILTERS = { modes: [...MODES], maxWalkM: DEFAULT_QUERY.maxWalkM };
let filters = { ...DEFAULT_FILTERS, modes: [...DEFAULT_FILTERS.modes] };
const filtersAreDefault = () => filters.modes.length === MODES.length && filters.maxWalkM === DEFAULT_FILTERS.maxWalkM;
const modeList = (ms) => MODES.filter((m) => ms.includes(m)).join(", ");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const color = (lid) => net.lines[lid].color || "#888";
const lineLabel = (lid) => net.lines[lid].display.label;   // e.g. "12 · MRT Putrajaya Line"
// Readable text on a line colour (yellow lines need dark text).
function ink(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? "#1c1c1c" : "#fff";
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
}

const badges = (lines) => `<span class="badges">${lines.map(badge).join("")}</span>`;
const linesText = (lines) => lines.map((l) => net.lines[l].display.name).join(", ");
const stationLabel = (s) => (s.dup ? `${s.name} (${linesText(s.lines)})` : s.name);
const stationById = (id) => stations.find((x) => x.id === id);
const endpointLabel = (e) => (!e ? "" : e.type === "station" ? stationLabel(stationById(e.id)) : e.name);

function searchStations(q) {
  const k = q.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!k) return [];
  const starts = [], contains = [];
  for (const s of stations) {
    const i = s.key.indexOf(k);
    if (i === 0) starts.push(s); else if (i > 0) contains.push(s);
  }
  return starts.concat(contains).slice(0, 8);
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
    items = [{ kind: "here" }, ...st.map((s) => ({ kind: "station", s }))];
    if (q.length >= MIN_PLACE_CHARS) {
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
        return `<li ${sel}>${badges(it.s.lines)}<span class="name">${esc(it.s.name)}<span class="lines">${esc(linesText(it.s.lines))}</span></span></li>`;
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
    close(); save(); render();
  };

  // Current location: requested only on tap; coordinates stay in this page (not stored or sent).
  const locate = () => {
    close();
    if (!("geolocation" in navigator)) { showMsg("This browser can't share your location. Type a station or place instead."); return; }
    input.value = "Locating…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        picked[role] = { type: "place", lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Current location", geo: true };
        input.value = "Current location";
        save(); render();
      },
      (err) => {
        picked[role] = null;
        input.value = "";
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
    if (q.length < MIN_PLACE_CHARS) { placeState = { status: "idle", results: [] }; return; }
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

  input.addEventListener("input", () => {
    picked[role] = null; showMsg("");
    scheduleGeocode();
    userMoved = false;
    compose(); active = defaultActive(); draw(); render();
  });
  input.addEventListener("focus", () => { if (!picked[role]) { compose(); active = -1; draw(); } });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    const sel = selectable();
    if (e.key === "ArrowDown") { userMoved = true; active = Math.min(active + 1, sel.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { userMoved = true; active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter") { if (sel[active]) choose(sel[active]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => {
    if (e.target.closest("a")) return; // attribution links
    const li = e.target.closest("li[data-n]");
    if (li) { e.preventDefault(); choose(selectable()[Number(li.dataset.n)]); }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
}

function setPicked(role, ep) {
  picked[role] = ep;
  $(role).value = endpointLabel(ep);
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
        : `Walk ${fmtDist(leg.dist_m)} (~${fmtMin(leg.walk_min)}) to ${esc(stopName(leg.stop))}`,
        blockedHint(leg, picked.from));
    } else if (leg.type === "egress") {
      seg(W, true, leg.far
        ? `<span class="far">${esc(farEgress(leg.dist_m, stopName(leg.stop), leg.place))}</span>`
        : `Walk ${fmtDist(leg.dist_m)} (~${fmtMin(leg.walk_min)}) to ${esc(leg.place)}`,
        blockedHint(leg, picked.to));
      node(W, esc(leg.place), "Arrive");
    } else if (leg.type === "ride") {
      const c = color(leg.line);
      const mid = leg.stops.slice(1, -1).map(stopName);
      node(c, esc(stopName(leg.from)), r.legs[i - 1]?.kind === "same_stop" ? "Change trains here" : "");
      seg(c, false, `${badge(leg.line)} <strong>${esc(leg.line_name)}</strong><br>
        towards ${esc(stopName(leg.towards))}<br>
        ${leg.first ? `wait up to ${fmtMin(leg.headway_min)}` : `wait ~${fmtMin(leg.wait_min)}`} · ride ${fmtMin(leg.ride_min)}, ${leg.stops.length - 1} stop${leg.stops.length === 2 ? "" : "s"}
        ${estTags(leg.flags)}
        ${mid.length ? `<details class="stops"><summary>${mid.length} intermediate stop${mid.length === 1 ? "" : "s"}</summary>${mid.map(esc).join(" · ")}</details>` : ""}`);
      const next = r.legs[i + 1];
      if (!next) node(c, esc(stopName(leg.to)), "Arrive");
      else if (next.type !== "ride" && next.kind !== "same_stop") node(c, esc(stopName(leg.to)), "Get off");
    } else if (leg.kind === "same_stop") {
      // drawn by the next ride leg's first node
    } else {
      if (i === 0) node(W, esc(stopName(leg.from)), `Start · ${esc(stopLines(leg.from))}`);
      const gates = leg.exits_gates === true ? ` · exits fare gates (+${leg.gate_penalty_min} min)` : "";
      seg(W, true, `Walk ~${fmtMin(leg.walk_min)} to ${esc(stopName(leg.to))} (${esc(stopLines(leg.to))})${gates} ${estTags(leg.flags)}`);
      if (i === r.legs.length - 1) node(W, esc(stopName(leg.to)), "Arrive");
    }
  });
  return `<ol class="journey">${rows.join("")}</ol>`;
}

function routeCard(r, res) {
  const lines = [...new Set(r.lines)];
  const changes = r.transfers === 0 ? "direct" : `${r.transfers} change${r.transfers === 1 ? "" : "s"}`;
  const walkAlt = res.direct_walk_min != null && res.direct_walk_min < r.expected_min
    ? `<div class="note ok">Walking directly may be quicker: ~${fmtMin(res.direct_walk_min)}.</div>` : "";
  return `<div class="card">
    <div class="summary">
      <div class="big">~${fmtMin(r.journey_min)} <span class="meta">+ up to ${fmtMin(r.initial_headway_min)} wait</span></div>
      <div class="meta">${badges(lines)} ${changes}${r.transfer_wait_min > 0 ? ` · includes ~${fmtMin(r.transfer_wait_min)} waiting at changes` : ""}</div>
      <div class="meta">Expected ~${fmtMin(r.expected_min)} with an average first wait</div>
      ${r.excludes_far_access ? `<div class="meta">Times exclude getting to or from a station beyond your ${fmtDist(filters.maxWalkM)} max walk.</div>` : ""}
    </div>
    ${walkAlt}
    ${journeyHtml(r)}
    ${r.uses_estimate ? `<div class="note">This route uses estimated values (marked above). Times may differ from the real service.</div>` : ""}
  </div>`;
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
    return;
  }
  const r = tab === "fewest" && res.fewest ? res.fewest : res.fastest;
  const tabs = res.fewest ? `<div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="fastest" aria-selected="${r === res.fastest}">Fastest · ${fmtMin(res.fastest.expected_min)}</button>
      <button type="button" role="tab" data-tab="fewest" aria-selected="${r === res.fewest}">Fewest changes · ${res.fewest.transfers}</button>
    </div>` : "";
  out.innerHTML = note + tabs + routeCard(r, res);
  out.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));
  wireResultButtons(out);
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
function applyFilters() { saveFilters(); drawFilters(); render(); }
function resetFilters() { filters = { ...DEFAULT_FILTERS, modes: [...DEFAULT_FILTERS.modes] }; applyFilters(); }
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

// Stations and typed places are remembered; the current location never is.
function save() {
  const keep = (e) => (e && !e.geo ? e : null);
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
  setupPicker("from");
  setupPicker("to");
  $("swap").addEventListener("click", () => {
    const f = picked.from, t = picked.to;
    setPicked("from", t); setPicked("to", f); save(); render();
  });
  setupFilters();
  $("day").addEventListener("change", render);
  $("time").addEventListener("change", render);
  showBanner();
  restore();
  render();
}

main().catch((e) => { $("results").innerHTML = `<p class="msg">Could not load network data: ${esc(e.message)}</p>`; });
