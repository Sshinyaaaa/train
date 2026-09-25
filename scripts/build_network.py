"""Build site/data/network.json from the GTFS feeds and overrides/.

Usage: python scripts/build_network.py [--out PATH] [--today YYYY-MM-DD]
Writes nothing and exits 1 if validation reports errors. See PLAN.md §2–5.
"""
import argparse
import datetime as dt
import json
import math
import statistics
import sys
from collections import Counter, defaultdict

from gtfs_util import RAW, ROOT, haversine_m, read, to_secs
from validate import validate

CONFIG = {
    "gate_penalty_min": 5,
    "walk": {"detour_factor": 1.4, "speed_kmh": 4.5, "overhead_min": {"interchange": 1, "connecting": 2}},
    "ktmb_routes": ["KC05_KB18", "KA15_KD19"],
}
FEEDS = {"rapid": RAW / "rapid_rail_kl", "ktmb": RAW / "ktmb"}
OVERRIDES = ROOT / "overrides"
DAYS = {"weekday": ["monday", "tuesday", "wednesday", "thursday", "friday"],
        "saturday": ["saturday"], "sunday": ["sunday"]}
KTM_BANDS_H = [(0, 6), (6, 9), (9, 17), (17, 20), (20, 30)]  # 30 h covers GTFS times past 24:00


def day_types(cal_row):
    """Day types a service runs on, from weekday flags only. start/end dates are ignored on
    purpose so a lapsed calendar never drops service (staleness is a validation warning)."""
    return [d for d, cols in DAYS.items() if any(cal_row[c] == "1" for c in cols)]


def estimate_walk_min(dist_m, kind, walk=CONFIG["walk"]):
    minutes = dist_m * walk["detour_factor"] / (walk["speed_kmh"] * 1000 / 60) + walk["overhead_min"][kind]
    return math.ceil(round(minutes, 6))


def distance_split(coords, total_sec):
    """Cumulative run seconds for stops at `coords`, splitting total_sec by straight-line distance."""
    legs = [haversine_m(a, b) for a, b in zip(coords, coords[1:])]
    total = sum(legs)
    cum, acc = [0], 0.0
    for d in legs:
        acc += d
        cum.append(round(total_sec * acc / total))
    return cum


def build_patterns(trips, stop_times):
    """One pattern per (route, direction): the longest stop sequence; run_sec = cumulative median
    arrival-to-arrival time per segment over all trips that run that segment."""
    by_trip = defaultdict(list)
    for st in stop_times:
        by_trip[st["trip_id"]].append(st)
    for rows in by_trip.values():
        rows.sort(key=lambda r: int(r["stop_sequence"]))
    groups = defaultdict(list)
    for t in trips:
        if t["trip_id"] in by_trip:
            groups[(t["route_id"], t.get("direction_id") or "0")].append(t["trip_id"])
    patterns, notes = {}, []
    for (rid, d), tids in groups.items():
        seqs = {tid: [r["stop_id"] for r in by_trip[tid]] for tid in tids}
        main = max(seqs.values(), key=len)
        pos = {s: i for i, s in enumerate(main)}
        seg = defaultdict(list)
        off_pattern = 0
        for tid in tids:
            rows = by_trip[tid]
            idx = [pos.get(r["stop_id"]) for r in rows]
            if None in idx or any(b != a + 1 for a, b in zip(idx, idx[1:])):
                off_pattern += 1
                continue
            for r0, r1, i in zip(rows, rows[1:], idx):
                seg[i].append(to_secs(r1["arrival_time"]) - to_secs(r0["arrival_time"]))
        cum = [0]
        for i in range(len(main) - 1):
            ok = seg[i] and cum[-1] is not None
            cum.append(cum[-1] + round(statistics.median(seg[i])) if ok else None)
        if off_pattern:
            notes.append(f"{rid} dir {d}: {off_pattern} of {len(tids)} trips skip or reorder stops vs the main "
                         f"pattern (e.g. run the opposite way under the same direction_id); ignored for run times")
        patterns[(rid, d)] = {"stops": main, "run_sec": cum, "trips": tids}
    return patterns, by_trip, notes


