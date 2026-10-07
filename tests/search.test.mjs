// Station search: names, aliases, typo tolerance (PLAN.md §4h). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSearchIndex, searchIndex, editDistance, typoBudget } from "../site/search.js";

const net = JSON.parse(readFileSync(new URL("../site/data/network.json", import.meta.url), "utf8"));
const stations = Object.entries(net.stations).map(([id, st]) => ({ id, name: st.name }));
const idx = buildSearchIndex(stations, net.aliases);
const top = (q) => searchIndex(idx, q)[0];
const ids = (q) => searchIndex(idx, q).map((m) => m.station);

test("edit distance: substitution, insertion, deletion, adjacent swap; capped", () => {
  assert.equal(editDistance("sentral", "sentral"), 0);
  assert.equal(editDistance("sentrel", "sentral"), 1);
  assert.equal(editDistance("sentra", "sentral"), 1);
  assert.equal(editDistance("setnral", "sentral"), 1);          // transposition counts once
  assert.equal(editDistance("abcdef", "uvwxyz", 2), 3);         // capped at max + 1
  assert.deepEqual([typoBudget("klc"), typoBudget("klcc"), typoBudget("bintang")], [0, 1, 2]);
});

test("names: exact and prefix matches rank first", () => {
  assert.equal(top("KLCC").station, "st:rapid:KJ10");
  assert.equal(top("klcc").alias, null);
  assert.ok(ids("kl sentral").includes("st:erl-klia-ekspres:kl_sentral"));
  assert.equal(top("titiwangsa").station, "st:rapid:AG3");
});

test("aliases: TRX, Pavilion, Mid Valley, Sunway Pyramid, klia2 find their stations and say why", () => {
  assert.deepEqual([top("TRX").station, top("TRX").alias], ["st:rapid:KG20", "TRX"]);
  assert.equal(top("pavilion").station, "st:rapid:KG18A");
  assert.equal(top("Mid Valley").station, "st:ktmb:19205");
  assert.equal(top("sunway pyramid").station, "st:rapid:BRT3");
  assert.equal(top("klia2").station, "st:erl-klia-ekspres:klia_t2");
  // an alias for two stations returns both
  assert.ok(["st:rapid:SP15", "st:erl-klia-transit:bandar_tasik_selatan"].every((s) => ids("TBS").includes(s)));
});

test("a real station name beats an alias on a tie", () => {
  const i = buildSearchIndex([{ id: "a", name: "Pavilion" }, { id: "b", name: "Other" }], [{ alias: "Pavilion", stations: ["b"] }]);
  assert.deepEqual(searchIndex(i, "pavilion").map((m) => m.station), ["a", "b"]);
});

test("typos: one or two mistakes still find the station", () => {
  assert.equal(top("titiwangsaa").station, "st:rapid:AG3");     // extra letter
  assert.equal(top("titwangsa").station, "st:rapid:AG3");       // missing letter
  assert.equal(top("bukit bintnag").station, ids("bukit bintang")[0]);   // swapped letters
  assert.ok(ids("chan sow lim").includes("st:rapid:AG11"));
  assert.ok(ids("mid valey").includes("st:ktmb:19205"));
  assert.ok(ids("pavillion").includes("st:rapid:KG18A"));       // alias with a typo
  assert.ok(searchIndex(idx, "masjid jamek")[0].score < searchIndex(idx, "masjd jamek")[0].score);   // exact ranks above typo
});

test("short queries get no typo matching (avoids noise); empty query returns nothing", () => {
  assert.ok(searchIndex(idx, "kx").every((m) => m.score < 10));
  assert.deepEqual(searchIndex(idx, "  "), []);
  assert.ok(searchIndex(idx, "a").length <= 8);
});

test("every alias resolves to at least one station", () => {
  for (const a of net.aliases) assert.ok(a.stations.length > 0, a.alias);
});
