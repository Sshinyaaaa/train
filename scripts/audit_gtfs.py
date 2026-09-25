"""Audit the extracted GTFS feeds and write docs/data-audit.md.

Reports only what is present in the files. Usage: python scripts/audit_gtfs.py
"""
import re
import statistics
from collections import Counter, defaultdict
from gtfs_util import RAW, ROOT, hms, read, to_secs

FEEDS = {
    "Prasarana rapid-rail-kl": RAW / "rapid_rail_kl",
    "KTMB": RAW / "ktmb",
}
OUT = ROOT / "docs" / "data-audit.md"

# Case-insensitive patterns searched across every .txt file of every feed.
SEARCHES = {
    "LRT Shah Alam Line (LRT3)": [r"shah\s*alam", r"\blrt\s*3\b", r"\bSAL\b", r"johan\s*setia"],
    "ERL / KLIA Transit / KLIA Ekspres": [r"\bERL\b", r"\bKLIA\b", r"klia\s*transit", r"klia\s*ekspres",
                                          r"express\s*rail\s*link"],
    "BRT Sunway": [r"\bBRT\b", r"sunway"],
}


def fmt_date(d):
    return f"{d[:4]}-{d[4:6]}-{d[6:]}" if d and len(d) == 8 else d


def audit_feed(label, d):
    out = [f"## {label}", "", f"Source folder: `{d.relative_to(ROOT)}`", ""]
    files = sorted(p.name for p in d.glob("*.txt"))
    out.append("Files present: " + ", ".join(f"`{f}`" for f in files))
    out.append("")

    routes = read(d, "routes.txt") or []
    trips = read(d, "trips.txt") or []
    stop_times = read(d, "stop_times.txt") or []
    stops = read(d, "stops.txt") or []
    freqs = read(d, "frequencies.txt")

    # --- Routes & station counts (via trips -> stop_times) ---
    trip_route = {t["trip_id"]: t["route_id"] for t in trips}
    route_stops = defaultdict(set)
    unmatched_st = 0
    for st in stop_times:
        rid = trip_route.get(st["trip_id"])
        if rid is None:
            unmatched_st += 1
        else:
            route_stops[rid].add(st["stop_id"])
    trips_per_route = Counter(t["route_id"] for t in trips)
    # Some feeds carry a non-standard route_id column in stops.txt.
    stops_route_col = defaultdict(set)
    if stops and "route_id" in stops[0]:
        for s in stops:
            stops_route_col[s["route_id"]].add(s["stop_id"])

    out += ["### Routes", ""]
    hdr = "| route_id | short name | long name | route_type | trips | distinct stops served (stop_times) |"
    sep = "|---|---|---|---|---|---|"
    if stops_route_col:
        hdr += " stops tagged with route_id (stops.txt, non-standard column) |"
        sep += "---|"
    out += [hdr, sep]
    for r in routes:
        rid = r["route_id"]
        row = (f"| `{rid}` | {r.get('route_short_name', '')} | {r.get('route_long_name', '')} | "
               f"{r.get('route_type', '')} | {trips_per_route.get(rid, 0)} | {len(route_stops.get(rid, ()))} |")
        if stops_route_col:
            row += f" {len(stops_route_col.get(rid, ()))} |"
        out.append(row)
    out.append("")
    out.append(f"Total routes: {len(routes)}; trips: {len(trips)}; stop_times rows: {len(stop_times)}; "
               f"stops.txt rows: {len(stops)}.")
    if unmatched_st:
        out.append(f"\n**Note:** {unmatched_st} stop_times rows reference a trip_id not in trips.txt.")
    no_trip_routes = [r["route_id"] for r in routes if trips_per_route.get(r["route_id"], 0) == 0]
    if no_trip_routes:
        out.append(f"\n**Routes with no trips in trips.txt:** {', '.join(f'`{x}`' for x in no_trip_routes)}")
    extra = set(stops_route_col) - {r["route_id"] for r in routes}
    if extra:
        out.append(f"\n**stops.txt route_id values not in routes.txt:** " + ", ".join(
            f"`{x}` ({len(stops_route_col[x])} stops, e.g. {', '.join(sorted(stops_route_col[x])[:3])})"
            for x in sorted(extra)))
    out.append("")

    # --- Transfers & fares ---
    out += ["### Transfers and fares", ""]
    transfers = read(d, "transfers.txt")
    out.append(f"- `transfers.txt`: " + ("absent" if transfers is None else f"present, {len(transfers)} rows"))
    for fname in ("fare_attributes.txt", "fare_rules.txt"):
        rows = read(d, fname)
        out.append(f"- `{fname}`: " + ("absent" if rows is None else f"present, {len(rows)} rows"))
    out.append("")

    # --- Service dates ---
    out += ["### Service dates", ""]
    cal = read(d, "calendar.txt")
    if cal is None:
        out.append("- `calendar.txt`: absent")
    else:
        starts = [c["start_date"] for c in cal]
        ends = [c["end_date"] for c in cal]
        out.append(f"- `calendar.txt`: {len(cal)} service_ids, overall range "
                   f"{fmt_date(min(starts))} → {fmt_date(max(ends))}")
        out.append("")
        out.append("  | service_id | Mon–Sun | start | end |")
        out.append("  |---|---|---|---|")
        days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        for c in cal:
            out.append(f"  | `{c['service_id']}` | {''.join(c[x] for x in days)} | "
                       f"{fmt_date(c['start_date'])} | {fmt_date(c['end_date'])} |")
    used = {t["service_id"] for t in trips}
    out.append(f"- service_ids referenced by trips.txt: {', '.join(f'`{x}`' for x in sorted(used))}")
    if cal is not None:
        unused = sorted({c["service_id"] for c in cal} - used)
        if unused:
            out.append(f"- calendar.txt service_ids not used by any trip: {', '.join(f'`{x}`' for x in unused)}")
    cd = read(d, "calendar_dates.txt")
    if cd is None:
        out.append("- `calendar_dates.txt`: absent")
    else:
        dates = sorted(c["date"] for c in cd)
        kinds = Counter(c["exception_type"] for c in cd)
        out.append(f"- `calendar_dates.txt`: {len(cd)} rows, dates {fmt_date(dates[0])} → {fmt_date(dates[-1])}; "
                   f"exception_type counts: {dict(sorted(kinds.items()))} (1 = added, 2 = removed)")
        out.append("  - distinct dates: " + ", ".join(fmt_date(x) for x in sorted(set(dates))))
    out.append("")

    # --- Real times vs frequency placeholders ---
    out += ["### stop_times: real timetable or frequency template?", ""]
    by_trip = defaultdict(list)
    for st in stop_times:
        by_trip[st["trip_id"]].append(st)
    for rows in by_trip.values():
        rows.sort(key=lambda r: int(r["stop_sequence"]))
    empty_times = sum(1 for st in stop_times if not st["arrival_time"].strip())
    unpadded = sum(1 for st in stop_times if re.match(r"^\d:", st["arrival_time"].strip()))
    first_deps = sorted(to_secs(r[0]["departure_time"]) for r in by_trip.values() if r[0]["departure_time"].strip())
    dwells = Counter(to_secs(st["departure_time"]) - to_secs(st["arrival_time"])
                     for st in stop_times if st["arrival_time"].strip() and st["departure_time"].strip())
    trips_per_rs = Counter((t["route_id"], t["service_id"], t.get("direction_id", "")) for t in trips)

    out.append(f"- Trips with stop_times: {len(by_trip)}; stop_times rows: {len(stop_times)}; "
               f"rows with empty arrival_time: {empty_times}")
    out.append(f"- Columns: {', '.join(f'`{c}`' for c in (stop_times[0].keys() if stop_times else []))}")
    if unpadded:
        out.append(f"- {unpadded} rows use single-digit hours (e.g. `6:00:00`); GTFS allows H:MM:SS, "
                   f"but some consumers expect HH:MM:SS")
    if first_deps:
        distinct_starts = len(set(first_deps))
        out.append(f"- Distinct first-departure times across trips: {distinct_starts} "
                   f"(earliest {hms(first_deps[0])}, latest {hms(first_deps[-1])})")
    top_dwells = ", ".join(f"{k}s×{v}" for k, v in dwells.most_common(5))
    out.append(f"- Most common dwell (departure − arrival): {top_dwells}")
    out.append(f"- Trips per (route, service, direction): min {min(trips_per_rs.values()) if trips_per_rs else 0}, "
               f"median {statistics.median(trips_per_rs.values()) if trips_per_rs else 0}, "
               f"max {max(trips_per_rs.values()) if trips_per_rs else 0}")
    if freqs is None:
        out.append("- `frequencies.txt`: absent")
    else:
        ftrips = {f["trip_id"] for f in freqs}
        exact = Counter(f.get("exact_times", "") for f in freqs)
        headways = sorted({int(f["headway_secs"]) for f in freqs})
        out.append(f"- `frequencies.txt`: present, {len(freqs)} rows covering {len(ftrips)} trip_ids "
                   f"({len(ftrips & set(by_trip))} of {len(by_trip)} stop_times trips); "
                   f"headway_secs values: {headways}; exact_times column: "
                   f"{'absent' if '' in exact and len(exact) == 1 else dict(exact)}")

    # Verdict, derived from the numbers above
    if freqs is not None and by_trip and set(by_trip) <= {f["trip_id"] for f in freqs}:
        verdict = ("**Frequency-based.** Every trip in stop_times.txt is listed in frequencies.txt, so the "
                   "stop_times rows are one template run per trip whose times give inter-stop travel times; "
                   "actual departures are generated from headway_secs. These are not a published timetable.")
    elif freqs is not None:
        verdict = "**Mixed.** Some trips are frequency-based (frequencies.txt), others are not."
    else:
        verdict = ("**Explicit trip times.** No frequencies.txt; each trip carries its own stop_times. "
                   "Whether those times match the operator's real timetable cannot be verified from the files.")
    out += ["", verdict, ""]

    # Non-standard stop_times columns / mismatched ids
    if stop_times and "route_id" in stop_times[0]:
        st_rids = Counter(st["route_id"] for st in stop_times)
        mism = sum(1 for st in stop_times
                   if st["route_id"] != trip_route.get(st["trip_id"]))
        out.append(f"- stop_times.txt carries a non-standard `route_id` column; values {sorted(st_rids)}. "
                   f"{mism} of {len(stop_times)} rows differ from the route_id that trips.txt gives the same trip "
                   f"(stop_times appears to use route_short_name).")
        out.append("")
    return out


