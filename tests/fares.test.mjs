// Fare tests (PLAN.md §4d). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadNetwork, route } from "../site/router.js";
import { computeFares, fareSummary } from "../site/fares.js";

const net = JSON.parse(readFileSync(new URL("../site/data/network.json", import.meta.url), "utf8"));
const g = loadNetwork(net);
const ride = (line, from, to) => ({ type: "ride", line, from, to });
const walk = { type: "transfer", kind: "connecting" };

test("KLIA Transit KL Sentral -> Putrajaya: RM14.00 from ERL's table, with source and date", () => {
  const f = computeFares(net, { legs: [ride("erl-klia-transit", "erl-klia-transit:kl_sentral", "erl-klia-transit:putrajaya_sentral")] });
  assert.equal(f.complete, true);
  assert.equal(f.known_total, 14);
  assert.equal(fareSummary(f), "RM 14.00");
  assert.equal(f.added_together, false);
  assert.deepEqual(f.sources.map((s) => [s.label, s.as_of]), [["ERL (kliaekspres.com)", "2026-09-28"]]);
});

test("fares are symmetric: Putrajaya -> KL Sentral is also RM14.00", () => {
  const f = computeFares(net, { legs: [ride("erl-klia-transit", "erl-klia-transit:putrajaya_sentral", "erl-klia-transit:kl_sentral")] });
  assert.equal(f.known_total, 14);
});

test("KLIA Ekspres KL Sentral -> KLIA T2: RM55.00; T1 -> T2 on Ekspres has no published fare", () => {
  const a = computeFares(net, { legs: [ride("erl-klia-ekspres", "erl-klia-ekspres:kl_sentral", "erl-klia-ekspres:klia_t2")] });
  assert.equal(fareSummary(a), "RM 55.00");
  const b = computeFares(net, { legs: [ride("erl-klia-ekspres", "erl-klia-ekspres:klia_t1", "erl-klia-ekspres:klia_t2")] });
  assert.equal(b.complete, false);
  assert.equal(fareSummary(b), null);                  // nothing known -> "unavailable"
  assert.equal(b.segments[0].fare_url, "https://www.kliaekspres.com/products-fares/klia-ekspres/");
});

test("consecutive Rapid KL legs are one segment; cross-operator totals read 'from RM X + Rapid KL fare'", () => {
  const f = computeFares(net, { legs: [
    ride("rapid:KJ", "rapid:KJ1", "rapid:KJ13"), walk, ride("rapid:PH", "rapid:SP7", "rapid:SP15"), walk,
    ride("erl-klia-transit", "erl-klia-transit:bandar_tasik_selatan", "erl-klia-transit:putrajaya_sentral"),
  ] });
  assert.equal(f.segments.length, 2);
  assert.deepEqual(f.segments[0].lines, ["rapid:KJ", "rapid:PH"]);
  assert.equal(f.segments[0].price, null);
  assert.equal(f.segments[0].link_text, "Check fare on MyRapid");
  assert.equal(f.segments[1].price, 8);
  assert.equal(f.added_together, true);
  assert.equal(fareSummary(f), "from RM 8.00 + Rapid KL fare");
});

test("KTM segments are unavailable (tables under review); KTM 1 -> KTM 2 is one segment", () => {
  const f = computeFares(net, { legs: [ride("ktmb:KC05_KB18", "ktmb:50600", "ktmb:19100"), ride("ktmb:KA15_KD19", "ktmb:19100", "ktmb:53700")] });
  assert.equal(f.segments.length, 1);
  assert.equal(f.segments[0].name, "KTM Komuter");
  assert.equal(f.complete, false);
  assert.deepEqual(f.missing_names, ["KTM Komuter"]);
});

test("real route: KL Sentral -> Putrajaya Sentral (ERL) prices from the router's legs", () => {
  const r = route(g, "st:erl-klia-ekspres:kl_sentral", "st:erl-klia-transit:putrajaya_sentral").fastest;
  const f = computeFares(net, r);
  assert.deepEqual(r.lines, ["erl-klia-transit"]);
  assert.equal(fareSummary(f), "RM 14.00");
});
