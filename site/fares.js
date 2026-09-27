// Fares per route (PLAN.md §4d). Pure module: works in the browser and in Node.
//
// Each ride leg belongs to its line's fare system (network.json `fares.systems`). Consecutive ride
// legs in the same system form one fare segment (e.g. KTM 1 -> KTM 2, or Rapid KL lines via a
// transfer). Segments in different systems are priced separately and added together.
// A segment is priced only from a published table in the data; otherwise it's "unavailable" and the
// UI links to the operator. Rapid KL and KTM have no fare data yet, by decision.

function systemOfLine(net, lineId) {
  for (const [id, sys] of Object.entries(net.fares?.systems || {})) if (sys.lines.includes(lineId)) return id;
  return null;
}

const localId = (stopId) => stopId.slice(stopId.lastIndexOf(":") + 1);

function lookup(table, from, to) {
  const a = localId(from), b = localId(to);
  for (const [x, y, price] of table.pairs) {
    if ((x === a && y === b) || (table.symmetric && x === b && y === a)) return price;
  }
  return null;
}

// route: a router result (fastest/fewest). Returns null if the network has no fare data at all.
export function computeFares(net, route) {
  if (!net.fares) return null;
  const segments = [];
  for (const leg of route.legs) {
    if (leg.type !== "ride") continue;
    const system = systemOfLine(net, leg.line);
    const last = segments[segments.length - 1];
    if (last && last.system === system) { last.to = leg.to; last.lines.push(leg.line); continue; }
    segments.push({ system, from: leg.from, to: leg.to, lines: [leg.line] });
  }
  for (const seg of segments) {
    const sys = net.fares.systems[seg.system] || {};
    seg.name = sys.name || seg.system;
    seg.fare_url = sys.fare_url || null;
    seg.link_text = sys.link_text || seg.name;
    seg.price = sys.table ? lookup(sys.table, seg.from, seg.to) : null;
    if (seg.price != null) {
      seg.as_of = sys.table.retrieved;
      seg.source_label = sys.source_label || seg.name;
      seg.source_url = sys.table.source;
    }
  }
  const known = segments.filter((s) => s.price != null);
  const missing = segments.filter((s) => s.price == null);
  const knownTotal = Math.round(known.reduce((a, s) => a + s.price, 0) * 100) / 100;
  // one "Fares as of ..." line per source actually used
  const sources = [];
  for (const s of known) {
    if (!sources.some((x) => x.label === s.source_label && x.as_of === s.as_of)) sources.push({ label: s.source_label, as_of: s.as_of, url: s.source_url });
  }
  return {
    segments,
    complete: missing.length === 0,
    known_total: knownTotal,
    missing_names: [...new Set(missing.map((s) => s.name))],
    added_together: segments.length > 1,
    sources,
    currency: "RM",
  };
}

// "RM 14.00" / "from RM 14.00 + Rapid KL fare" / null when nothing is known.
export function fareSummary(f) {
  if (!f || !f.segments.length) return null;
  const rm = (x) => `RM ${x.toFixed(2)}`;
  if (f.complete) return rm(f.known_total);
  if (f.known_total > 0) return `from ${rm(f.known_total)} + ${f.missing_names.map((n) => `${n} fare`).join(" + ")}`;
  return null;
}
