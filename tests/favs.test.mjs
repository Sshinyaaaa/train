// Favourites + recent trips (PLAN.md §4g). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createFavStore, usableStorage, FAV_KEY, MAX_RECENT, MAX_PLACES } from "../site/favs.js";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const st = (id) => ({ type: "station", id });
const place = (name, lat, lon) => ({ type: "place", name, lat, lon });

test("Home and Work are single slots: saving again replaces; custom names sort after them", () => {
  const f = createFavStore(memStorage());
  assert.deepEqual(f.savePlace("custom", "Gym", st("st:b")), { ok: true, label: "Gym" });
  f.savePlace("work", "", st("st:w1"));
  f.savePlace("home", "ignored", st("st:h1"));
  f.savePlace("home", "", place("Condo, Bangsar", 3.13, 101.67));
  assert.deepEqual(f.places().map((p) => [p.label, p.kind]), [["Home", "home"], ["Work", "work"], ["Gym", "custom"]]);
  assert.equal(f.places()[0].ep.name, "Condo, Bangsar");
});

test("custom name: required, trimmed, capped at 40, reusing a name (any case) replaces it", () => {
  const f = createFavStore(memStorage());
  assert.equal(f.savePlace("custom", "   ", st("st:a")).ok, false);
  f.savePlace("custom", "  Mum  ", st("st:a"));
  f.savePlace("custom", "mum", st("st:b"));
  assert.deepEqual(f.places().map((p) => [p.label, p.ep.id]), [["mum", "st:b"]]);
  f.savePlace("custom", "x".repeat(60), st("st:c"));
  assert.equal(f.places().find((p) => p.label.startsWith("x")).label.length, 40);
});

test("current location is never saved, as a place or in a recent trip", () => {
  const s = memStorage();
  const f = createFavStore(s);
  const here = { type: "place", lat: 3.1, lon: 101.6, name: "Current location", geo: true };
  const r = f.savePlace("home", "", here);
  assert.equal(r.ok, false);
  assert.match(r.error, /Current location/);
  assert.equal(f.addTrip(here, st("st:a")), false);
  assert.equal(f.trips().length, 0);
  assert.ok(!(s.getItem(FAV_KEY) || "").includes("101.6"));
});

test(`at most ${MAX_PLACES} places`, () => {
  const f = createFavStore(memStorage());
  for (let i = 0; i < MAX_PLACES; i++) assert.equal(f.savePlace("custom", `P${i}`, st(`st:${i}`)).ok, true);
  assert.equal(f.savePlace("custom", "one more", st("st:x")).ok, false);
  assert.equal(f.savePlace("custom", "P3", st("st:x")).ok, true);   // replacing is still allowed
});

test(`recent trips: newest first, no duplicates, at most ${MAX_RECENT}, from == to skipped`, () => {
  const f = createFavStore(memStorage());
  for (let i = 0; i < 7; i++) f.addTrip(st(`st:${i}`), st("st:z"));
  assert.equal(f.trips().length, MAX_RECENT);
  assert.equal(f.trips()[0].from.id, "st:6");
  assert.equal(f.addTrip(st("st:6"), st("st:z")), false);             // already the newest: no-op
  f.addTrip(st("st:4"), st("st:z"));                                  // repeat moves to the front
  assert.deepEqual(f.trips().map((t) => t.from.id), ["st:4", "st:6", "st:5", "st:3", "st:2"]);
  assert.equal(f.addTrip(st("st:a"), st("st:a")), false);
});

test("stored data survives a reload; cached walks and flags aren't stored", () => {
  const s = memStorage();
  const f = createFavStore(s);
  f.savePlace("work", "", { ...place("Office", 3.15, 101.71), walks: { x: 1 } });
  f.addTrip(st("st:a"), place("Office", 3.15, 101.71));
  const g = createFavStore(s);
  assert.deepEqual(g.places()[0].ep, { type: "place", lat: 3.15, lon: 101.71, name: "Office" });
  assert.equal(g.trips().length, 1);
});

test("invalid or unknown stored entries are dropped on load", () => {
  const s = memStorage();
  s.setItem(FAV_KEY, JSON.stringify({ v: 1,
    places: [{ kind: "home", label: "Home", ep: st("st:gone") }, { kind: "work", label: "Work", ep: st("st:ok") },
      { kind: "boss", label: "X", ep: st("st:ok") }, { kind: "custom", label: "Geo", ep: { type: "place", lat: 1, lon: 2, geo: true } },
      { kind: "custom", label: "Bad", ep: { type: "place", lat: "x", lon: 2 } }],
    trips: [{ from: st("st:ok"), to: st("st:gone") }, { from: st("st:ok"), to: st("st:ok2") }, "junk"] }));
  const f = createFavStore(s, { isValid: (ep) => ep.type !== "station" || ep.id !== "st:gone" });
  assert.deepEqual(f.places().map((p) => p.label), ["Work"]);
  assert.deepEqual(f.trips().map((t) => t.to.id), ["st:ok2"]);
});

test("corrupt JSON starts empty instead of throwing", () => {
  const s = memStorage();
  s.setItem(FAV_KEY, "{not json");
  const f = createFavStore(s);
  assert.deepEqual([f.places(), f.trips()], [[], []]);
});

test("clear all empties everything and removes the stored key", () => {
  const s = memStorage();
  const f = createFavStore(s);
  f.savePlace("home", "", st("st:a"));
  f.addTrip(st("st:a"), st("st:b"));
  f.clearAll();
  assert.deepEqual([f.places(), f.trips()], [[], []]);
  assert.equal(s.getItem(FAV_KEY), null);
  f.removePlace("nothing");                                            // harmless when empty
});

test("storage unavailable: usableStorage -> null, favourites still work in memory (persistent: false)", () => {
  const throwing = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); }, removeItem() {} };
  assert.equal(usableStorage(() => throwing), null);
  assert.equal(usableStorage(() => { throw new Error("denied"); }), null);
  assert.equal(usableStorage(() => undefined), null);
  const f = createFavStore(null);
  assert.equal(f.persistent, false);
  assert.equal(f.savePlace("home", "", st("st:a")).ok, true);
  assert.equal(f.addTrip(st("st:a"), st("st:b")), true);
  assert.equal(f.places().length, 1);
  f.clearAll();
});

test("storage that fails on write (quota) keeps working and reports persistent: false", () => {
  const s = memStorage();
  const f = createFavStore({ ...s, setItem() { throw new Error("QuotaExceededError"); } });
  assert.equal(f.persistent, true);
  assert.equal(f.savePlace("home", "", st("st:a")).ok, true);
  assert.equal(f.persistent, false);
  assert.equal(f.places().length, 1);
});

test("returned lists are copies (callers can't change the store)", () => {
  const f = createFavStore(memStorage());
  f.savePlace("home", "", st("st:a"));
  f.places()[0].ep.id = "st:hacked";
  assert.equal(f.places()[0].ep.id, "st:a");
});
