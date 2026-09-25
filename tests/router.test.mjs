// Router tests. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { route, headwayAt, loadNetwork } from "../site/router.js";
import { loadGraph, loadCases, evaluate } from "./known-routes-lib.mjs";

const g = loadGraph();

test("known routes: verified cases must pass; unverified misses are warnings", (t) => {
  for (const c of loadCases()) {
    const r = evaluate(g, c);
    const name = `${c.from} -> ${c.to}`;
    if (r.result === "warning") t.diagnostic(`WARNING ${name} (unverified): ${r.problems.join("; ")}`);
    assert.notEqual(r.result, "FAIL", `${name}: ${r.problems.join("; ")}`);
  }
});

test("journey_min excludes only the initial wait", () => {
  const r = route(g, "st:rapid:KJ1", "st:rapid:KJ10").fastest;
  assert.equal(r.transfers, 0);
  assert.ok(r.journey_min < r.expected_min);
  assert.equal(Math.round((r.expected_min - r.journey_min) * 10), Math.round(r.initial_wait_min * 10));
  assert.equal(r.initial_headway_min, r.initial_wait_min * 2);
});

test("transfer waits count in journey_min", () => {
  const r = route(g, "st:erl-klia-ekspres:klia_t1", "st:rapid:MR6").fastest;
  assert.equal(r.transfers, 1);
  const rides = r.legs.filter((l) => l.type === "ride");
  const walks = r.legs.filter((l) => l.type === "transfer");
  const sum = rides.reduce((a, l) => a + l.ride_min, 0) + rides[1].wait_min + walks.reduce((a, l) => a + l.walk_min, 0);
  assert.ok(Math.abs(r.journey_min - sum) < 0.3, `${r.journey_min} vs ${sum}`);
});

test("estimate flags: KLIA Transit run times and estimated walks are flagged", () => {
  const r = route(g, "st:erl-klia-ekspres:klia_t2", "st:rapid:PY41").fastest;
  assert.ok(r.uses_estimate);
  assert.ok(r.flags.includes("estimated_run") || r.flags.includes("estimated_walk"));
});

test("KTM line change at a shared stop has no walk", () => {
  // Tanjung Malim (KTM 2 only) -> Seputeh (KTM 1 only): the only 1-change route is KTM 2 -> KTM 1
  // at a stop both lines share
  const res = route(g, "st:ktmb:15200", "st:ktmb:19300");
  const r = res.fewest ?? res.fastest;
  const change = r.legs.find((l) => l.type === "transfer");
  assert.equal(r.transfers, 1);
  assert.equal(change.kind, "same_stop");
  assert.equal(change.walk_min, 0);
});

test("same station returns null; unknown station throws", () => {
  assert.equal(route(g, "st:rapid:KJ1", "st:rapid:KJ1"), null);
  assert.throws(() => route(g, "st:nope", "st:rapid:KJ1"));
});

test("headway bands past 24:00 match early-morning queries", () => {
  const p = { headways: { weekday: [[72000, 88200, 1800]] } };
  assert.equal(headwayAt(p, "weekday", 1200), 1800);   // 00:20 -> 24:20
  assert.equal(headwayAt(p, "weekday", 36000), null);  // 10:00 not in band
});

test("no service outside operating hours", () => {
  assert.equal(route(g, "st:rapid:KJ1", "st:rapid:KJ10", { day: "weekday", time: "03:00" }), null);
});

// Tiny network: line L1 A->X->B, line L2 B->X->D. X is one station with two line-stops that have
// no transfer between them, so the only way from A to D is A->X->B->X->D, which revisits X.
function revisitNet() {
  const stop = (id, station) => ({ name: id, lat: 0, lon: 0, lines: [], station });
  const hw = { weekday: [[0, 86400, 600]], saturday: [[0, 86400, 600]], sunday: [[0, 86400, 600]] };
  const pat = (stops) => ({ dir: 0, stops, run_sec: stops.map((_, i) => i * 60), run_source: "gtfs", headways: hw, headway_source: "gtfs_frequencies" });
  return {
    meta: { gate_penalty_min: 5 },
    stops: { a: stop("a", "A"), x1: stop("x1", "X"), b: stop("b", "B"), x2: stop("x2", "X"), d: stop("d", "D") },
    stations: { A: { stops: ["a"] }, X: { stops: ["x1", "x2"] }, B: { stops: ["b"] }, D: { stops: ["d"] } },
    lines: { L1: { name: "L1", patterns: [pat(["a", "x1", "b"])] }, L2: { name: "L2", patterns: [pat(["b", "x2", "d"])] } },
    transfers: [],
  };
}

test("a route may not visit the same station twice", () => {
  const g2 = loadNetwork(revisitNet());
  assert.equal(route(g2, "A", "D"), null, "only path revisits X, so no route");
  assert.ok(route(g2, "A", "B"), "A -> B is fine");
});

test("real network: no returned route visits a station twice", () => {
  const ids = Object.keys(g.net.stations).sort();
  let checked = 0;
  for (let i = 0; i < ids.length; i += 7) {
    for (let j = 3; j < ids.length; j += 11) {
      if (ids[i] === ids[j]) continue;
      const res = route(g, ids[i], ids[j]);
      if (!res) continue;
      for (const r of [res.fastest, res.fewest].filter(Boolean)) {
        assert.equal(new Set(r.stations).size, r.stations.length, `${ids[i]} -> ${ids[j]} revisits: ${r.stations.join(" ")}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 300, `checked ${checked}`);
});

test("Rasa -> KL Sentral is a direct southbound ride (feed-gap override), flagged estimated", () => {
  const r = route(g, "st:ktmb:16300", "st:erl-klia-ekspres:kl_sentral").fastest;
  assert.equal(r.transfers, 0);
  assert.deepEqual(r.lines, ["ktmb:KA15_KD19"]);
  assert.ok(r.flags.includes("estimated_run"));
  assert.equal(new Set(r.stations).size, r.stations.length);
  // northbound comes straight from the feed: no estimated_run flag
  const back = route(g, "st:erl-klia-ekspres:kl_sentral", "st:ktmb:16300").fastest;
  assert.ok(!back.flags.includes("estimated_run"));
});
