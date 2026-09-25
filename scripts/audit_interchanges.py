"""Coordinate checks, stop sharing, interchange candidates and headways.

Writes docs/interchange-candidates.md. Reports only what is in the files;
candidates are proximity matches, not confirmed interchanges.
Usage: python scripts/audit_interchanges.py
"""
import statistics
from collections import defaultdict
from itertools import combinations

from audit_gtfs import FEEDS
from gtfs_util import ROOT, haversine_m, hms, read, to_secs

OUT = ROOT / "docs" / "interchange-candidates.md"
BBOX = {"lat": (2.6, 3.4), "lon": (101.2, 102.0)}  # rough Klang Valley box
MAX_DIST_M = 400
BANDS = [(0, 6), (6, 9), (9, 17), (17, 20), (20, 30)]  # hours; 30 covers >24:00 GTFS times


def mins(secs):
    m = secs / 60
    return f"{m:.0f}" if m == int(m) else f"{m:.1f}"


def band_label(lo, hi):
    return f"{lo:02d}:00–{hi:02d}:00" if hi < 30 else f"{lo:02d}:00–end"


def load(label, d):
    routes = {r["route_id"]: r for r in read(d, "routes.txt")}
    trips = read(d, "trips.txt")
    trip_route = {t["trip_id"]: t["route_id"] for t in trips}
    stop_routes = defaultdict(set)
    for st in read(d, "stop_times.txt"):
        if st["trip_id"] in trip_route:
            stop_routes[st["stop_id"]].add(trip_route[st["trip_id"]])
    return {"label": label, "dir": d, "routes": routes, "trips": trips,
            "stops": read(d, "stops.txt"), "stop_routes": stop_routes,
            "stop_times": read(d, "stop_times.txt"), "freqs": read(d, "frequencies.txt")}


def route_name(feed, rid):
    r = feed["routes"].get(rid, {})
    return r.get("route_long_name") or r.get("route_short_name") or rid


def section_coords(feeds):
    out = ["## 1. Stop coordinates", "",
           f"Bounding box used: lat {BBOX['lat'][0]}–{BBOX['lat'][1]}, lon {BBOX['lon'][0]}–{BBOX['lon'][1]}.", ""]
    for f in feeds:
        missing, zero, outside = [], [], []
        for s in f["stops"]:
            la, lo = s.get("stop_lat", "").strip(), s.get("stop_lon", "").strip()
            if not la or not lo:
                missing.append(s)
                continue
            la, lo = float(la), float(lo)
            if la == 0 or lo == 0:
                zero.append(s)
            elif not (BBOX["lat"][0] <= la <= BBOX["lat"][1] and BBOX["lon"][0] <= lo <= BBOX["lon"][1]):
                outside.append(s)
        out.append(f"### {f['label']}")
        out.append("")
        out.append(f"- stops.txt rows: {len(f['stops'])}")
        out.append(f"- missing lat/lon: {len(missing)}" + (": " + ", ".join(s["stop_id"] for s in missing) if missing else ""))
        out.append(f"- zero lat or lon: {len(zero)}" + (": " + ", ".join(s["stop_id"] for s in zero) if zero else ""))
        out.append(f"- outside bounding box: {len(outside)}")
        if outside:
            out += ["", "  | stop_id | stop_name | lat | lon | routes serving it |", "  |---|---|---|---|---|"]
            for s in sorted(outside, key=lambda s: float(s["stop_lat"])):
                rs = ", ".join(sorted(f["stop_routes"].get(s["stop_id"], ()))) or "(none)"
                out.append(f"  | `{s['stop_id']}` | {s['stop_name'].strip()} | {s['stop_lat']} | {s['stop_lon']} | {rs} |")
        out.append("")
    return out


