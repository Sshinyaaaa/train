// Service-hours tests (PLAN.md §4). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadNetwork, route, inService, linesNotRunning, parseTime } from "../site/router.js";

const T = (hhmm) => parseTime(hhmm);  // "24:10" -> 87000 (GTFS 24:00+)

test("inService: window shifts by run time to the stop; after-midnight times match 24:00+", () => {
  const p = { run_sec: [0, 420, 1140], service_hours: [T("05:03"), T("24:03")] };
  assert.equal(inService(p, 0, T("05:02")), false);
  assert.equal(inService(p, 0, T("05:03")), true);
  assert.equal(inService(p, 1, T("05:05")), false);   // first train reaches stop 1 at 05:10
  assert.equal(inService(p, 1, T("05:10")), true);
  assert.equal(inService(p, 1, T("00:10")), true);    // last train at stop 1: 24:10
  assert.equal(inService(p, 1, T("00:11")), false);
  assert.equal(inService({ run_sec: [0, 60] }, 0, T("03:00")), true);   // no service_hours: unrestricted
});

function tinyNet(serviceHours) {
  const hw = { weekday: [[0, 30 * 3600, 600]], saturday: [[0, 30 * 3600, 600]], sunday: [[0, 30 * 3600, 600]] };
  const st = (id) => ({ name: id, lat: 3, lon: 101, lines: ["L"], station: id });
  return loadNetwork({
    meta: { gate_penalty_min: 5 },
    stops: { a: st("a"), b: st("b") },
    stations: { a: { stops: ["a"] }, b: { stops: ["b"] } },
    lines: { L: { name: "L", display: { mode: "ERL", label: "L" }, patterns: [
      { dir: 0, stops: ["a", "b"], run_sec: [0, 600], run_source: "official", headways: hw, headway_source: "official", service_hours: serviceHours },
    ] } },
    transfers: [],
  });
}

test("a line outside its service hours can't be boarded, and is reported as not running", () => {
  const g = tinyNet([T("06:00"), T("23:00")]);
  assert.equal(route(g, "a", "b", { time: "05:30" }), null);
  assert.deepEqual(linesNotRunning(g, ["L"], { time: "05:30" }), ["L"]);
  assert.ok(route(g, "a", "b", { time: "06:00" }));
  assert.deepEqual(linesNotRunning(g, ["L"], { time: "12:00" }), []);
  assert.equal(route(g, "a", "b", { time: "23:01" }), null);
});

test("service past midnight: a 01:00 query boards a line running until 25:30", () => {
  const g = tinyNet([T("05:00"), T("25:30")]);
  assert.ok(route(g, "a", "b", { time: "01:00" }));
  assert.equal(route(g, "a", "b", { time: "01:31" }), null);
});

const net = JSON.parse(readFileSync(new URL("../site/data/network.json", import.meta.url), "utf8"));
const g = loadNetwork(net);
const KLS = "st:erl-klia-ekspres:kl_sentral", T2 = "st:erl-klia-ekspres:klia_t2";

test("KLIA Transit (official times): last train from KL Sentral 00:03, from Bandar Tasik Selatan 00:10", () => {
  const transit = net.lines["erl-klia-transit"].patterns.find((p) => p.dir === 0);
  assert.equal(inService(transit, 0, T("00:03")), true);
  assert.equal(inService(transit, 0, T("00:04")), false);
  assert.equal(inService(transit, 1, T("00:10")), true);
  assert.equal(inService(transit, 1, T("00:11")), false);
  assert.equal(inService(transit, 0, T("05:02")), false);
  assert.equal(inService(transit, 0, T("05:03")), true);
});

test("KL Sentral -> KLIA T2 at 00:20: no route; both ERL lines reported not running", () => {
  assert.equal(route(g, KLS, T2, { time: "00:20" }), null);
  const erl = ["erl-klia-ekspres", "erl-klia-transit"];
  const off = linesNotRunning(g, erl, { time: "00:20" }, net.stations[KLS].stops);
  assert.deepEqual(off.sort(), erl);
  // anywhere on the line, KLIA Transit still runs at 00:20 (last train from KLIA T2 is 00:30)
  assert.deepEqual(linesNotRunning(g, erl, { time: "00:20" }), ["erl-klia-ekspres"]);
});

test("KL Sentral -> KLIA T2 at 00:02 still catches the last KLIA Transit (official run time, not estimated)", () => {
  const r = route(g, KLS, T2, { time: "00:02" }).fastest;
  assert.deepEqual(r.lines, ["erl-klia-transit"]);
  assert.ok(!r.flags.includes("estimated_run"));
  assert.equal(r.legs[0].ride_min, 39);
});
