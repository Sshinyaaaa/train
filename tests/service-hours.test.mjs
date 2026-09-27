// Service-hours tests (PLAN.md §4). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadNetwork, route, inService, linesNotRunning, parseTime, headwayAt } from "../site/router.js";

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

test("KLIA Transit (ERL timetable eff. 21 Mar 2026): last train 00:00 from KL Sentral, 00:07 from BTS, 01:00 from KLIA T2", () => {
  const d0 = net.lines["erl-klia-transit"].patterns.find((p) => p.dir === 0);
  const d1 = net.lines["erl-klia-transit"].patterns.find((p) => p.dir === 1);
  assert.equal(inService(d0, 0, T("00:00")), true);
  assert.equal(inService(d0, 0, T("00:01")), false);
  assert.equal(inService(d0, 1, T("00:07")), true);    // Bandar Tasik Selatan, 7 min after KL Sentral
  assert.equal(inService(d0, 1, T("00:08")), false);
  assert.equal(inService(d0, 0, T("05:02")), false);
  assert.equal(inService(d0, 0, T("05:03")), true);
  assert.equal(inService(d1, 0, T("01:00")), true);    // 25:00
  assert.equal(inService(d1, 0, T("01:01")), false);
});

test("KLIA Transit peak windows derived from the timetable: 15 / 20 / 30 min", () => {
  const d0 = net.lines["erl-klia-transit"].patterns.find((p) => p.dir === 0);
  const d1 = net.lines["erl-klia-transit"].patterns.find((p) => p.dir === 1);
  const hw = (p, day, t) => headwayAt(p, day, T(t)) / 60;
  assert.equal(hw(d0, "weekday", "08:00"), 15);   // KL Sentral 07:03-09:03
  assert.equal(hw(d0, "weekday", "12:00"), 30);
  assert.equal(hw(d0, "weekday", "18:30"), 15);   // 17:03-20:03
  assert.equal(hw(d0, "weekday", "23:30"), 20);   // late night
  assert.equal(hw(d0, "saturday", "08:00"), 30);  // weekends: no peak
  assert.equal(hw(d0, "sunday", "23:30"), 20);
  assert.equal(hw(d1, "weekday", "07:00"), 15);   // KLIA T2 06:18-08:46
  assert.equal(hw(d1, "weekday", "17:30"), 15);   // 16:48-19:46
});

test("BTS -> KLIA T2 at 00:05 catches the last KLIA Transit; at 00:10 there is none", () => {
  const BTS = "st:erl-klia-transit:bandar_tasik_selatan", T2 = "st:erl-klia-ekspres:klia_t2";
  const r = route(g, BTS, T2, { time: "00:05" });
  assert.ok(r && r.fastest.lines.includes("erl-klia-transit"));
  assert.equal(route(g, BTS, T2, { time: "00:10" }), null);
});

test("KL Sentral -> KLIA T2 at 00:20: no route; both ERL lines reported not running from KL Sentral", () => {
  assert.equal(route(g, KLS, T2, { time: "00:20" }), null);
  const erl = ["erl-klia-ekspres", "erl-klia-transit"];
  assert.deepEqual(linesNotRunning(g, erl, { time: "00:20" }, net.stations[KLS].stops).sort(), erl);
  // anywhere on the line, KLIA Transit still runs at 00:20 (last train from KLIA T2 is 01:00)
  assert.deepEqual(linesNotRunning(g, erl, { time: "00:20" }), ["erl-klia-ekspres"]);
});