def search_all():
    out = ["## Presence check: LRT3, ERL/KLIA Transit, BRT Sunway", "",
           "Case-insensitive search of every `.txt` file in both feeds. Patterns listed per target; "
           "hits show file, line count and up to 3 sample lines.", ""]
    for target, pats in SEARCHES.items():
        rx = re.compile("|".join(pats), re.I)
        out.append(f"### {target}")
        out.append("")
        out.append("Patterns: " + ", ".join(f"`{p}`" for p in pats))
        out.append("")
        any_hit = False
        for label, d in FEEDS.items():
            for p in sorted(d.glob("*.txt")):
                lines = p.read_text(encoding="utf-8-sig").splitlines()
                hits = [ln for ln in lines[1:] if rx.search(ln)]
                if hits:
                    any_hit = True
                    out.append(f"- **{label}** `{p.name}`: {len(hits)} matching rows")
                    for h in hits[:3]:
                        out.append(f"  - `{h[:160]}`")
        if not any_hit:
            out.append("- **No matches in either feed.**")
        out.append("")
    return out


def main():
    lines = ["# GTFS data audit", "",
             "Generated by `audit_gtfs.py` from the extracted feeds. Everything below is read directly from "
             "the files; nothing is inferred from outside sources.", ""]
    for label, d in FEEDS.items():
        lines += audit_feed(label, d)
    lines += search_all()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