def rapid_headways(trips, freqs, service_days):
    """frequencies.txt windows per (route, dir) and day type."""
    trip = {t["trip_id"]: t for t in trips}
    out = defaultdict(lambda: defaultdict(list))
    for f in freqs:
        t = trip[f["trip_id"]]
        for day in service_days[t["service_id"]]:
            out[(t["route_id"], t.get("direction_id") or "0")][day].append(
                [to_secs(f["start_time"]), to_secs(f["end_time"]), int(f["headway_secs"])])
    for days in out.values():
        for bands in days.values():
            bands.sort()
    return out


def ktm_headways(trips, by_trip, service_days):
    """Typical headway per band from real departures at the most-served stop of each
    (route, dir, day type) group — same method as audit_interchanges.py §4."""
    groups = defaultdict(lambda: defaultdict(list))
    for t in trips:
        for day in service_days[t["service_id"]]:
            for r in by_trip.get(t["trip_id"], []):
                groups[(t["route_id"], t.get("direction_id") or "0", day)][r["stop_id"]].append(to_secs(r["departure_time"]))
    out = defaultdict(dict)
    for (rid, d, day), per_stop in groups.items():
        deps = sorted(max(per_stop.values(), key=len))
        gaps = [(b - a, a) for a, b in zip(deps, deps[1:]) if b > a]
        if not gaps:
            continue
        overall = statistics.median(g for g, _ in gaps)
        bands = []
        for lo, hi in KTM_BANDS_H:
            start, end = max(lo * 3600, deps[0]), min(hi * 3600, deps[-1])
            if start >= end:
                continue
            in_band = [g for g, at in gaps if lo * 3600 <= at < hi * 3600]
            bands.append([start, end, round(statistics.median(in_band) if in_band else overall)])
        out[(rid, d)][day] = bands
    return out


def load_gtfs(prefix, feed_dir, route_filter=None):
    routes = {r["route_id"]: r for r in read(feed_dir, "routes.txt")}
    trips = [t for t in read(feed_dir, "trips.txt") if route_filter is None or t["route_id"] in route_filter]
    keep = {t["trip_id"] for t in trips}
    stop_times = [st for st in read(feed_dir, "stop_times.txt") if st["trip_id"] in keep]
    stops = {s["stop_id"]: s for s in read(feed_dir, "stops.txt")}
    cal = read(feed_dir, "calendar.txt") or []
    service_days = {c["service_id"]: day_types(c) for c in cal}
    patterns, by_trip, notes = build_patterns(trips, stop_times)
    freqs = read(feed_dir, "frequencies.txt")
    if freqs is not None:
        heads, h_src = rapid_headways(trips, [f for f in freqs if f["trip_id"] in keep], service_days), "gtfs_frequencies"
    else:
        heads, h_src = ktm_headways(trips, by_trip, service_days), "gtfs_typical"

    lines, line_stops = {}, {}
    for (rid, d), p in sorted(patterns.items()):
        r = routes[rid]
        line = lines.setdefault(f"{prefix}:{rid}", {
            "name": r.get("route_long_name") or rid, "short": r.get("route_short_name") or rid,
            "color": ("#" + r["route_color"]) if r.get("route_color") else None,
            "source": "gtfs", "patterns": []})
        ids = [f"{prefix}:{s}" for s in p["stops"]]
        line["patterns"].append({"dir": int(d), "stops": ids, "run_sec": p["run_sec"], "run_source": "gtfs",
                                 "headways": dict(heads.get((rid, d), {})), "headway_source": h_src})
        for s, sid in zip(p["stops"], ids):
            st = stops[s]
            ls = line_stops.setdefault(sid, {"name": st["stop_name"].strip(), "lat": float(st["stop_lat"]),
                                             "lon": float(st["stop_lon"]), "lines": []})
            if f"{prefix}:{rid}" not in ls["lines"]:
                ls["lines"].append(f"{prefix}:{rid}")
    cal_end = max((c["end_date"] for c in cal), default=None)
    return lines, line_stops, notes, cal_end


