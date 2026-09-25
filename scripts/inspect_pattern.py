"""Print per-segment in-train times and dwells for rapid-rail template trips. Read-only.

Flags segments over 2x the median in-train segment time of the route (all its template trips)
and dwells over 60 s.
Usage: python scripts/inspect_pattern.py ROUTE_ID [FROM_STOP TO_STOP] [--service MonFri]
  e.g. python scripts/inspect_pattern.py KGL KG35 KG04
"""
import argparse
import statistics
import sys
from collections import defaultdict

from gtfs_util import RAW, hms, read, to_secs

FEED = RAW / "rapid_rail_kl"
DWELL_LIMIT = 60
SEG_FACTOR = 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("route")
    ap.add_argument("stops", nargs="*")
    ap.add_argument("--service", default="MonFri")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    trips = {t["trip_id"]: t for t in read(FEED, "trips.txt") if t["route_id"] == args.route}
    names = {s["stop_id"]: s["stop_name"].strip() for s in read(FEED, "stops.txt")}
    rows = defaultdict(list)
    for st in read(FEED, "stop_times.txt"):
        if st["trip_id"] in trips:
            rows[st["trip_id"]].append(st)
    segs_all = []
    for tid in rows:
        rows[tid].sort(key=lambda r: int(r["stop_sequence"]))
        r = rows[tid]
        segs_all += [to_secs(b["arrival_time"]) - to_secs(a["departure_time"]) for a, b in zip(r, r[1:])]
    median = statistics.median(segs_all)
    print(f"route {args.route}: {len(rows)} template trips; median in-train segment {median:.0f} s "
          f"(flag > {SEG_FACTOR * median:.0f} s); flag dwell > {DWELL_LIMIT} s")

    for tid, r in sorted(rows.items()):
        t = trips[tid]
        ids = [x["stop_id"] for x in r]
        if t["service_id"] != args.service:
            continue
        if args.stops:
            a, b = args.stops
            if a not in ids or b not in ids or ids.index(a) > ids.index(b):
                continue
            r = r[ids.index(a): ids.index(b) + 1]
        print(f"\ntrip {tid} (service {t['service_id']}, dir {t['direction_id']})")
        print(f"{'from':<26} {'to':<26} {'in-train':>8} {'dwell@to':>8}  flags")
        for a, b in zip(r, r[1:]):
            ride = to_secs(b["arrival_time"]) - to_secs(a["departure_time"])
            dwell = to_secs(b["departure_time"]) - to_secs(b["arrival_time"])
            flags = []
            if ride > SEG_FACTOR * median:
                flags.append(f"SEGMENT {ride / median:.1f}x median")
            if dwell > DWELL_LIMIT:
                flags.append("DWELL > 1 min")
            fa, fb = f"{a['stop_id']} {names[a['stop_id']]}", f"{b['stop_id']} {names[b['stop_id']]}"
            print(f"{fa[:26]:<26} {fb[:26]:<26} {ride:>7}s {dwell:>7}s  {', '.join(flags)}")
        total = to_secs(r[-1]["arrival_time"]) - to_secs(r[0]["departure_time"])
        ride_sum = sum(to_secs(b["arrival_time"]) - to_secs(a["departure_time"]) for a, b in zip(r, r[1:]))
        print(f"total {hms(total)} = in-train {ride_sum / 60:.1f} min + intermediate dwell {(total - ride_sum) / 60:.1f} min")


if __name__ == "__main__":
    main()
