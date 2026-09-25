// Rail router over network.json (PLAN.md §4). Plain ES module: works in the browser and in Node.
//
// States: "s|<stop>" = standing at a line-stop (not on a train);
//         "p|<line>|<pattern>|<i>" = on a train at stop index i of a pattern.
// Edges:  board (wait = headway/2 for the band containing the current clock time),
//         ride (run_sec difference), alight (0), transfer (walk + gate penalty).
// Costs are seconds. Waiting at the first boarding is the "initial wait": it counts toward
// expected_min but not journey_min.

export const DEFAULT_QUERY = { day: "weekday", time: "11:00" };

export function loadNetwork(net) {
  const boards = new Map();    // stop -> [{line, pi, i}]
  const transfers = new Map(); // stop -> [{to, t}]
  for (const [lid, line] of Object.entries(net.lines)) {
    line.patterns.forEach((p, pi) => {
      p.stops.forEach((s, i) => {
        if (i === p.stops.length - 1) return;
        if (!boards.has(s)) boards.set(s, []);
        boards.get(s).push({ line: lid, pi, i });
      });
    });
  }
  for (const t of net.transfers) {
    for (const [a, b] of [[t.from, t.to], [t.to, t.from]]) {
      if (!transfers.has(a)) transfers.set(a, []);
      transfers.get(a).push({ to: b, t });
    }
  }
  return { net, boards, transfers, gatePenaltyMin: net.meta.gate_penalty_min ?? 0 };
}

export function parseTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60;
}

// Headway (s) of a pattern at clock time t (s since service-day midnight), or null if not running.
// Bands may extend past 24:00 (GTFS), so an early-morning query also checks t + 24 h.
export function headwayAt(pattern, day, t) {
  for (const tt of [t, t + 86400]) {
    for (const [start, end, hw] of pattern.headways[day] || []) {
      if (tt >= start && tt <= end) return hw;
    }
  }
  return null;
}

function transferCost(g, t) {
  return (t.walk_min + (t.exits_gates === true ? g.gatePenaltyMin : 0)) * 60;
}

