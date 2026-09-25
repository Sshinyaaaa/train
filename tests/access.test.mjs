// Access-leg tests on synthetic coordinates (PLAN.md §4b). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { loadNetwork, route, accessCandidates, distanceM, walkSec, ACCESS } from "../site/router.js";

const LAT = 3.0;
const M_PER_DEG_LON = distanceM({ lat: LAT, lon: 101 }, { lat: LAT, lon: 102 });
const lonAt = (m) => 101 + m / M_PER_DEG_LON;          // a point m metres east of lon 101
const place = (m, name = "P") => ({ type: "place", lat: LAT, lon: lonAt(m), name });

// stations: {id: metresEast}; lines: {id: {stops: [ids], run: [cumulative sec]}}, one direction each.
function makeNet(stations, lines) {
  const hw = { weekday: [[0, 86400, 600]], saturday: [[0, 86400, 600]], sunday: [[0, 86400, 600]] };
  const stops = {}, sts = {};
  for (const [id, m] of Object.entries(stations)) {
    stops[id] = { name: id, lat: LAT, lon: lonAt(m), lines: [], station: id };
    sts[id] = { name: id, lat: LAT, lon: lonAt(m), stops: [id] };
  }
  const ls = {};
  for (const [id, l] of Object.entries(lines)) {
    ls[id] = { name: id, patterns: [{ dir: 0, stops: l.stops, run_sec: l.run, run_source: "gtfs", headways: hw, headway_source: "gtfs_frequencies" }] };
    for (const s of l.stops) stops[s].lines.push(id);
  }
  return { meta: { gate_penalty_min: 5 }, stops, stations: sts, lines: ls, transfers: [] };
}

test("walk time = distance x 1.3 at 4.5 km/h", () => {
  assert.equal(ACCESS.detour, 1.3);
  assert.equal(walkSec(750), 780);          // 750 m * 1.3 / 75 m/min = 13 min
  assert.equal(walkSec(0), 0);
});

test("picks the 4 nearest stations within 2 km, nearest first", () => {
  const net = makeNet({ A: 100, B: 300, C: 700, D: 1200, E: 1500, F: 1900 }, {});
  const c = accessCandidates(net, place(0));
  assert.deepEqual(c.map((x) => x.station), ["A", "B", "C", "D"]);
  assert.ok(c.every((x) => !x.far));
  assert.ok(Math.abs(c[0].dist_m - 100) < 1);
});

test("2 km cut-off: stations beyond 2 km are not candidates when one is within", () => {
  const net = makeNet({ NEAR: 1900, FAR1: 2100, FAR2: 2500 }, {});
  const c = accessCandidates(net, place(0));
  assert.deepEqual(c.map((x) => x.station), ["NEAR"]);
  assert.equal(c[0].far, false);
});

test("no station within 2 km: nearest 2 are used and marked far", () => {
  const net = makeNet({ S1: 5000, S2: 3000, S3: 9000 }, {});
  const c = accessCandidates(net, place(0));
  assert.deepEqual(c.map((x) => x.station), ["S2", "S1"]);
  assert.ok(c.every((x) => x.far));
});

test("virtual start picks the best combination, not the nearest station", () => {
  // Origin at 0. SLOW line from A (300 m away) takes 50 min; FAST line from B (600 m) takes 5 min.
  const net = makeNet({ A: 300, B: -600, D: 20000 }, {
    SLOW: { stops: ["A", "D"], run: [0, 3000] },
    FAST: { stops: ["B", "D"], run: [0, 300] },
  });
  const r = route(loadNetwork(net), place(0, "Home"), "D").fastest;
  assert.deepEqual(r.lines, ["FAST"]);
  const access = r.legs[0];
  assert.equal(access.type, "access");
  assert.equal(access.stop, "B");
  assert.equal(access.place, "Home");
  assert.ok(Math.abs(access.dist_m - 600) <= 1);
  assert.equal(access.walk_min, Math.round(walkSec(600) / 6) / 10);
  // journey = walk + ride; expected adds half the 10-min headway
  assert.ok(Math.abs(r.journey_min - (walkSec(600) + 300) / 60) < 0.2);
  assert.ok(Math.abs(r.expected_min - r.journey_min - 5) < 0.2);
});

test("virtual end picks the best egress, and the egress walk is the last leg", () => {
  // From station O the line runs to X (500 m from the destination) then Y (100 m) 20 min later.
  const net = makeNet({ O: -30000, X: 500, Y: -100 }, { L: { stops: ["O", "X", "Y"], run: [0, 600, 1800] } });
  const r = route(loadNetwork(net), "O", place(0, "Office")).fastest;
  const last = r.legs[r.legs.length - 1];
  assert.equal(last.type, "egress");
  assert.equal(last.stop, "X");                 // alight at X and walk 500 m beats riding 20 min more
  assert.equal(last.place, "Office");
});

test("far access legs are shown as distance and excluded from the times", () => {
  const net = makeNet({ S: 5000, D: 30000 }, { L: { stops: ["S", "D"], run: [0, 600] } });
  const r = route(loadNetwork(net), place(0), "D").fastest;
  const a = r.legs[0];
  assert.equal(a.type, "access");
  assert.equal(a.far, true);
  assert.equal(a.walk_min, null);
  assert.ok(Math.abs(a.dist_m - 5000) <= 1);
  assert.ok(r.flags.includes("far_access"));
  assert.equal(r.excludes_far_access, true);
  assert.ok(Math.abs(r.journey_min - 10) < 0.2, `journey ${r.journey_min} should be the 10-min ride only`);
});

test("place to place needs a train, and reports the direct walk", () => {
  const net = makeNet({ A: 200, B: 10000 }, { L: { stops: ["A", "B"], run: [0, 600] } });
  const g = loadNetwork(net);
  const res = route(g, place(0, "P1"), place(10100, "P2"));
  assert.equal(res.fastest.transfers, 0);
  assert.deepEqual(res.fastest.lines, ["L"]);
  assert.ok(Math.abs(res.direct_walk_min - walkSec(10100) / 60) < 0.2);
  // both places next to the same single station: no train ride possible, so no route
  assert.equal(route(g, place(0), place(300)), null);
});

test("real network: a point near KLCC boards at KLCC", async () => {
  const { readFileSync } = await import("node:fs");
  const net = JSON.parse(readFileSync(new URL("../site/data/network.json", import.meta.url), "utf8"));
  const g = loadNetwork(net);
  const klcc = net.stops["rapid:KJ10"];
  const p = { type: "place", lat: klcc.lat + 0.001, lon: klcc.lon, name: "Near KLCC" };  // ~110 m north
  const r = route(g, p, "st:rapid:KJ1").fastest;
  assert.equal(r.legs[0].type, "access");
  assert.equal(r.legs[0].stop, "rapid:KJ10");
  assert.ok(r.legs[0].dist_m < 150);
});
