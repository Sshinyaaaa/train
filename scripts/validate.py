"""Validation checks for network.json (PLAN.md §5). Errors block the build; warnings ship in meta.

Usage: python scripts/validate.py [PATH]   (defaults to site/data/network.json)
As a CLI, feed staleness is recomputed against today (used by the Pages Action).
"""
import datetime as dt
import json
import sys
from collections import defaultdict, deque

from gtfs_util import ROOT

MAX_SEGMENT_SEC = 30 * 60
STALE_DAYS = 14
DAY_TYPES = ("weekday", "saturday", "sunday")
KTMB_ALLOWED = {"ktmb:KC05_KB18", "ktmb:KA15_KD19"}
HUB = "ktmb:19100"  # KL Sentral, reachability origin
# Stations per line on the reference map (docs/interchange-review-draft.md §4). Coverage only.
MAP_COUNTS = {"ktmb:KC05_KB18": 27, "ktmb:KA15_KD19": 34, "rapid:AG": 18, "rapid:PH": 29, "rapid:KJ": 37,
              "rapid:MR": 11, "rapid:KGL": 29, "rapid:PYL": 36, "rapid:SA": 20, "rapid:BRT": 7,
              "erl-klia-ekspres": 3, "erl-klia-transit": 6}


def validate(net, today=None):
    """Return (errors, warnings). `today` (a date) recomputes feed staleness, e.g. at deploy time."""
    errors, warnings = [], []
    if today is not None:
        for m in net["meta"]["feeds"].values():
            m["days_left"] = (dt.date.fromisoformat(m["calendar_end"]) - today).days
    stops, lines, stations = net["stops"], net["lines"], net["stations"]

    # references
    for lid, line in lines.items():
        for p in line["patterns"]:
            for s in p["stops"]:
                if s not in stops:
                    errors.append(f"{lid} dir {p['dir']}: unknown stop {s}")
    for t in net["transfers"]:
        for end in ("from", "to"):
            if t[end] not in stops:
                errors.append(f"transfer {t['from']} - {t['to']}: unknown stop {t[end]}")
        if t["kind"] not in ("interchange", "connecting"):
            errors.append(f"transfer {t['from']} - {t['to']}: bad kind {t['kind']!r}")
    seen = defaultdict(list)
    for sid, st in stations.items():
        for s in st["stops"]:
            seen[s].append(sid)
    for s in stops:
        if len(seen.get(s, [])) != 1:
            errors.append(f"stop {s} is in {len(seen.get(s, []))} stations (expected 1)")

    # every line needs display metadata (the UI never shows raw GTFS codes)
    for lid, line in lines.items():
        d = line.get("display")
        if not d or not d.get("number") or not d.get("name"):
            errors.append(f"{lid}: missing display metadata (overrides/display.json)")
        if not line.get("color"):
            errors.append(f"{lid}: no colour")

    # KTMB scope
    for lid in lines:
        if lid.startswith("ktmb:") and lid not in KTMB_ALLOWED:
            errors.append(f"out-of-scope KTMB line {lid}")

    # run times and headways
    for lid, line in lines.items():
        for p in line["patterns"]:
            run = p["run_sec"]
            if run is None or None in run or len(run) != len(p["stops"]):
                errors.append(f"{lid} dir {p['dir']}: incomplete run_sec")
                continue
            for a, b, s0, s1 in zip(run, run[1:], p["stops"], p["stops"][1:]):
                if not 0 < b - a <= MAX_SEGMENT_SEC:
                    errors.append(f"{lid} dir {p['dir']}: segment {s0} -> {s1} is {b - a} s")
            for day in DAY_TYPES:
                if not p["headways"].get(day):
                    errors.append(f"{lid} dir {p['dir']}: no headway for {day}")
            est = p.get("estimated_segments", [])
            if any(not 0 <= i < len(p["stops"]) - 1 for i in est):
                errors.append(f"{lid} dir {p['dir']}: estimated_segments out of range")
            elif est:
                warnings.append(f"{lid} dir {p['dir']}: {len(est)} segments estimated by pattern override")

    # coverage vs reference map counts
    for lid, expected in MAP_COUNTS.items():
        if lid not in lines:
            errors.append(f"coverage: line {lid} missing")
            continue
        n = len({s for p in lines[lid]["patterns"] for s in p["stops"]})
        if n != expected:
            errors.append(f"coverage: {lid} has {n} stops, map shows {expected}")

    # reachability from KL Sentral over ride + transfer edges (and shared stations)
    adj = defaultdict(set)
    for line in lines.values():
        for p in line["patterns"]:
            for a, b in zip(p["stops"], p["stops"][1:]):
                adj[a].add(b)
    for t in net["transfers"]:
        adj[t["from"]].add(t["to"])
        adj[t["to"]].add(t["from"])
    if HUB in stops:
        seen_s, q = {HUB}, deque([HUB])
        while q:
            for n in adj[q.popleft()]:
                if n not in seen_s:
                    seen_s.add(n)
                    q.append(n)
        unreachable = [sid for sid, st in stations.items() if not seen_s & set(st["stops"])]
        if unreachable:
            warnings.append(f"{len(unreachable)} stations unreachable from KL Sentral: {', '.join(sorted(unreachable)[:10])}")

    # estimates and unset flags (informational warnings)
    est = [t for t in net["transfers"] if t.get("walk_source") == "estimated"]
    if est:
        warnings.append(f"{len(est)} of {len(net['transfers'])} transfers use an estimated walk_min")
    unset = sum(t["exits_gates"] is None for t in net["transfers"])
    if unset:
        warnings.append(f"{unset} transfers have exits_gates unset (treated as no gate penalty)")
    for lid, line in lines.items():
        if any(p["run_source"] == "estimated" for p in line["patterns"]):
            warnings.append(f"{lid}: run times are estimated")

    # stale feeds: still deployed, only warned
    for feed, m in net["meta"]["feeds"].items():
        if m["days_left"] < 0:
            warnings.append(f"STALE: {feed} calendar ended {m['calendar_end']}; service kept using weekday flags")
        elif m["days_left"] <= STALE_DAYS:
            warnings.append(f"STALE SOON: {feed} calendar ends {m['calendar_end']} ({m['days_left']} days)")
    return errors, warnings


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else ROOT / "site" / "data" / "network.json"
    with open(path, encoding="utf-8") as f:
        errors, warnings = validate(json.load(f), today=dt.date.today())
    for w in warnings:
        print("WARNING", w)
    for e in errors:
        print("ERROR  ", e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