class Heap {
  constructor(less) { this.a = []; this.less = less; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

// Access legs (PLAN.md §4b): place <-> station walking, straight line x 1.3 at 4.5 km/h.
export const ACCESS = { maxDistM: 2000, nearest: 4, farFallback: 2, detour: 1.3, speedMPerMin: 75 };

export function distanceM(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad, dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const walkSec = (distM) => (distM * ACCESS.detour / ACCESS.speedMPerMin) * 60;

// Candidate stations for a point: the 4 nearest within 2 km; if none, the nearest 2 marked far.
// A station's distance is to its nearest line-stop; each line-stop keeps its own walk.
export function accessCandidates(net, point) {
  const all = Object.entries(net.stations).map(([id, st]) => {
    const stops = st.stops.map((s) => ({ stop: s, dist_m: distanceM(point, net.stops[s]) }));
    return { station: id, dist_m: Math.min(...stops.map((x) => x.dist_m)), stops };
  }).sort((a, b) => a.dist_m - b.dist_m);
  const near = all.filter((c) => c.dist_m <= ACCESS.maxDistM).slice(0, ACCESS.nearest);
  const picked = near.length ? near : all.slice(0, ACCESS.farFallback);
  const far = near.length === 0;
  return picked.map((c) => ({ ...c, far, stops: c.stops.map((x) => ({ ...x, walk_sec: walkSec(x.dist_m) })) }));
}

function normEndpoint(e) {
  return typeof e === "string" ? { type: "station", id: e } : e;
}

// Endpoint -> [{stop, sec, far, station, dist_m, walk}] (sec = walk; 0 for a station endpoint).
function endpointStops(net, e) {
  if (e.type === "station") {
    return net.stations[e.id].stops.map((s) => ({ stop: s, sec: 0, far: false, station: e.id, dist_m: 0, walk: false }));
  }
  return accessCandidates(net, e).flatMap((c) => c.stops.map((x) => (
    { stop: x.stop, sec: x.walk_sec, far: c.far, station: c.station, dist_m: x.dist_m, walk: true })));
}

// mode "fastest": minimise (expected, boardings); "fewest": minimise (boardings, expected).
function search(g, from, to, query, mode) {
  const { net } = g;
  const t0 = parseTime(query.time);
  const key = mode === "fastest" ? (l) => [l.cost, l.boardings] : (l) => [l.boardings, l.cost];
  const less = (x, y) => {
    const a = key(x), b = key(y);
    return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
  };
  const best = new Map();
  const heap = new Heap(less);
  const targets = new Map();
  for (const t of endpointStops(net, to)) {
    const cur = targets.get(t.stop);
    if (!cur || t.sec < cur.sec) targets.set(t.stop, t);
  }
  const needRide = from.type === "place" && to.type === "place";
  const stationOf = (stop) => net.stops[stop].station;
  const seen = (chain, st) => { for (let c = chain; c; c = c.prev) if (c.st === st) return true; return false; };
  // Virtual start: every candidate line-stop, seeded with its own access walk.
  for (const o of endpointStops(net, from)) {
    const edge = o.walk ? { type: "access", place: from.name, stop: o.stop, dist_m: o.dist_m, sec: o.sec, far: o.far } : null;
    const l = { state: `s|${o.stop}`, cost: o.sec, farSec: o.far ? o.sec : 0, boardings: 0, initialWait: 0, initialHeadway: 0,
                prev: null, edge, station: o.station, visited: { st: o.station, prev: null } };
    const cur = best.get(l.state);
    if (!cur || less(l, cur)) { best.set(l.state, l); heap.push(l); }
  }
  // A route may not return to a station it has already left (stations passed through on a train
  // count). The check is on each label's own path; with one best label per state this is a
  // heuristic rather than an exact constrained shortest path, which is fine at this network size.
  const relax = (from, state, stop, dcost, edge, extra = {}) => {
    let st = from.station, visited = from.visited;
    if (stop != null) {
      st = stationOf(stop);
      if (st !== from.station) {
        if (seen(visited, st)) return;
        visited = { st, prev: visited };
      }
    }
    const l = { state, cost: from.cost + dcost, farSec: from.farSec, boardings: from.boardings, initialWait: from.initialWait,
                initialHeadway: from.initialHeadway, prev: from, edge, station: st, visited, ...extra };
    const cur = best.get(state);
    if (!cur || less(l, cur)) { best.set(state, l); heap.push(l); }
  };
  while (heap.size) {
    const l = heap.pop();
    if (best.get(l.state) !== l) continue;
    if (l.state === "END") return l;
    const parts = l.state.split("|");
    if (parts[0] === "s") {
      const stop = parts[1];
      const t = targets.get(stop);
      if (t && (!needRide || l.boardings > 0)) {
        // Virtual end: egress walk (0 for a station destination).
        const edge = { type: "egress", place: to.name, stop, dist_m: t.dist_m, sec: t.sec, far: t.far, walk: t.walk };
        relax(l, "END", null, t.sec, edge, { farSec: l.farSec + (t.far ? t.sec : 0) });
      }
      for (const b of g.boards.get(stop) || []) {
        const p = net.lines[b.line].patterns[b.pi];
        const hw = headwayAt(p, query.day, t0 + l.cost);
        if (hw == null) continue;
        const wait = hw / 2, first = l.boardings === 0;
        relax(l, `p|${b.line}|${b.pi}|${b.i}`, stop, wait, { type: "board", line: b.line, pi: b.pi, i: b.i, wait, headway: hw },
              { boardings: l.boardings + 1, initialWait: first ? wait : l.initialWait, initialHeadway: first ? hw : l.initialHeadway });
      }
      for (const { to: next, t: tr } of g.transfers.get(stop) || []) {
        relax(l, `s|${next}`, next, transferCost(g, tr), { type: "transfer", from: stop, to: next, t: tr });
      }
    } else {
      const [, line, piS, iS] = parts;
      const pi = Number(piS), i = Number(iS);
      const p = net.lines[line].patterns[pi];
      relax(l, `s|${p.stops[i]}`, p.stops[i], 0, { type: "alight", line, pi, i });
      if (i + 1 < p.stops.length) {
        relax(l, `p|${line}|${pi}|${i + 1}`, p.stops[i + 1], p.run_sec[i + 1] - p.run_sec[i], { type: "ride", line, pi, from: i, to: i + 1 });
      }
    }
  }
  return null;
}

const round1 = (sec) => Math.round(sec / 6) / 10;

function buildRoute(g, label) {
  const { net } = g;
  const edges = [];
  for (let l = label; l && l.edge; l = l.prev) edges.push(l.edge);
  edges.reverse();
  const legs = [];
  let ride = null;
  for (const e of edges) {
    if (e.type === "board") {
      const line = net.lines[e.line], p = line.patterns[e.pi];
      ride = { type: "ride", line: e.line, line_label: line.display?.label ?? line.name,
               line_number: line.display?.number ?? "", line_name: line.display?.name ?? line.name, color: line.color,
               towards: p.stops[p.stops.length - 1], from: p.stops[e.i], to: p.stops[e.i], stops: [p.stops[e.i]],
               ride_min: 0, wait_min: round1(e.wait), headway_min: round1(e.headway),
               run_source: p.run_source, headway_source: p.headway_source, flags: [], _start: p.run_sec[e.i],
               _pi: p, _i0: e.i, _i1: e.i };
      if (p.run_source === "estimated") ride.flags.push("estimated_run");
      if (p.headway_source === "gtfs_typical") ride.flags.push("typical_headway");
    } else if (e.type === "ride") {
      const p = net.lines[e.line].patterns[e.pi];
      ride.to = p.stops[e.to]; ride.stops.push(p.stops[e.to]);
      ride.ride_min = round1(p.run_sec[e.to] - ride._start);
      ride._i1 = e.to;
    } else if (e.type === "alight") {
      // segment-level estimates (pattern overrides): segment i is stops[i] -> stops[i+1]
      const est = ride._pi.estimated_segments || [];
      if (!ride.flags.includes("estimated_run") && est.some((i) => i >= ride._i0 && i < ride._i1)) ride.flags.push("estimated_run");
      delete ride._start; delete ride._pi; delete ride._i0; delete ride._i1;
      legs.push(ride); ride = null;
    } else if (e.type === "access" || e.type === "egress") {
      if (e.type === "egress" && !e.walk) continue;   // station destination: nothing to show
      legs.push({ type: e.type, place: e.place, stop: e.stop, dist_m: Math.round(e.dist_m),
                  walk_min: e.far ? null : round1(e.sec), far: e.far, flags: e.far ? ["far_access"] : [] });
    } else if (e.type === "transfer") {
      const t = e.t, flags = [];
      if (t.walk_source === "estimated") flags.push("estimated_walk");
      if (t.exits_gates == null) flags.push("gates_unknown");
      legs.push({ type: "transfer", from: e.from, to: e.to, kind: t.kind, walk_min: t.walk_min,
                  walk_source: t.walk_source, exits_gates: t.exits_gates,
                  gate_penalty_min: t.exits_gates === true ? g.gatePenaltyMin : 0, flags });
    }
  }
  const rides = legs.filter(x => x.type === "ride");
  rides.forEach((r, i) => { r.first = i === 0; });
  // A change between two rides with no walk leg (e.g. KTM 1 <-> KTM 2 at a shared stop).
  const withChanges = [];
  legs.forEach((x, i) => {
    withChanges.push(x);
    if (x.type === "ride" && legs[i + 1]?.type === "ride") {
      withChanges.push({ type: "transfer", from: x.to, to: x.to, kind: "same_stop", walk_min: 0,
                         walk_source: "none", exits_gates: null, gate_penalty_min: 0, flags: [] });
    }
  });
  const flags = [...new Set(withChanges.flatMap(x => x.flags))];
  return {
    // far access/egress legs (no station within 2 km) are shown as distances, not counted in times
    expected_min: round1(label.cost - label.farSec),
    journey_min: round1(label.cost - label.farSec - label.initialWait),
    excludes_far_access: label.farSec > 0,
    initial_wait_min: round1(label.initialWait),
    initial_headway_min: round1(label.initialHeadway),   // worst-case first wait ("up to")
    transfer_wait_min: Math.round(rides.slice(1).reduce((a, r) => a + r.wait_min, 0) * 10) / 10,
    stations: stationsVisited(label),
    transfers: Math.max(0, rides.length - 1),
    lines: rides.map(r => r.line),
    legs: withChanges,
    flags,
    uses_estimate: flags.some(f => f.startsWith("estimated") || f === "typical_headway"),
  };
}

function stationsVisited(label) {
  const out = [];
  for (let c = label.visited; c; c = c.prev) out.push(c.st);
  return out.reverse();
}

const pointOf = (net, e) => (e.type === "station" ? net.stations[e.id] : e);

// from / to: a station id string, {type: "station", id}, or {type: "place", lat, lon, name}.
// Returns { fastest, fewest, query, direct_walk_min } or null if no route.
// fewest is null when identical to fastest.
export function route(g, fromEp, toEp, query = DEFAULT_QUERY) {
  const q = { ...DEFAULT_QUERY, ...query };
  const from = normEndpoint(fromEp), to = normEndpoint(toEp);
  for (const e of [from, to]) {
    if (e.type === "station" && !g.net.stations[e.id]) throw new Error("unknown station");
    if (e.type === "place" && !(Number.isFinite(e.lat) && Number.isFinite(e.lon))) throw new Error("bad place");
  }
  if (from.type === "station" && to.type === "station" && from.id === to.id) return null;
  const f = search(g, from, to, q, "fastest");
  if (!f) return null;
  const fastest = buildRoute(g, f);
  const fewest = buildRoute(g, search(g, from, to, q, "fewest"));
  const same = JSON.stringify(fastest.legs) === JSON.stringify(fewest.legs);
  const res = { fastest, fewest: same ? null : fewest, query: q, direct_walk_min: null };
  if (from.type === "place" || to.type === "place") {
    res.direct_walk_min = round1(walkSec(distanceM(pointOf(g.net, from), pointOf(g.net, to))));
  }
  return res;
}
