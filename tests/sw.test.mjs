// Service worker behaviour (PLAN.md §4g), run in a sandbox with a fake Cache API and a fake server
// that can go offline. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SW = readFileSync(new URL("../site/sw.js", import.meta.url), "utf8");
const PRECACHE = JSON.parse(SW.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
const SCOPE = "https://example.test/train/";
const urlOf = (r) => (typeof r === "string" ? r : r.url);

function setup() {
  const server = { online: true, hang: false, hits: [], files: {} };
  for (const f of PRECACHE) server.files[new URL(f, SCOPE).href] = `v1 ${f}`;
  const fetchImpl = (req) => {
    const url = urlOf(req);
    server.hits.push(url);
    if (!server.online) return Promise.reject(new TypeError("Failed to fetch"));
    if (server.hang) return new Promise(() => {});
    const key = url.split("?")[0];
    const body = server.files[key];
    return Promise.resolve(body == null ? new Response("nope", { status: 404 }) : new Response(body, { status: 200 }));
  };
  const stores = new Map();
  const openCache = (name) => {
    if (!stores.has(name)) {
      const m = new Map();
      stores.set(name, {
        _m: m,
        match: async (k) => { const r = m.get(urlOf(k)); return r ? r.clone() : undefined; },
        put: async (k, res) => { m.set(urlOf(k), new Response(await res.text(), { status: res.status })); },
        addAll: async (reqs) => { for (const r of reqs) { const res = await fetchImpl(r); if (!res.ok) throw new Error("addAll"); m.set(urlOf(r), res); } },
        keys: async () => [...m.keys()],
      });
    }
    return stores.get(name);
  };
  const caches = {
    open: async (n) => openCache(n),
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
    match: async (k) => { for (const c of stores.values()) { const r = await c.match(k); if (r) return r; } return undefined; },
  };
  const handlers = {};
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  // SLOW_MS (4 s) shortened so the "slow network" case runs quickly
  const fastTimeout = (fn, ms) => setTimeout(fn, ms >= 1000 ? 20 : ms);
  vm.runInNewContext(SW, { self, caches, fetch: fetchImpl, Request, Response, URL, setTimeout: fastTimeout, Promise, console });

  const lifecycle = async (type) => { const w = []; handlers[type]({ waitUntil: (p) => w.push(p) }); await Promise.all(w); };
  // Returns {handled, response, background} like the browser would see it.
  const request = async (url, { method = "GET", mode = "cors" } = {}) => {
    let responded = null; const bg = [];
    handlers.fetch({ request: { url, method, mode }, respondWith: (p) => { responded = p; }, waitUntil: (p) => bg.push(p) });
    if (!responded) return { handled: false };
    const res = await responded;
    return { handled: true, text: await res.text(), status: res.status, background: Promise.all(bg) };
  };
  return { server, caches, stores, lifecycle, request };
}

test("install precaches the app files and network.json; activate removes old klrail caches only", async () => {
  const t = setup();
  (await t.caches.open("klrail-0")).put("x", new Response("old"));
  (await t.caches.open("other-app")).put("x", new Response("keep"));
  await t.lifecycle("install");
  const name = (await t.caches.keys()).find((k) => k.startsWith("klrail-") && k !== "klrail-0");
  assert.equal((await t.stores.get(name).keys()).length, PRECACHE.length);
  await t.lifecycle("activate");
  assert.deepEqual((await t.caches.keys()).sort(), ["other-app", name].sort());
});

test("offline: network.json, app files and navigations come from the cache", async () => {
  const t = setup();
  await t.lifecycle("install");
  t.server.online = false;
  const data = await t.request(`${SCOPE}data/network.json`);
  assert.equal(data.text, "v1 data/network.json");
  assert.equal((await t.request(`${SCOPE}app.js?x=1`)).text, "v1 app.js");
  const page = await t.request(`${SCOPE}?from=home`, { mode: "navigate" });
  assert.equal(page.text, "v1 ./");
});

test("deploy: online visits get the new network.json and the cache is updated for offline use", async () => {
  const t = setup();
  await t.lifecycle("install");
  t.server.files[`${SCOPE}data/network.json`] = "v2 network";
  const r = await t.request(`${SCOPE}data/network.json`);
  assert.equal(r.text, "v2 network");
  await r.background;
  t.server.online = false;
  assert.equal((await t.request(`${SCOPE}data/network.json`)).text, "v2 network");
});

test("slow network (no answer within SLOW_MS) with a cached copy: the cached copy answers", async () => {
  const t = setup();
  await t.lifecycle("install");
  t.server.hang = true;
  const r = await t.request(`${SCOPE}data/network.json`);
  assert.equal(r.text, "v1 data/network.json");
});

test("a server error falls back to the cached copy", async () => {
  const t = setup();
  await t.lifecycle("install");
  delete t.server.files[`${SCOPE}style.css`];                // now 404
  assert.equal((await t.request(`${SCOPE}style.css`)).text, "v1 style.css");
});

test("cross-origin (Photon, OSRM, tiles), out-of-scope and non-GET requests are not intercepted", async () => {
  const t = setup();
  await t.lifecycle("install");
  for (const u of ["https://photon.komoot.io/api/?q=klcc", "https://routing.openstreetmap.de/routed-foot/table/v1/x",
    "https://tile.openstreetmap.org/16/1/1.png", "https://example.test/other/"]) {
    assert.equal((await t.request(u)).handled, false, u);
  }
  assert.equal((await t.request(`${SCOPE}data/network.json`, { method: "POST" })).handled, false);
  assert.ok(!t.server.hits.some((h) => !h.startsWith(SCOPE)));
});

test("offline with nothing cached: the request fails normally (no fake response)", async () => {
  const t = setup();
  t.server.online = false;
  await assert.rejects(t.request(`${SCOPE}data/network.json`));
});
