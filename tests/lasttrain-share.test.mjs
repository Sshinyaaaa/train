// Last-train warnings and the Share summary (PLAN.md §4h). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadNetwork, route, lastBoarding, lastTrainCheck, LAST_TRAIN_WARN_MIN } from "../site/router.js";
import { routeSummaryText, lastTrainText, clock } from "../site/share.js";

const net = JSON.parse(readFileSync(new URL("../site/data/network.json", import.meta.url), "utf8"));
const g = loadNetwork(net);
const KLS = "st:erl-klia-ekspres:kl_sentral", PJS = "st:erl-klia-transit:putrajaya_sentral";
const rides = (r) => r.legs.filter((l) => l.type === "ride");

test("lastBoarding: service_hours + run time to the stop; otherwise the end of the day's last band", () => {
  const p = { service_hours: [18000, 86400], run_sec: [0, 600], headways: {} };
  assert.equal(lastBoarding(p, 1, "weekday"), 87000);
  const q = { run_sec: [0, 60], headways: { weekday: [[20000, 50000, 300], [50000, 84000, 600]], sunday: [] } };
  assert.equal(lastBoarding(q, 1, "weekday"), 84000);
  assert.equal(lastBoarding(q, 1, "sunday"), null);
});

test("lastTrainCheck: quiet with plenty of time; warns within 30 min or one headway; flags a missed train", () => {
  const p = { service_hours: [18000, 86400], run_sec: [0], headways: {} };
  assert.equal(lastTrainCheck(p, 0, "weekday", 86400 - 3 * 3600, 1800), null);
  assert.equal(LAST_TRAIN_WARN_MIN, 30);
  assert.deepEqual(lastTrainCheck(p, 0, "weekday", 86400 - 20 * 60, 900), { last_sec: 86400, reach_sec: 85200, slack_min: 20, missed: false });
  assert.ok(lastTrainCheck(p, 0, "weekday", 86400 - 40 * 60, 3600));               // 40 min left but trains hourly
  assert.equal(lastTrainCheck(p, 0, "weekday", 86400 + 120, 900).missed, true);
  // 00:10 is compared as 24:10 when the line runs past midnight
  assert.equal(lastTrainCheck(p, 0, "weekday", 600, 900).missed, true);
});

test("real network: KLIA Transit from KL Sentral (last 24:00) warns at 23:40, not at 11:00", () => {
  const late = route(g, KLS, PJS, { day: "weekday", time: "23:40" }).fastest;
  const leg = rides(late)[0];
  assert.equal(leg.line, "erl-klia-transit");
  assert.deepEqual(leg.last_train, { last_sec: 86400, reach_sec: 85200, slack_min: 20, missed: false });
  assert.ok(late.flags.includes("last_train"));
  assert.match(lastTrainText(leg, "KL Sentral"), /^The last ERL KLIA Transit train from KL Sentral leaves around 00:00\. You'd reach the platform ~23:40 \(20 min to spare\)/);
  const day = route(g, KLS, PJS, { day: "weekday", time: "11:00" }).fastest;
  assert.equal(rides(day)[0].last_train, undefined);
  assert.ok(!day.flags.includes("last_train"));
});

test("the warning uses when you actually reach a later leg's platform, not the departure time", () => {
  // Masjid Jamek -> Putrajaya Sentral: the KLIA Transit leg starts later than the requested time
  // (Sri Petaling line to Bandar Tasik Selatan, then KLIA Transit, whose last train passes BTS ~00:07)
  const r = route(g, "st:rapid:AG7", PJS, { day: "weekday", time: "23:20" }).fastest;
  const [first, transit] = rides(r);
  assert.equal(first.last_train, undefined);
  assert.equal(transit.line, "erl-klia-transit");
  assert.ok(transit.last_train.reach_sec > 23 * 3600 + 20 * 60 + 10 * 60);   // well after the 23:20 departure
  assert.equal(transit.last_train.last_sec, 86400 + net.lines["erl-klia-transit"].patterns
    .find((p) => p.stops[0].endsWith("kl_sentral")).run_sec[1]);
});

test("clock formats seconds past midnight, wrapping 24:00+", () => {
  assert.deepEqual([clock(0), clock(86400), clock(90000), clock(45296)], ["00:00", "00:00", "01:00", "12:35"]);
});

test("share summary: endpoints, legs, fare, last-train warning, link; no coordinates", () => {
  const r = route(g, KLS, PJS, { day: "weekday", time: "23:40" }).fastest;
  const stopName = (id) => net.stops[id].name;
  const text = routeSummaryText(r, { fromName: "KL Sentral", toName: "Putrajaya Sentral", day: "weekday", time: "23:40",
    stopName, fare: "RM 14.00", fareKind: "adult one-way, cashless", url: "https://example.test/train/?from=a&to=b" });
  const lines = text.split("\n");
  assert.equal(lines[0], "KL Rail Planner: KL Sentral → Putrajaya Sentral");
  assert.match(lines[1], /^Weekday, depart 23:40 · ~\d+ min \+ up to \d+ min first wait · direct$/);
  assert.match(text, /^1\. .*KLIA Transit towards .*: KL Sentral → Putrajaya Sentral \(\d+ stops?, ~\d+ min\)$/m);
  assert.match(text, /^Fare: RM 14\.00 \(adult one-way, cashless\)$/m);
  assert.match(text, /^Warning: The last .* leaves around 00:00/m);
  assert.equal(lines.at(-1), "https://example.test/train/?from=a&to=b");
});

test("share summary with a place start shows the walk but never coordinates", () => {
  const place = { type: "place", lat: 3.1335, lon: 101.6865, name: "Somewhere" };
  const r = route(g, place, PJS, { day: "weekday", time: "11:00" }).fastest;
  const text = routeSummaryText(r, { fromName: "Somewhere", toName: "Putrajaya Sentral", day: "weekday", time: "11:00",
    stopName: (id) => net.stops[id].name, fare: null });
  assert.match(text, /^Walk ~\d+ min \(\d+ m\) to /m);
  assert.ok(!text.includes("3.1335") && !text.includes("101.68"));
});
