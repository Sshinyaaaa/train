// Route filter tests on synthetic networks (PLAN.md §4c). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork, route, suggestModes, accessCandidates, distanceM, MODES } from "../site/router.js";

const LAT = 3.0;
const M_PER_DEG_LON = distanceM({ lat: LAT, lon: 101 }, { lat: LAT, lon: 102 });
const lonAt = (m) => 101 + m / M_PER_DEG_LON;
const place = (m, name = "P") => ({ type: "place", lat: LAT, lon: lonAt(m), name });

// stations: {id: metresEast}; lines: {id: {mode, stops, run}}; transfers: [[a, b, walk_min]]
function makeNet(stations, lines, transfers = []) {
  const hw = { weekday: [[0, 86400, 600]], saturday: [[0, 86400, 600]], sunday: [[0, 86400, 600]] };
  const stops = {}, sts = {};
  for (const [id, m] of Object.entries(stations)) {
    stops[id] = { name: id, lat: LAT, lon: lonAt(m), lines: [], station: id };
    sts[id] = { name: id, lat: LAT, lon: lonAt(m), stops: [id] };
  }
  const ls = {};
  for (const [id, l] of Object.entries(lines)) {
    ls[id] = { name: id, display: { mode: l.mode, number: id, name: id, label: id },
               patterns: [{ dir: 0, stops: l.stops, run_sec: l.run, run_source: "gtfs", headways: hw, headway_source: "gtfs_frequencies" }] };
    for (const s of l.stops) stops[s].lines.push(id);
  }
  const tr = transfers.map(([from, to, walk_min]) => ({ from, to, kind: "connecting", walk_min, walk_source: "manual", exits_gates: false }));
  return loadNetwork({ meta: { gate_penalty_min: 5 }, stops, stations: sts, lines: ls, transfers: tr });
}

test("disabled modes are never boarded", () => {
  // A -> D by a fast MRT or a slow LRT.
  const g = makeNet({ A: 0, D: 20000 }, {
    M: { mode: "MRT", stops: ["A", "D"], run: [0, 600] },
    L: { mode: "LRT", stops: ["A", "D"], run: [0, 1800] },
  });
  assert.deepEqual(route(g, "A", "D").fastest.lines, ["M"]);
  assert.deepEqual(route(g, "A", "D", { modes: ["LRT"] }).fastest.lines, ["L"]);
  assert.deepEqual(route(g, "A", "D", { modes: ["MRT"] }).fastest.lines, ["M"]);
  assert.equal(route(g, "A", "D", { modes: ["KTM"] }), null);
});

test("transfers between enabled lines work; a disabled line in between blocks the route", () => {
  // A -(MRT)-> B ~walk~ C -(LRT)-> D, or A -(KTM)-> D directly (slower)
  const g = makeNet({ A: 0, B: 5000, C: 5200, D: 15000 }, {
    M: { mode: "MRT", stops: ["A", "B"], run: [0, 300] },
    L: { mode: "LRT", stops: ["C", "D"], run: [0, 300] },
    K: { mode: "KTM", stops: ["A", "D"], run: [0, 3600] },
  }, [["B", "C", 3]]);
  const r = route(g, "A", "D", { modes: ["MRT", "LRT"] }).fastest;
  assert.deepEqual(r.lines, ["M", "L"]);
  assert.deepEqual(route(g, "A", "D", { modes: ["MRT", "KTM"] }).fastest.lines, ["K"]);
});

test("access candidates only include stations an enabled mode serves", () => {
  // Place at 0: LRT-only station 100 m away, MRT station 800 m away.
  const g = makeNet({ L1: 100, M1: 800, D: 20000 }, {
    L: { mode: "LRT", stops: ["L1", "D"], run: [0, 600] },
    M: { mode: "MRT", stops: ["M1", "D"], run: [0, 600] },
  });
  assert.deepEqual(accessCandidates(g.net, place(0), { modes: ["MRT"] }).map((c) => c.station), ["M1"]);
  assert.deepEqual(accessCandidates(g.net, place(0)).map((c) => c.station), ["L1", "M1"]);
  const r = route(g, place(0), "D", { modes: ["MRT"] }).fastest;
  assert.equal(r.legs[0].stop, "M1");
});

test("suggestModes: only modes that give a route, fastest first", () => {
  // A -> D needs LRT (fast) or KTM (slow); BRT and MRT don't help.
  const g = makeNet({ A: 0, D: 20000, X: 40000 }, {
    L: { mode: "LRT", stops: ["A", "D"], run: [0, 900] },
    K: { mode: "KTM", stops: ["A", "D"], run: [0, 2400] },
    M: { mode: "MRT", stops: ["D", "X"], run: [0, 600] },
    B: { mode: "BRT", stops: ["X", "D"], run: [0, 600] },
  });
  assert.equal(route(g, "A", "D", { modes: ["MRT"] }), null);
  const s = suggestModes(g, "A", "D", { modes: ["MRT"] });
  assert.deepEqual(s.map((x) => x.mode), ["LRT", "KTM"]);
  assert.ok(s[0].expected_min < s[1].expected_min);
  assert.ok(Math.abs(s[0].journey_min - 15) < 0.2);
  // nothing to suggest when all modes are already on
  assert.deepEqual(suggestModes(g, "A", "D", { modes: MODES }), []);
});

test("max walk cut-off: 500 m / 1 km / 2 km, then far fallback", () => {
  const g = makeNet({ S700: 700, S1500: 1500, S1800: 1800 }, {});
  const at = (maxDistM) => accessCandidates(g.net, place(0), { maxDistM });
  assert.deepEqual(at(1000).map((c) => [c.station, c.far]), [["S700", false]]);
  assert.deepEqual(at(2000).map((c) => [c.station, c.far]), [["S700", false], ["S1500", false], ["S1800", false]]);
  // 500 m: nothing in range, so the nearest 2 are used and marked far
  assert.deepEqual(at(500).map((c) => [c.station, c.far]), [["S700", true], ["S1500", true]]);
});

test("max walk changes the route: a far first walk is excluded from the times", () => {
  const g = makeNet({ S: 700, D: 20000 }, { L: { mode: "LRT", stops: ["S", "D"], run: [0, 600] } });
  const near = route(g, place(0), "D", { maxWalkM: 1000 }).fastest;
  const far = route(g, place(0), "D", { maxWalkM: 500 }).fastest;
  assert.equal(near.legs[0].far, false);
  assert.equal(far.legs[0].far, true);
  assert.equal(far.legs[0].walk_min, null);
  assert.ok(far.journey_min < near.journey_min);   // the 700 m walk is no longer counted
  assert.equal(far.excludes_far_access, true);
});
