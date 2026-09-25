"""Small helpers shared by the audit and build scripts."""
import csv
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"


def read(feed_dir, name):
    """Rows of a GTFS file as dicts, or None if the file is absent. Strips a UTF-8 BOM."""
    path = Path(feed_dir) / name
    if not path.exists():
        return None
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def to_secs(t):
    """GTFS time to seconds since service-day midnight. No 24 h wrap: '25:56:00' -> 93360."""
    h, m, s = (int(x) for x in t.strip().split(":"))
    return h * 3600 + m * 60 + s


def hms(secs):
    return f"{secs // 3600:02d}:{secs % 3600 // 60:02d}:{secs % 60:02d}"


def haversine_m(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))
