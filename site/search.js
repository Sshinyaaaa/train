// Station search (PLAN.md §4h): station names plus aliases (overrides/aliases.json), with typo
// tolerance. Pure module: works in the browser and in Node.
//
// Ranking (lower is better), one result per station:
//   0 exact · 1 name starts with the query · 2 a word starts with it · 3 contains it
//   alias matches score +0.5 (a real station name wins a tie)
//   10 + d: typo match, d = edit distance (1 for queries of 4-5 characters, up to 2 for longer)

export const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Optimal string alignment distance (insert, delete, substitute, swap adjacent). Stops early and
// returns max + 1 once every path exceeds max.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return Math.min(prev[b.length], max + 1);
}

export const typoBudget = (q) => (q.length < 4 ? 0 : q.length <= 5 ? 1 : 2);

// stations: [{id, name}]; aliases: [{alias, stations: [id]}] (network.json `aliases`).
export function buildSearchIndex(stations, aliases = []) {
  const nameOf = new Map(stations.map((s) => [s.id, s.name]));
  const entry = (station, text, alias) => ({ station, name: nameOf.get(station) ?? "", alias, key: norm(text), words: words(text).map(norm) });
  const out = stations.map((s) => entry(s.id, s.name, null));
  for (const a of aliases) for (const st of a.stations || []) if (nameOf.has(st)) out.push(entry(st, a.alias, a.alias));
  return out;
}

function score(e, q, budget) {
  let s = null;
  if (e.key === q) s = 0;
  else if (e.key.startsWith(q)) s = 1;
  else if (e.words.some((w) => w.startsWith(q))) s = 2;
  else if (e.key.includes(q)) s = 3;
  else if (budget > 0) {
    // compare against prefixes of the whole name and of each word, allowing one extra/missing letter
    let d = budget + 1;
    for (const t of [e.key, ...e.words]) {
      for (const len of [q.length - 1, q.length, q.length + 1]) {
        if (len < 1 || len > t.length) continue;
        d = Math.min(d, editDistance(q, t.slice(0, len), budget));
        if (d === 0) break;
      }
    }
    if (d <= budget) s = 10 + d;
  }
  return s == null ? null : s + (e.alias ? 0.5 : 0);
}

// Returns [{station, alias, score}] best first. alias is the alias text when that's what matched.
export function searchIndex(index, query, { limit = 8 } = {}) {
  const q = norm(query);
  if (!q) return [];
  const budget = typoBudget(q);
  const best = new Map();
  for (const e of index) {
    const s = score(e, q, budget);
    if (s == null) continue;
    const cur = best.get(e.station);
    if (!cur || s < cur.score) best.set(e.station, { station: e.station, alias: e.alias, score: s, name: e.name });
  }
  return [...best.values()]
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ station, alias, score: sc }) => ({ station, alias, score: sc }));
}
