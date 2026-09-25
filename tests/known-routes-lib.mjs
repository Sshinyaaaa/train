// Evaluate tests/known-routes.json against the router (PLAN.md §6).
// max_minutes is checked against the fastest route's journey_min; max_transfers against the
// fewest-transfer route. Only verified cases can fail; others report a warning.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadNetwork, route, DEFAULT_QUERY } from "../site/router.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export function loadGraph() {
  return loadNetwork(JSON.parse(readFileSync(here("../site/data/network.json"), "utf8")));
}

export function loadCases() {
  return JSON.parse(readFileSync(here("./known-routes.json"), "utf8"));
}

export function evaluate(g, c) {
  const query = { day: c.day ?? DEFAULT_QUERY.day, time: c.time ?? DEFAULT_QUERY.time };
  const res = route(g, c.from_station, c.to_station, query);
  const out = { case: c, query, res, problems: [] };
  if (!res) {
    out.problems.push("no route");
  } else {
    const fewest = res.fewest ?? res.fastest;
    const { max_minutes, max_transfers } = c.expect ?? {};
    if (max_minutes != null && res.fastest.journey_min > max_minutes)
      out.problems.push(`journey_min ${res.fastest.journey_min} > ${max_minutes}`);
    if (max_transfers != null && fewest.transfers > max_transfers)
      out.problems.push(`transfers ${fewest.transfers} > ${max_transfers}`);
  }
  out.result = out.problems.length === 0 ? "pass" : c.verified === true ? "FAIL" : "warning";
  return out;
}
