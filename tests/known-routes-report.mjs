// Print a markdown table of every known-routes case. Run: node tests/known-routes-report.mjs
import { loadGraph, loadCases, evaluate } from "./known-routes-lib.mjs";

const g = loadGraph();
const rows = [["case", "day/time", "route (fastest)", "journey_min", "expected_min", "transfers", "lines",
  "estimate flags", "expect", "verified", "result", "why"]];
for (const c of loadCases()) {
  const r = evaluate(g, c);
  const f = r.res?.fastest;
  const fewest = r.res?.fewest;
  const lines = f ? f.lines.map((l) => g.net.lines[l].short).join(" → ") : "—";
  rows.push([
    `${c.from} → ${c.to}`,
    `${r.query.day} ${r.query.time}`,
    f ? f.legs.filter((l) => l.type === "ride").map((l) => `${g.net.stops[l.from].name} → ${g.net.stops[l.to].name}`).join("; ") : "no route",
    f ? f.journey_min : "—",
    f ? f.expected_min : "—",
    f ? `${f.transfers}${fewest ? ` (fewest: ${fewest.transfers})` : ""}` : "—",
    lines,
    f ? (f.flags.filter((x) => x !== "gates_unknown").join(", ") || "none") : "—",
    `≤${c.expect.max_minutes} min, ≤${c.expect.max_transfers} tr`,
    String(c.verified === true),
    r.result + (c.status ? ` (${c.status})` : ""),
    r.problems.join("; ") || "",
  ]);
}
const out = rows.map((r) => `| ${r.join(" | ")} |`);
out.splice(1, 0, `|${rows[0].map(() => "---").join("|")}|`);
console.log(out.join("\n"));
