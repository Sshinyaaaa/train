// PWA files (PLAN.md §4g): precache list, manifest, icons. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const site = new URL("../site/", import.meta.url);
const read = (p) => readFileSync(new URL(p, site), "utf8");
const sw = read("sw.js");
const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));

// PNG width/height from the IHDR chunk
function pngSize(p) {
  const b = readFileSync(new URL(p, site));
  assert.equal(b.toString("latin1", 1, 4), "PNG", `${p} is not a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

test("every precached file exists in site/", () => {
  for (const f of precache.filter((f) => f !== "./")) assert.ok(existsSync(new URL(f, site)), `missing ${f}`);
  assert.ok(precache.includes("./") && precache.includes("data/network.json"));
});

test("precache covers every site module and stylesheet (so offline has no missing import)", () => {
  const code = readdirSync(site).filter((f) => /\.(js|css)$/.test(f) && f !== "sw.js");
  for (const f of code) assert.ok(precache.includes(f), `${f} not precached in sw.js`);
});

test("service worker only handles same-scope GETs (cross-origin is never cached)", () => {
  assert.match(sw, /req\.method !== "GET" \|\| !req\.url\.startsWith\(scope\(\)\)/);
  assert.match(sw, /cache: "no-cache"/);     // revalidate so a deploy's network.json is picked up
});

test("manifest: required fields, relative start_url/scope, icons exist at their stated sizes", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  for (const k of ["name", "short_name", "start_url", "scope", "display", "icons", "theme_color", "background_color"]) assert.ok(m[k], k);
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.display, "standalone");
  assert.ok(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512"));
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
  for (const i of m.icons) {
    assert.equal(pngSize(i.src), i.sizes, i.src);
    assert.ok(precache.includes(i.src), `${i.src} not precached`);
  }
});

test("index.html links the manifest and the apple-touch-icon", () => {
  const html = read("index.html");
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  const icon = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/)[1];
  assert.equal(pngSize(icon), "180x180");
});
