"""Real walking distances for station-to-station transfers (PLAN.md §3, §4e). MANUAL USE ONLY.

For every pair in overrides/transfers.json, asks the FOSSGIS OSRM foot profile
(routing.openstreetmap.de) for the walking distance and saves it to overrides/transfer-walks.json
(committed), with the date. Only pairs that are new, or whose stop coordinates changed, are queried.

FOSSGIS terms (https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/): at most one
request per second, no bulk use, a User-Agent that identifies the application. So: one tiny `table`
request per pair, >= 1.1 s apart, and this script refuses to run in CI.

Usage: python scripts/route_transfer_walks.py [--dry-run]
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.request

from gtfs_util import ROOT

OSRM = "https://routing.openstreetmap.de/routed-foot"
USER_AGENT = "kl-rail-planner-transfer-walks/1.0 (+https://github.com/Sshinyaaaa/train)"
REFERER = "https://sshinyaaaa.github.io/train/"
MIN_INTERVAL_S = 1.1
OUT = ROOT / "overrides" / "transfer-walks.json"


def pair_key(a, b):
    return "|".join(sorted((a, b)))


def coords_key(pa, pb, a, b):
    """Coordinates in the pair's sorted order, rounded, so a moved stop triggers a re-query."""
    (x, px), (y, py) = sorted(((a, pa), (b, pb)))
    return [round(px["lat"], 6), round(px["lon"], 6), round(py["lat"], 6), round(py["lon"], 6)]


def query(pa, pb):
    coords = f"{pa['lon']:.6f},{pa['lat']:.6f};{pb['lon']:.6f},{pb['lat']:.6f}"
    url = f"{OSRM}/table/v1/driving/{coords}?sources=0&destinations=1&annotations=distance"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Referer": REFERER})
    with urllib.request.urlopen(req, timeout=15) as res:
        data = json.load(res)
    if data.get("code") != "Ok":
        raise RuntimeError(data.get("code"))
    return data["distances"][0][0]


def main():
    if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
        sys.exit("route_transfer_walks.py is manual-only and must not run in CI.")
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="list what would be queried, send nothing")
    args = ap.parse_args()

    net = json.loads((ROOT / "site" / "data" / "network.json").read_text(encoding="utf-8"))
    stops = net["stops"]
    transfers = json.loads((ROOT / "overrides" / "transfers.json").read_text(encoding="utf-8"))
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"walks": {}}
    walks = dict(old.get("walks", {}))

    todo = []
    for t in transfers:
        a, b = t["from"], t["to"]
        if a not in stops or b not in stops:
            print(f"skip {a} - {b}: unknown stop")
            continue
        k, ck = pair_key(a, b), coords_key(stops[a], stops[b], a, b)
        if k in walks and walks[k].get("coords") == ck:
            continue
        todo.append((k, a, b, ck))
    print(f"{len(transfers)} transfers, {len(todo)} to query, {len(transfers) - len(todo)} cached")
    if args.dry_run or not todo:
        return

    last, failures = 0.0, 0
    today = dt.date.today().isoformat()
    for n, (k, a, b, ck) in enumerate(todo, 1):
        wait = last + MIN_INTERVAL_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        last = time.monotonic()
        try:
            d = query(stops[a], stops[b])
            failures = 0
        except Exception as e:   # the pair stays on the straight-line estimate
            failures += 1
            print(f"[{n}/{len(todo)}] {k}: failed ({e})", flush=True)
            # be gentle with a volunteer-run server: stop on rate limiting or repeated failures
            if "429" in str(e) or failures >= 2:
                print("Stopping: rate-limited or repeated failures. Re-run later; finished pairs are kept.", flush=True)
                return
            continue
        walks[k] = {"dist_m": round(d, 1), "coords": ck, "routed": today}
        print(f"[{n}/{len(todo)}] {k}: {d:.0f} m ({time.monotonic() - last:.1f} s)", flush=True)
        OUT.write_text(json.dumps({"_source": "FOSSGIS OSRM foot profile (routing.openstreetmap.de), "
                                   "OpenStreetMap data (ODbL). Written by scripts/route_transfer_walks.py.",
                                   "updated": today, "walks": dict(sorted(walks.items()))}, indent=1) + "\n",
                       encoding="utf-8")


if __name__ == "__main__":
    main()
