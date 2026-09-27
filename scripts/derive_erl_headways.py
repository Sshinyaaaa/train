"""Derive KLIA Transit headway bands and service hours from ERL's timetable PDF (PLAN.md §0, M5).

Input:  data/raw/erl/kt-train-schedule_effective-21-mar-2026.pdf (gitignored; from
        https://www.kliaekspres.com/media/rojb45mf/kt-train-schedule_effective-21-mar-2026.pdf)
Output: prints JSON for the `headways` and `service_hours` of overrides/lines/erl-klia-transit.json.

Each gap between consecutive departures from a direction's first station is classed as 15, 20 or
30 min (<= 17, <= 22, else), and consecutive gaps of one class become a band
[first departure, last departure, headway]. Needs `pdftotext` (poppler).
Usage: python scripts/derive_erl_headways.py
"""
import json
import re
import subprocess

from gtfs_util import RAW

PDF = RAW / "erl" / "kt-train-schedule_effective-21-mar-2026.pdf"
TIME = re.compile(r"\d\d:\d\d|-")


def secs(hhmm, after):
    h, m = map(int, hhmm.split(":"))
    t = h * 3600 + m * 60
    while after is not None and t < after - 12 * 3600:   # 00:xx after 23:xx -> 24:xx (GTFS style)
        t += 24 * 3600
    return t


def hhmm(t):
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}"


def pages(text):
    """-> {"weekday": rows, "weekend": rows}; each row = (dir0 tokens or None, dir1 tokens or None)."""
    out, cur = {}, None
    for line in text.splitlines():
        if "Monday - Friday" in line:
            cur = out.setdefault("weekday", [])
        elif "Saturday - Sunday" in line:
            cur = out.setdefault("weekend", [])
        elif cur is not None:
            toks = [(m.start(), m.group()) for m in TIME.finditer(line)]
            if len(toks) == 12:
                cur.append(([t for _, t in toks[:6]], [t for _, t in toks[6:]]))
            elif len(toks) == 6:   # only one direction on this row: decide by column position
                right = toks[0][0] > len(line) / 2
                cur.append((None, [t for _, t in toks]) if right else ([t for _, t in toks], None))
    return out


def departures(rows, d):
    col = [r[d][0] for r in rows if r[d] and r[d][0] != "-"]
    out, prev = [], None
    for c in col:
        prev = secs(c, prev)
        out.append(prev)
    return out


def bands(deps):
    cls = lambda g: 900 if g <= 17 * 60 else 1200 if g <= 22 * 60 else 1800
    out = []
    for a, b in zip(deps, deps[1:]):
        h = cls(b - a)
        if out and out[-1][2] == h:
            out[-1][1] = b
        else:
            out.append([a, b, h])
    return out


def main():
    text = subprocess.run(["pdftotext", "-layout", str(PDF), "-"], capture_output=True, text=True, check=True).stdout
    pg = pages(text)
    result = {}
    for d, first_col in ((0, "KL Sentral"), (1, "KLIA T2")):
        wk, we = departures(pg["weekday"], d), departures(pg["weekend"], d)
        result[d] = {
            "from": first_col,
            "service_hours": {"first": hhmm(min(wk[0], we[0])), "last": hhmm(max(wk[-1], we[-1]))},
            "headways": {"weekday": bands(wk), "saturday": bands(we), "sunday": bands(we)},
            "departures": {"weekday": len(wk), "weekend": len(we)},
        }
    # rows starting mid-line (e.g. the 05:00 Salak Tinggi -> KLIA T2 train) are reported, not modelled
    short = [r[0] for p in pg.values() for r in p if r[0] and r[0][0] == "-"]
    result["short_trips"] = short
    print(json.dumps(result, indent=1))
    for d in (0, 1):
        for day in ("weekday", "saturday"):
            print(d, day, [f"{hhmm(a)}-{hhmm(b)} {h // 60}m" for a, b, h in result[d]["headways"][day]])


if __name__ == "__main__":
    main()