def section_sharing(feeds):
    out = ["## 2. parent_station and shared stop_ids", ""]
    for f in feeds:
        cols = list(f["stops"][0].keys()) if f["stops"] else []
        out.append(f"### {f['label']}")
        out.append("")
        if "parent_station" in cols:
            used = [s for s in f["stops"] if s["parent_station"].strip()]
            out.append(f"- `parent_station` column present; non-empty in {len(used)} of {len(f['stops'])} rows")
        else:
            out.append("- `parent_station` column: absent")
        out.append(f"- `location_type` column: {'present' if 'location_type' in cols else 'absent'}")
        shared = {sid: rs for sid, rs in f["stop_routes"].items() if len(rs) > 1}
        out.append(f"- stop_ids served by more than one route (via trips → stop_times): {len(shared)}")
        if shared:
            names = {s["stop_id"]: s["stop_name"].strip() for s in f["stops"]}
            out += ["", "  | stop_id | stop_name | routes |", "  |---|---|---|"]
            for sid, rs in sorted(shared.items(), key=lambda kv: (-len(kv[1]), kv[0])):
                out.append(f"  | `{sid}` | {names.get(sid, '(not in stops.txt)')} | {', '.join(sorted(rs))} |")
        stop_ids = {s["stop_id"] for s in f["stops"]}
        unserved = sorted(stop_ids - set(f["stop_routes"]))
        undefined = sorted(set(f["stop_routes"]) - stop_ids)
        out.append(f"- stops.txt rows not served by any trip: {len(unserved)}"
                   + (": " + ", ".join(f"`{x}`" for x in unserved) if unserved else ""))
        if undefined:
            out.append(f"- stop_ids in stop_times but missing from stops.txt: {', '.join(undefined)}")
        out.append("")
    ids = [{s["stop_id"] for s in f["stops"]} for f in feeds]
    clash = sorted(set.intersection(*ids))
    out.append(f"Cross-feed stop_id collisions (same stop_id string in both feeds): {len(clash)}"
               + (": " + ", ".join(clash) if clash else ""))
    out.append("")
    return out


def section_candidates(feeds):
    pts = []
    for f in feeds:
        for s in f["stops"]:
            rs = f["stop_routes"].get(s["stop_id"])
            try:
                la, lo = float(s["stop_lat"]), float(s["stop_lon"])
            except ValueError:
                continue
            if rs and la and lo:
                pts.append((f, s, rs, (la, lo)))
    rows = []
    for (fa, sa, ra, pa), (fb, sb, rb, pb) in combinations(pts, 2):
        if fa is fb and ra == rb:
            continue  # same feed, identical route set: consecutive stops on one line
        dist = haversine_m(pa, pb)
        if dist <= MAX_DIST_M:
            common = ra & rb if fa is fb else set()
            rows.append((dist, fa, sa, ra, fb, sb, rb, common))
    rows.sort(key=lambda r: r[0])

    out = ["## 3. Interchange candidates (proximity only)", "",
           f"Pairs of served stops within {MAX_DIST_M} m (haversine on stop_lat/stop_lon), where the two stops "
           "are in different feeds or are served by different route sets. Stops with no trips or unusable "
           "coordinates are excluded. **This is a distance match only; none of these is confirmed as an "
           "interchange.** The last column flags pairs whose stops share at least one route in the same feed.",
           "", f"{len(rows)} pairs.", "",
           "| # | dist (m) | stop A | feed A | routes A | stop B | feed B | routes B | shared route |",
           "|---|---|---|---|---|---|---|---|---|"]

    def fmt(f, s, rs):
        return (f"{s['stop_name'].strip()} (`{s['stop_id']}`)", f["label"],
                "; ".join(f"{r} {route_name(f, r)}" for r in sorted(rs)))

    for i, (dist, fa, sa, ra, fb, sb, rb, common) in enumerate(rows, 1):
        a, b = fmt(fa, sa, ra), fmt(fb, sb, rb)
        out.append(f"| {i} | {dist:.0f} | {a[0]} | {a[1]} | {a[2]} | {b[0]} | {b[1]} | {b[2]} | "
                   f"{', '.join(sorted(common)) if common else ''} |")
    out.append("")
    return out


