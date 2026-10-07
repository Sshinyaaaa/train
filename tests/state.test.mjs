// Shareable URL state + "now" in Malaysia time (PLAN.md §4h). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stateToParams, queryString, paramsToState, encodeEndpoint, hasSearchParams, nowInKL } from "../site/state.js";

const net = JSON.parse(readFileSync(new URL("../site/data/network.json", import.meta.url), "utf8"));

test("stations round-trip through the URL without the st: prefix", () => {
  const p = stateToParams({ from: { type: "station", id: "st:rapid:KJ10" }, to: { type: "station", id: "st:ktmb:19205" }, day: "saturday", time: "08:30" });
  assert.equal(p.toString(), "from=rapid%3AKJ10&to=ktmb%3A19205&day=saturday&time=08%3A30");
  assert.deepEqual(paramsToState(p, net), {
    from: { type: "station", id: "st:rapid:KJ10" }, to: { type: "station", id: "st:ktmb:19205" }, day: "saturday", time: "08:30" });
});

test("queryString keeps colons and commas readable, and still parses back", () => {
  const st = { from: { type: "station", id: "st:rapid:KJ10" }, to: { type: "place", lat: 3.1, lon: 101.7, name: "A & B" }, day: "weekday", time: "08:05" };
  const qs = queryString(st);
  assert.equal(qs, "from=rapid:KJ10&to=3.10000,101.70000&toName=A+%26+B&day=weekday&time=08:05");
  assert.deepEqual(paramsToState(qs, net).to, { type: "place", lat: 3.1, lon: 101.7, name: "A & B" });
});

test("current location is never written as coordinates: it becomes 'here' and restores as {type: 'here'}", () => {
  const here = { type: "place", lat: 3.1234567, lon: 101.6543219, name: "Current location", geo: true };
  assert.equal(encodeEndpoint(here), "here");
  const s = stateToParams({ from: here, to: { type: "station", id: "st:rapid:KJ10" }, day: "weekday", time: "09:00" }).toString();
  assert.ok(!s.includes("3.12") && !s.includes("101.65") && !s.includes("Current"));
  assert.deepEqual(paramsToState(s, net).from, { type: "here" });
});

test("typed places keep 5-decimal coordinates and their name", () => {
  const place = { type: "place", lat: 3.1578912, lon: 101.7123456, name: "Wisma Example, Kuala Lumpur" };
  const s = stateToParams({ from: place, to: null, day: "weekday", time: "10:00" });
  assert.equal(s.get("from"), "3.15789,101.71235");
  assert.equal(s.get("fromName"), "Wisma Example, Kuala Lumpur");
  assert.deepEqual(paramsToState(s, net).from, { type: "place", lat: 3.15789, lon: 101.71235, name: "Wisma Example, Kuala Lumpur" });
});

test("invalid values come back null instead of breaking the page", () => {
  const st = paramsToState("from=rapid:NOPE&to=999,999&day=holiday&time=25:00", net);
  assert.deepEqual(st, { from: null, to: null, day: null, time: null });
  assert.equal(paramsToState("from=1.5,2.5", net).from.name, "Shared place");
  assert.equal(paramsToState("from=st:rapid:KJ10", net).from.id, "st:rapid:KJ10");      // full id accepted
  assert.equal(paramsToState("from=rapid:KJ15", net).from.id, net.stops["rapid:KJ15"].station);   // a line-stop maps to its station
});

test("hasSearchParams only reacts to our keys", () => {
  assert.equal(hasSearchParams("?utm_source=x"), false);
  assert.equal(hasSearchParams("?time=08:00"), true);
});

test("nowInKL: day type and time in Malaysia time (UTC+8), whatever the device zone", () => {
  // 2026-10-07 is a Wednesday
  assert.deepEqual(nowInKL(new Date("2026-10-07T02:15:00Z")), { day: "weekday", time: "10:15" });
  assert.deepEqual(nowInKL(new Date("2026-10-10T04:00:00Z")), { day: "saturday", time: "12:00" });
  assert.deepEqual(nowInKL(new Date("2026-10-11T23:30:00Z")), { day: "weekday", time: "07:30" });   // Mon 07:30 KL
});

test("nowInKL: before 04:00 counts as the previous service day (late trains past midnight)", () => {
  // Sun 2026-10-11 00:30 KL = Sat service day; Mon 01:00 KL = Sunday service day
  assert.deepEqual(nowInKL(new Date("2026-10-10T16:30:00Z")), { day: "saturday", time: "00:30" });
  assert.deepEqual(nowInKL(new Date("2026-10-11T17:00:00Z")), { day: "sunday", time: "01:00" });
  assert.deepEqual(nowInKL(new Date("2026-10-11T20:00:00Z")), { day: "weekday", time: "04:00" });
});
