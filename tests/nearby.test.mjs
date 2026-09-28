// Nearest stations (PLAN.md §4g). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nearestStations } from "../site/nearby.js";

const net = JSON.parse(readFileSync(new URL("../site/data/network.json", import.meta.url), "utf8"));

test("synthetic: 5 closest, closest first; a station's distance is to its nearest line-stop", () => {
  const stops = {}, stations = {};
  // station "big" has a far centroid-ish stop and one very close stop
  const add = (st, id, lat, lon) => { stops[id] = { lat, lon }; (stations[st] ||= { stops: [] }).stops.push(id); };
  add("big", "b1", 3.010, 101.0); add("big", "b2", 3.0005, 101.0);
  for (let i = 1; i <= 6; i++) add(`s${i}`, `s${i}`, 3.0 + i * 0.001, 101.001);
  const r = nearestStations({ stops, stations }, { lat: 3.0, lon: 101.0 }, 5);
  assert.equal(r.length, 5);
  assert.equal(r[0].station, "big");
  assert.ok(r[0].dist_m < 60);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].dist_m <= r[i].dist_m);
  assert.deepEqual(r.slice(1).map((x) => x.station), ["s1", "s2", "s3", "s4"]);
});

test("real network: standing at KLCC's platform gives KLCC first", () => {
  const p = net.stops["rapid:KJ10"];
  const r = nearestStations(net, { lat: p.lat, lon: p.lon });
  assert.equal(r.length, 5);
  assert.equal(r[0].station, net.stops["rapid:KJ10"].station);
  assert.ok(r[0].dist_m < 1);
});
