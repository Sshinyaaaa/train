// Walking-service fallback and route-alternatives tests (PLAN.md §4e, §4f). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadNetwork, route, alternatives, accessCandidates, routeSignature } from "../site/router.js";
import { createWalkService } from "../site/walk.js";

const net = JSON.parse(readFileSync(new URL("../site/data/network.json", import.meta.url), "utf8"));
const g = loadNetwork(net);
const GMBB = { type: "place", lat: 3.1447455, lon: 101.7045274, name: "GMBB" };
const PASAR_SENI = "st:rapid:KG16";
const cfg = (over = {}) => ({ contactEmail: "ops@example.org", osrmFootUrl: "https://osrm.test/routed-foot",
  osrmMinIntervalMs: 1100, osrmTimeoutMs: 5000, walkCacheMs: 1800000, osrmBackoffMs: 60000, ...over });
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const stopsOf = (place) => accessCandidates(net, place).flatMap((c) => c.stops.map((x) => ({ id: x.stop, ...net.stops[x.stop] })));
const okResponse = (dists) => ({ ok: true, json: async () => ({ code: "Ok", distances: [[0, ...dists]] }) });

test("walk service is off without a contact email: no request, null result", async () => {
  let calls = 0;
  const ws = createWalkService(cfg({ contactEmail: null }), { fetchImpl: async () => { calls++; } });
  assert.equal(ws.enabled(), false);
  assert.equal(await ws.walksFrom(GMBB, stopsOf(GMBB)), null);
  assert.equal(calls, 0);
});

test("network error / HTTP error / bad payload -> null, and the router falls back to 'estimated walk'", async () => {
  for (const fetchImpl of [
    async () => { throw new TypeError("Failed to fetch"); },
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ code: "NoTable" }) }),
  ]) {
    const ws = createWalkService(cfg(), { fetchImpl, sleep: async () => {} });
    const walks = await ws.walksFrom(GMBB, stopsOf(GMBB));
    assert.equal(walks, null);
    const r = route(g, PASAR_SENI, { ...GMBB, walks }).fastest;
    const egress = r.legs[r.legs.length - 1];
    assert.equal(egress.type, "egress");
    assert.equal(egress.walk_source, "estimated");
    assert.ok(egress.flags.includes("estimated_walk"));
  }
});

test("timeout: an aborted slow request -> null (fallback)", async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const ws = createWalkService(cfg({ osrmTimeoutMs: 20 }), { fetchImpl, sleep: async () => {} });
  assert.equal(await ws.walksFrom(GMBB, stopsOf(GMBB)), null);
});

test("real walking distances replace the estimate and change the chosen egress (the GMBB bug)", async () => {
  const stops = stopsOf(GMBB);
  // OSM walking distances measured 2026-09-28 (routing.openstreetmap.de): Merdeka 1211 m, Plaza Rakyat 1313 m,
  // Hang Tuah 958 m, Imbi 792 m, Bukit Bintang (MRT) 896 m
  const real = { "rapid:KG17": 1211, "rapid:AG8": 1313, "rapid:MR4": 958, "rapid:MR5": 792, "rapid:KG18A": 896 };
  const ws = createWalkService(cfg(), { fetchImpl: async () => okResponse(stops.map((s) => real[s.id] ?? 1500)), sleep: async () => {} });
  const walks = await ws.walksFrom(GMBB, stops);
  const est = route(g, PASAR_SENI, GMBB).fastest;
  const osm = route(g, PASAR_SENI, { ...GMBB, walks }).fastest;
  const eEst = est.legs[est.legs.length - 1], eOsm = osm.legs[osm.legs.length - 1];
  assert.equal(net.stops[eEst.stop].name, "MERDEKA");            // straight-line: 413 m, ~7 min
  assert.notEqual(eOsm.stop, "rapid:KG17");                       // real walk from Merdeka is 1211 m
  assert.equal(eOsm.walk_source, "osm");
  assert.ok(!eOsm.flags.includes("estimated_walk"));
  assert.equal(eOsm.dist_m, real[eOsm.stop]);
});

