import { loadNetwork, route, DEFAULT_QUERY } from "./router.js";

// Display-only colours for lines whose data has no colour (ERL lines are manual overrides).
// Approximations of the reference map, not official values.
const FALLBACK_COLOR = { "erl-klia-ekspres": "#8b3f96", "erl-klia-transit": "#1aa3b0" };
const ACRONYMS = new Set(["KL", "KLCC", "KLIA", "PWTC", "UOB", "USJ", "USJ7", "SS", "TRX", "UKM", "UPM", "IOI",
  "CBP", "BU", "BK", "UITM", "KTM", "T1", "T2", "SA", "MRT", "LRT", "DR"]);

const $ = (id) => document.getElementById(id);
let net, graph, stations = [];
const picked = { from: null, to: null };
let tab = "fastest";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const color = (lid) => net.lines[lid].color || FALLBACK_COLOR[lid] || "#888";
const fmtMin = (m) => `${Math.round(m)} min`;

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
  return ids;
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

const dotsHtml = (lines) => `<span class="dots">${lines.map((l) => `<span class="dot" style="background:${color(l)}" title="${esc(net.lines[l].name)}"></span>`).join("")}</span>`;
const linesText = (lines) => lines.map((l) => net.lines[l].short).join(" · ");
const label = (s) => (s.dup ? `${s.name} (${linesText(s.lines)})` : s.name);

function search(q) {
  const k = q.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!k) return stations.slice(0, 0);
  const starts = [], contains = [];
  for (const s of stations) {
    const i = s.key.indexOf(k);
    if (i === 0) starts.push(s); else if (i > 0) contains.push(s);
  }
  return starts.concat(contains).slice(0, 12);
}