def load_manual_lines(line_stops):
    lines, notes = {}, []
    for path in sorted((OVERRIDES / "lines").glob("*.json")):
        spec = json.loads(path.read_text(encoding="utf-8"))
        lid = spec["id"]
        coords = {}
        for s in spec["stops"]:
            sid = f"{lid}:{s['id']}"
            if "coord_from" in s:
                src = line_stops[s["coord_from"]]
                lat, lon = src["lat"], src["lon"]
            else:
                lat, lon = s["lat"], s["lon"]
            coords[s["id"]] = (lat, lon)
            line_stops[sid] = {"name": s["name"], "lat": lat, "lon": lon, "lines": [lid]}
        pats = []
        for p in spec["patterns"]:
            run, run_src = p.get("run_sec"), p.get("run_source", "official")
            if run is None and p.get("run_estimate", {}).get("method") == "distance_split":
                run = distance_split([coords[s] for s in p["stops"]], p["run_estimate"]["total_sec"])
                run_src = "estimated"
            pats.append({"dir": p["dir"], "stops": [f"{lid}:{s}" for s in p["stops"]], "run_sec": run,
                         "run_source": run_src, "headways": p.get("headways") or {},
                         "headway_source": p.get("headway_source", "official")})
        lines[lid] = {"name": spec["name"], "short": spec.get("short", spec["name"]), "color": spec.get("color"),
                      "source": "manual", "sources": spec.get("sources", []), "patterns": pats}
        if spec.get("not_modelled"):
            notes.append(f"{lid}: not modelled — {spec['not_modelled']}")
    return lines, notes


def load_transfers(line_stops):
    out = []
    for t in json.loads((OVERRIDES / "transfers.json").read_text(encoding="utf-8")):
        row = {"from": t["from"], "to": t["to"], "kind": t["kind"], "walk_min": t.get("walk_min"),
               "walk_source": "manual", "exits_gates": t.get("exits_gates"), "note": t.get("note", "")}
        a, b = line_stops.get(t["from"]), line_stops.get(t["to"])
        if row["walk_min"] is None and a and b:  # manual values always win; estimate only gaps
            dist = haversine_m((a["lat"], a["lon"]), (b["lat"], b["lon"]))
            row["walk_min"], row["walk_source"], row["dist_m"] = estimate_walk_min(dist, t["kind"]), "estimated", round(dist)
        out.append(row)
    return out


def station_name(names):
    """Distinct names joined with ' / '. Names equal after dropping spaces/punctuation, or that
    extend a shorter one (sponsor suffixes like 'KL SENTRAL - REDONE'), collapse to the shorter."""
    key = lambda n: "".join(c for c in n.upper() if c.isalnum())
    kept = []
    for n in sorted({n.strip() for n in names}, key=lambda n: (len(n), n)):
        if not any(key(n).startswith(key(k)) for k in kept):
            kept.append(n)
    return " / ".join(kept)


def apply_pattern_overrides(lines, notes):
    """Insert stops into a GTFS pattern (feed gaps). New segment times are mirrored from the
    opposite-direction pattern and recorded in the pattern's `estimated_segments`."""
    path = OVERRIDES / "patterns.json"
    if not path.exists():
        return
    for o in json.loads(path.read_text(encoding="utf-8")):
        line = lines[o["line"]]
        p = next(p for p in line["patterns"] if p["dir"] == o["dir"])
        opp = next(q for q in line["patterns"] if q["dir"] != o["dir"])
        at = p["stops"].index(o["insert_after"])
        if any(s in p["stops"] for s in o["stops"]):
            raise ValueError(f"pattern override {o['line']} dir {o['dir']}: stop already in pattern")
        new_seq = [p["stops"][at], *o["stops"], p["stops"][at + 1]]
        if o["run_from"] != "opposite_direction":
            raise ValueError(f"unknown run_from {o['run_from']!r}")
        seg = []
        for a, b in zip(new_seq, new_seq[1:]):  # a->b here is b->a in the opposite pattern
            i, j = opp["stops"].index(b), opp["stops"].index(a)
            if j != i + 1:
                raise ValueError(f"pattern override: {b} -> {a} not adjacent in opposite direction")
            seg.append(opp["run_sec"][j] - opp["run_sec"][i])
        old_seg = p["run_sec"][at + 1] - p["run_sec"][at]
        shift = sum(seg) - old_seg
        run = p["run_sec"][: at + 1]
        for d in seg[:-1]:
            run.append(run[-1] + d)
        run += [r + shift for r in p["run_sec"][at + 1:]]
        p["stops"] = p["stops"][: at + 1] + o["stops"] + p["stops"][at + 1:]
        p["run_sec"] = run
        est = set(p.get("estimated_segments", []))
        est = {i + len(o["stops"]) if i > at else i for i in est} | set(range(at, at + len(seg)))
        p["estimated_segments"] = sorted(est)
        p.setdefault("overrides", []).append(o["note"])
        notes.append(f"{o['line']} dir {o['dir']}: inserted {', '.join(o['stops'])} after {o['insert_after']} "
                     f"(times mirrored from opposite direction, estimated)")