def section_headways(feeds):
    out = ["## 4. Headways", ""]
    for f in feeds:
        out.append(f"### {f['label']}")
        out.append("")
        trip = {t["trip_id"]: t for t in f["trips"]}
        if f["freqs"] is not None:
            out += ["Source: `frequencies.txt` (headway_secs per time window, as published in the feed).", "",
                    "| route | service_id | dir | window | headway (min) |", "|---|---|---|---|---|"]
            key = lambda fr: (trip[fr["trip_id"]]["route_id"], trip[fr["trip_id"]]["service_id"],
                              trip[fr["trip_id"]].get("direction_id", ""), to_secs(fr["start_time"]))
            for fr in sorted((x for x in f["freqs"] if x["trip_id"] in trip), key=key):
                t = trip[fr["trip_id"]]
                out.append(f"| {t['route_id']} {route_name(f, t['route_id'])} | {t['service_id']} | "
                           f"{t.get('direction_id', '')} | {hms(to_secs(fr['start_time']))}–{hms(to_secs(fr['end_time']))} | "
                           f"{mins(int(fr['headway_secs']))} |")
            orphan = [x for x in f["freqs"] if x["trip_id"] not in trip]
            if orphan:
                out.append(f"\n{len(orphan)} frequencies.txt rows reference unknown trip_ids.")
            out.append("")
            continue

        # Real departures: per (route, service, direction), pick the stop served by the most trips in
        # that group as the reference, and measure gaps between successive departures there.
        out += ["Source: `stop_times.txt` departures. For each (route, service_id, direction) the reference stop "
                "is the one served by the most trips in that group; headway = gap between successive departures "
                "there. Band medians use the earlier departure of each gap. Ignores calendar_dates exceptions.", "",
                "| route | service_id | dir | ref stop | deps | first | last | median | min | max | "
                + " | ".join(band_label(*b) for b in BANDS) + " |",
                "|---|---|---|---|---|---|---|---|---|---|" + "---|" * len(BANDS)]
        names = {s["stop_id"]: s["stop_name"].strip() for s in f["stops"]}
        deps = defaultdict(lambda: defaultdict(list))  # group -> stop -> [(secs, trip_id)]
        for st in f["stop_times"]:
            t = trip.get(st["trip_id"])
            if t and st["departure_time"].strip():
                g = (t["route_id"], t["service_id"], t.get("direction_id", ""))
                deps[g][st["stop_id"]].append((to_secs(st["departure_time"]), st["trip_id"]))
        same_time, small = [], []
        for g in sorted(deps):
            ref, pairs = max(deps[g].items(), key=lambda kv: (len(kv[1]), kv[0]))
            pairs.sort()
            times = [s for s, _ in pairs]
            for (a, ta), (b, tb) in zip(pairs, pairs[1:]):
                if a == b:
                    same_time.append(f"{g[0]} / {g[1]} / dir {g[2]} at {names.get(ref, ref)} {hms(a)}: "
                                     f"trips `{ta}`, `{tb}`")
            if len(times) < 3:
                small.append(f"{g[0]} / {g[1]} / dir {g[2]} ({len(times)} departures)")
            gaps = [(b - a, a) for a, b in zip(times, times[1:])]
            rid, sid, di = g
            cells = [f"{rid} {route_name(f, rid)}", sid, di, names.get(ref, ref), str(len(times)),
                     hms(times[0])[:5], hms(times[-1])[:5]]
            if gaps:
                vals = [x for x, _ in gaps]
                cells += [mins(statistics.median(vals)), mins(min(vals)), mins(max(vals))]
                for lo, hi in BANDS:
                    b = [x for x, at in gaps if lo * 3600 <= at < hi * 3600]
                    cells.append(f"{mins(statistics.median(b))} (n={len(b)})" if b else "–")
            else:
                cells += ["–"] * (3 + len(BANDS))
            out.append("| " + " | ".join(cells) + " |")
        out += ["", "Values in minutes. `n` = number of gaps in the band. Times past 24:00 are GTFS next-day times.", ""]
        if same_time:
            out += [f"Departures at the same time from the same reference stop ({len(same_time)}; produce 0-min gaps):", ""]
            out += [f"- {x}" for x in same_time] + [""]
        if small:
            out += ["Groups with fewer than 3 departures (reference stop is effectively arbitrary; "
                    "gaps may span unrelated trips): " + "; ".join(small), ""]
    return out


def main():
    feeds = [load(label, d) for label, d in FEEDS.items()]
    lines = ["# Interchange candidates and headways", "",
             "Generated by `audit_interchanges.py`. Everything is read from the extracted GTFS files; route "
             "membership of a stop comes from trips.txt → stop_times.txt.", ""]
    lines += section_coords(feeds) + section_sharing(feeds) + section_candidates(feeds) + section_headways(feeds)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
