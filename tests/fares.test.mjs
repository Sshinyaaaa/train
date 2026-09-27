// Fare tests (PLAN.md §4d). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadNetwork, route } from "../site/router.js";
import { computeFares, fareSummary, DEFAULT_FARE_TYPE } from "../site/fares.js";

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

test("default fare type is cashless: KTM KL Sentral -> Seremban RM7.40 from the transcribed (unverified) table", () => {
  assert.equal(DEFAULT_FARE_TYPE, "cashless");
  const f = computeFares(net, { legs: [ride("ktmb:KC05_KB18", "ktmb:19100", "ktmb:22700")] });   // KL Sentral -> Seremban
  assert.equal(fareSummary(f), "RM 7.40");
  assert.equal(f.segments[0].status, "transcribed from image, unverified");
  assert.equal(f.sources[0].caveat, "KTMB fare table effective 2 Dec 2015, may be outdated");
  assert.equal(f.sources[0].as_of, "2015-12-02");
  assert.equal(f.sources[0].url, "https://www.ktmb.com.my/pdf/TanpaTunaiDec.pdf");
});

test("fare type cash / concession pick KTM's cash and concession tables", () => {
  const legs = [ride("ktmb:KC05_KB18", "ktmb:19100", "ktmb:22700")];
  const cash = computeFares(net, { legs }, { fareType: "cash" });
  assert.equal(fareSummary(cash), "RM 8.70");
  assert.equal(cash.sources[0].url, "https://www.ktmb.com.my/pdf/TunaiDec.pdf");
  const conc = computeFares(net, { legs }, { fareType: "concession" });
  assert.equal(conc.complete, true);
  assert.equal(conc.sources[0].url, "https://www.ktmb.com.my/pdf/KonsesiDec.pdf");
  assert.ok(conc.known_total > 0 && conc.known_total < 8.7);
});

test("ERL: cash and cashless are the same standard fare; concession is text only (30% rule), no price", () => {
  const legs = [ride("erl-klia-transit", "erl-klia-transit:kl_sentral", "erl-klia-transit:putrajaya_sentral")];
  for (const fareType of ["cash", "cashless"]) assert.equal(computeFares(net, { legs }, { fareType }).known_total, 14);
  const c = computeFares(net, { legs }, { fareType: "concession" });
  assert.equal(c.complete, false);
  assert.equal(c.segments[0].price, null);
  assert.match(c.segments[0].type_text, /less 30%/);
  assert.match(c.segments[0].type_text, /Registration/);
  assert.equal(c.segments[0].type_url, "https://www.kliaekspres.com/products-fares/concession-ticket/");
  assert.equal(fareSummary(c), null);
});

test("Rapid KL stays 'Check fare on MyRapid' for every fare type", () => {
  for (const fareType of ["cashless", "cash", "concession"]) {
    const f = computeFares(net, { legs: [ride("rapid:KJ", "rapid:KJ1", "rapid:KJ13")] }, { fareType });
    assert.equal(f.segments[0].price, null);
    assert.equal(f.segments[0].link_text, "Check fare on MyRapid");
    assert.equal(f.segments[0].type_text, undefined);
  }
});

test("KTM 1 -> KTM 2 is one segment priced end to end (Batu Caves -> Subang Jaya RM4.70 cash)", () => {
  const f = computeFares(net, { legs: [ride("ktmb:KC05_KB18", "ktmb:50600", "ktmb:19100"), ride("ktmb:KA15_KD19", "ktmb:19100", "ktmb:53700")] }, { fareType: "cash" });
  assert.equal(f.segments.length, 1);
  assert.equal(fareSummary(f), "RM 4.70");
});

test("Abdullah Hukum and Kajang 2 are not in the 2015 table: fare unavailable + KTMB link", () => {
  for (const to of ["ktmb:52700", "ktmb:20402"]) {
    const f = computeFares(net, { legs: [ride("ktmb:KC05_KB18", "ktmb:19100", to)] });
    assert.equal(f.complete, false);
    assert.equal(f.segments[0].price, null);
    assert.equal(f.segments[0].fare_url, "https://www.ktmb.com.my/komuter.html");
  }
});

test("highest in-scope KTM cash fare equals the T&C (Apr 2026) Klang Valley maximum, RM23.20", () => {
  const f = computeFares(net, { legs: [ride("ktmb:KC05_KB18", "ktmb:15200", "ktmb:25100")] }, { fareType: "cash" });   // Tanjung Malim -> Tampin
  assert.equal(f.known_total, 23.2);
  const t = net.fares.systems.ktmb.fare_types.cash.table;
  assert.equal(Math.max(...t.cents.flat().filter((c) => c != null)), 2320);
});

test("real route: KL Sentral -> Putrajaya Sentral (ERL) prices from the router's legs", () => {
  const r = route(g, "st:erl-klia-ekspres:kl_sentral", "st:erl-klia-transit:putrajaya_sentral").fastest;
  const f = computeFares(net, r);
  assert.deepEqual(r.lines, ["erl-klia-transit"]);
  assert.equal(fareSummary(f), "RM 14.00");
});