def group_stations(line_stops, transfers):
    parent = {s: s for s in line_stops}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for t in transfers:
        if t["kind"] == "interchange" and t["from"] in parent and t["to"] in parent:
            parent[find(t["from"])] = find(t["to"])
    members = defaultdict(list)
    for s in line_stops:
        members[find(s)].append(s)
    stations = {}
    for stops in members.values():
        stops.sort()
        manual = [line_stops[s]["name"] for s in stops if not s.startswith(("rapid:", "ktmb:"))]
        sid = "st:" + stops[0]
        lat = sum(line_stops[s]["lat"] for s in stops) / len(stops)
        lon = sum(line_stops[s]["lon"] for s in stops) / len(stops)
        stations[sid] = {"name": manual[0] if manual else station_name(line_stops[s]["name"] for s in stops),
                         "lat": round(lat, 6), "lon": round(lon, 6), "stops": stops}
        for s in stops:
            line_stops[s]["station"] = sid
    return stations


def build(today):
    rapid_lines, stops, notes, rapid_end = load_gtfs("rapid", FEEDS["rapid"])
    ktm_lines, ktm_stops, ktm_notes, ktm_end = load_gtfs("ktmb", FEEDS["ktmb"], set(CONFIG["ktmb_routes"]))
    stops.update(ktm_stops)
    manual_lines, manual_notes = load_manual_lines(stops)
    lines = {**rapid_lines, **ktm_lines, **manual_lines}
    apply_pattern_overrides(lines, manual_notes)
    display = json.loads((OVERRIDES / "display.json").read_text(encoding="utf-8"))["lines"]
    for lid, line in lines.items():
        d = display.get(lid)
        if d:
            line["display"] = {"number": d["number"], "name": d["name"], "label": f"{d['number']} · {d['name']}",
                               "mode": d.get("mode")}
            if not line.get("color") and d.get("color"):
                line["color"], line["color_source"] = d["color"], "display_approx"
    transfers = load_transfers(stops)
    stations = group_stations(stops, transfers)

    def feed_meta(end):
        end_d = dt.date(int(end[:4]), int(end[4:6]), int(end[6:]))
        return {"calendar_end": end_d.isoformat(), "days_left": (end_d - today).days}

    net = {
        "meta": {"built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                 "today": today.isoformat(), "config": CONFIG,
                 "gate_penalty_min": CONFIG["gate_penalty_min"],
                 "feeds": {"rapid_rail_kl": feed_meta(rapid_end), "ktmb": feed_meta(ktm_end)},
                 "notes": notes + ktm_notes + manual_notes},
        "stations": stations, "stops": stops, "lines": lines, "transfers": transfers,
    }
    return net


def stats(net):
    pats = [p for l in net["lines"].values() for p in l["patterns"]]
    ride = sum(len(p["stops"]) - 1 for p in pats)
    board = alight = ride
    src = Counter(t["walk_source"] for t in net["transfers"])
    return {
        "stations": len(net["stations"]),
        "line_stops": len(net["stops"]),
        "lines": len(net["lines"]),
        "patterns": len(pats),
        "edges": {"ride": ride, "board": board, "alight": alight, "transfer": 2 * len(net["transfers"]),
                  "total": ride + board + alight + 2 * len(net["transfers"])},
        "transfers": {"total": len(net["transfers"]), "manual_walk": src.get("manual", 0),
                      "estimated_walk": src.get("estimated", 0),
                      "by_kind": dict(Counter(t["kind"] for t in net["transfers"])),
                      "exits_gates_unset": sum(t["exits_gates"] is None for t in net["transfers"])},
        "estimated_run_patterns": sum(p["run_source"] == "estimated" for p in pats),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "site" / "data" / "network.json"))
    ap.add_argument("--today", default=dt.date.today().isoformat())
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    net = build(dt.date.fromisoformat(args.today))
    errors, warnings = validate(net)
    net["meta"]["warnings"] = warnings
    net["meta"]["stats"] = stats(net)
    print(json.dumps(net["meta"]["stats"], indent=1))
    for n in net["meta"]["notes"]:
        print("NOTE   ", n)
    for w in warnings:
        print("WARNING", w)
    for e in errors:
        print("ERROR  ", e)
    if errors:
        print(f"{len(errors)} validation error(s); {args.out} not written")
        sys.exit(1)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(net, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