function setupPicker(role) {
  const input = $(role), list = $(`${role}-list`);
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const choose = (s) => { picked[role] = s.id; input.value = label(s); close(); save(); render(); };
  const draw = () => {
    list.innerHTML = items.map((s, i) => `<li role="option" id="${role}-opt-${i}" aria-selected="${i === active}" data-i="${i}">
      ${dotsHtml(s.lines)}<span class="name">${esc(s.name)}</span><span class="lines">${esc(linesText(s.lines))}</span></li>`).join("");
    list.hidden = items.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${role}-opt-${active}`);
  };
  input.addEventListener("input", () => { picked[role] = null; items = search(input.value); active = items.length ? 0 : -1; draw(); render(); });
  input.addEventListener("focus", () => { if (input.value && !picked[role]) { items = search(input.value); draw(); } });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter") { if (items[active]) choose(items[active]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (li) { e.preventDefault(); choose(items[Number(li.dataset.i)]); }
  });
  input.addEventListener("blur", () => setTimeout(close, 100));
}

function setPicked(role, id) {
  picked[role] = id;
  const s = stations.find((x) => x.id === id);
  $(role).value = s ? label(s) : "";
}

function stopName(sid) { return pretty(net.stops[sid].name); }
function stopLines(sid) { return net.stops[sid].lines.map((l) => net.lines[l].short).join(" · "); }

const FLAG_TEXT = {
  estimated_run: "estimated ride time",
  typical_headway: "average wait (not timetable)",
  estimated_walk: "estimated walk",
};
const estTags = (flags) => flags.filter((f) => FLAG_TEXT[f]).map((f) => `<span class="est">${FLAG_TEXT[f]}</span>`).join("");

function journeyHtml(r) {
  const rows = [];
  const node = (c, dashed, st, detail) => rows.push(`<li class="stop"><div class="rail${dashed ? " dashed" : ""}" style="--c:${c}"><span class="node"></span></div>
    <div class="body"><div class="st">${st}</div>${detail ? `<div class="detail">${detail}</div>` : ""}</div></li>`);
  const seg = (c, dashed, detail) => rows.push(`<li class="stop"><div class="rail${dashed ? " dashed" : ""}" style="--c:${c}"></div>
    <div class="body"><div class="detail">${detail}</div></div></li>`);
  r.legs.forEach((leg, i) => {
    if (leg.type === "ride") {
      const c = color(leg.line);
      const mid = leg.stops.slice(1, -1).map(stopName);
      node(c, false, esc(stopName(leg.from)), r.legs[i - 1]?.kind === "same_stop" ? "Change trains here" : "");
      seg(c, false, `<span class="pill" style="background:${c}">${esc(leg.line_short)}</span>
        towards ${esc(stopName(leg.towards))}<br>
        ${leg.first ? `wait up to ${fmtMin(leg.headway_min)}` : `wait ~${fmtMin(leg.wait_min)}`} · ride ${fmtMin(leg.ride_min)}, ${leg.stops.length - 1} stop${leg.stops.length === 2 ? "" : "s"}
        ${estTags(leg.flags)}
        ${mid.length ? `<details class="stops"><summary>${mid.length} intermediate stop${mid.length === 1 ? "" : "s"}</summary>${mid.map(esc).join(" · ")}</details>` : ""}`);
      const next = r.legs[i + 1];
      if (!next) node(c, false, esc(stopName(leg.to)), "Arrive");
      else if (next.type === "transfer" && next.kind !== "same_stop") node(c, false, esc(stopName(leg.to)), "Get off");
    } else if (leg.kind === "same_stop") {
      // drawn by the next ride leg's first node
    } else {
      if (i === 0) node("var(--walk)", false, esc(stopName(leg.from)), `Start · ${esc(stopLines(leg.from))}`);
      const gates = leg.exits_gates === true ? ` · exits fare gates (+${leg.gate_penalty_min} min)` : "";
      seg("var(--walk)", true, `Walk ~${fmtMin(leg.walk_min)} to ${esc(stopName(leg.to))} (${esc(stopLines(leg.to))})${gates} ${estTags(leg.flags)}`);
      if (i === r.legs.length - 1) node("var(--walk)", false, esc(stopName(leg.to)), "Arrive");
    }
  });
  return `<ol class="journey">${rows.join("")}</ol>`;
}

function routeCard(r) {
  const lines = [...new Set(r.lines)];
  const changes = r.transfers === 0 ? "direct" : `${r.transfers} change${r.transfers === 1 ? "" : "s"}`;
  return `<div class="card">
    <div class="summary">
      <div class="big">~${fmtMin(r.journey_min)} <span class="meta">+ up to ${fmtMin(r.initial_headway_min)} wait</span></div>
      <div class="meta">${dotsHtml(lines)} ${changes} · expected ~${fmtMin(r.expected_min)} including average wait</div>
    </div>
    ${journeyHtml(r)}
    ${r.uses_estimate ? `<div class="note">This route uses estimated values (marked above). Times may differ from the real service.</div>` : ""}
  </div>`;
}

function render() {
  const out = $("results");
  if (!picked.from || !picked.to) { out.innerHTML = ""; return; }
  if (picked.from === picked.to) { out.innerHTML = `<p class="msg">Origin and destination are the same station.</p>`; return; }
  const q = { day: $("day").value, time: $("time").value || DEFAULT_QUERY.time };
  const res = route(graph, picked.from, picked.to, q);
  if (!res) { out.innerHTML = `<p class="msg">No route found at this time. Lines may not be running.</p>`; return; }
  const r = tab === "fewest" && res.fewest ? res.fewest : res.fastest;
  const tabs = res.fewest ? `<div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="fastest" aria-selected="${r === res.fastest}">Fastest · ${fmtMin(res.fastest.expected_min)}</button>
      <button type="button" role="tab" data-tab="fewest" aria-selected="${r === res.fewest}">Fewest changes · ${res.fewest.transfers}</button>
    </div>` : "";
  out.innerHTML = tabs + routeCard(r);
  out.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));
}

function save() {
  try { localStorage.setItem("klrail", JSON.stringify({ from: picked.from, to: picked.to })); } catch {}
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem("klrail") || "{}");
    if (s.from && net.stations[s.from]) setPicked("from", s.from);
    if (s.to && net.stations[s.to]) setPicked("to", s.to);
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
  $("day").addEventListener("change", render);
  $("time").addEventListener("change", render);
  showBanner();
  restore();
  render();
}

main().catch((e) => { $("results").innerHTML = `<p class="msg">Could not load network data: ${esc(e.message)}</p>`; });