test("HTTP 429: back off (no requests, estimates) for osrmBackoffMs, then try again", async () => {
  let t = 0, calls = 0, status = 429;
  const ws = createWalkService(cfg(), { now: () => t, sleep: async (ms) => { t += ms; }, storage: memStore(),
    fetchImpl: async () => { calls++; return status === 429 ? { ok: false, status: 429, json: async () => ({}) } : okResponse([500, 600, 700, 800, 900, 1000, 1100, 1200]); } });
  assert.equal(await ws.walksFrom(GMBB, stopsOf(GMBB)), null);
  assert.equal(calls, 1);
  t += 30000;
  assert.equal(await ws.walksFrom(GMBB, stopsOf(GMBB)), null);   // still backing off: no request
  assert.equal(calls, 1);
  t += 31000; status = 200;
  assert.ok(await ws.walksFrom(GMBB, stopsOf(GMBB)));
  assert.equal(calls, 2);
});

test("cache survives a reload (sessionStorage): a new service instance doesn't re-query", async () => {
  const store = memStore(); let calls = 0;
  const make = () => createWalkService(cfg(), { storage: store, sleep: async () => {},
    fetchImpl: async () => { calls++; return okResponse([500, 600, 700, 800, 900, 1000, 1100, 1200]); } });
  await make().walksFrom(GMBB, stopsOf(GMBB));
  const again = await make().walksFrom(GMBB, stopsOf(GMBB));   // "reloaded page"
  assert.ok(again);
  assert.equal(calls, 1);
});

test("rate limit: requests are spaced >= osrmMinIntervalMs; repeat queries hit the cache", async () => {
  let t = 0; const sleeps = []; const times = [];
  const ws = createWalkService(cfg(), { storage: memStore(),
    now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; },
    fetchImpl: async () => { times.push(t); return okResponse([100, 200, 300, 400, 500, 600, 700, 800]); },
  });
  const other = { type: "place", lat: 3.0, lon: 101.6, name: "X" };
  await Promise.all([ws.walksFrom(GMBB, stopsOf(GMBB)), ws.walksFrom(other, stopsOf(other))]);
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= 1100, `gap ${times[1] - times[0]}`);
  await ws.walksFrom(GMBB, stopsOf(GMBB));
  assert.equal(ws.stats.requests, 2);
  assert.equal(ws.stats.cacheHits, 1);
});

test("alternatives: up to 5, genuinely different (boarding/alighting stations), fastest first, within the time window", () => {
  const pairs = [["st:rapid:KJ1", "st:erl-klia-ekspres:klia_t2"], [PASAR_SENI, "st:rapid:PY38"],
    ["st:ktmb:50600", "st:rapid:KG35"], ["st:rapid:SA26", "st:rapid:KJ10"], [PASAR_SENI, GMBB]];
  let multi = 0;
  for (const [a, b] of pairs) {
    const alts = alternatives(g, a, b);
    const base = route(g, a, b).fastest;
    assert.ok(alts.length >= 1 && alts.length <= 5);
    assert.deepEqual(alts[0].lines, base.lines);
    const sigs = alts.map((r) => routeSignature(net, r));
    assert.equal(new Set(sigs).size, sigs.length, `duplicate routes for ${a} -> ${b}: ${sigs.join(" | ")}`);
    const limit = base.expected_min + Math.max(30, 0.5 * base.expected_min);
    for (const r of alts) {
      assert.ok(r.expected_min <= limit + 1e-9);
      assert.equal(new Set(r.stations).size, r.stations.length);   // no-revisit still holds
    }
    if (alts.length > 1) multi++;
  }
  assert.ok(multi >= 3, "most pairs should have real alternatives");
});

test("shared-track twins (Ampang vs Sri Petaling between the same stations) are one alternative", () => {
  const alts = alternatives(g, PASAR_SENI, GMBB);
  const twins = alts.filter((r) => r.lines.join(">") === "rapid:KJ>rapid:AG" || r.lines.join(">") === "rapid:KJ>rapid:PH");
  assert.ok(twins.length <= 1, alts.map((r) => r.lines.join(">")).join(" | "));
});
