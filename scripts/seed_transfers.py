"""One-off: seed overrides/transfers.json from docs/interchange-review-draft.md.

Takes every §1 row marked `interchange` or `connecting`, carries over walk_min / exits_gates
if the reviewer filled them, and appends links the candidate list cannot contain (map
connections > 400 m apart, and links to manual ERL lines). After seeding, edit
transfers.json by hand; re-running refuses to overwrite unless --force.
Usage: python scripts/seed_transfers.py [--force]
"""
import json
import re
import sys

from gtfs_util import ROOT

DRAFT = ROOT / "docs" / "interchange-review-draft.md"
OUT = ROOT / "overrides" / "transfers.json"

EKS, TRN = "erl-klia-ekspres", "erl-klia-transit"
# (from, to, kind, note) — map links not in the candidate list (review draft §2 + owner decision)
EXTRA = [
    ("rapid:AG5", "rapid:MR9", "connecting", "map grey link Sultan Ismail - Medan Tuanku (>400 m)"),
    ("rapid:SP5", "rapid:MR9", "connecting", "map grey link Sultan Ismail - Medan Tuanku (>400 m)"),
    # KL Sentral hub block: KTM, KJ, KLIA Ekspres, KLIA Transit drawn as one interchange
    ("ktmb:19100", f"{EKS}:kl_sentral", "interchange", "map KL Sentral hub"),
    ("ktmb:19100", f"{TRN}:kl_sentral", "interchange", "map KL Sentral hub"),
    ("rapid:KJ15", f"{EKS}:kl_sentral", "interchange", "map KL Sentral hub"),
    ("rapid:KJ15", f"{TRN}:kl_sentral", "interchange", "map KL Sentral hub"),
    (f"{EKS}:kl_sentral", f"{TRN}:kl_sentral", "interchange", "map KL Sentral hub"),
    # grey links into the hub block
    ("rapid:MR1", f"{EKS}:kl_sentral", "connecting", "map grey link Monorail - KL Sentral hub"),
    ("rapid:MR1", f"{TRN}:kl_sentral", "connecting", "map grey link Monorail - KL Sentral hub"),
    ("rapid:KG15", f"{EKS}:kl_sentral", "connecting", "map grey link Muzium Negara - KL Sentral hub"),
    ("rapid:KG15", f"{TRN}:kl_sentral", "connecting", "map grey link Muzium Negara - KL Sentral hub"),
    ("ktmb:19600", f"{TRN}:bandar_tasik_selatan", "interchange", "map BTS: KTM + KLIA Transit joined"),
    ("rapid:SP15", f"{TRN}:bandar_tasik_selatan", "connecting", "map BTS grey link"),
    ("rapid:PY41", f"{TRN}:putrajaya_sentral", "connecting", "map Putrajaya Sentral grey link"),
    (f"{EKS}:klia_t1", f"{TRN}:klia_t1", "interchange", "map KLIA T1"),
    (f"{EKS}:klia_t2", f"{TRN}:klia_t2", "interchange", "map KLIA T2"),
]

ROW = re.compile(r"^\|\s*(\d+)\s*\|\s*\d+\s*\|\s*`([^`]+)`[^|]*\|\s*`([^`]+)`[^|]*\|\s*(\w+)\s*\|[^|]*\|([^|]*)\|([^|]*)\|")


def ns(stop_id):
    return f"ktmb:{stop_id}" if stop_id.isdigit() else f"rapid:{stop_id}"


def parse_bool(v):
    v = v.strip().lower()
    return {"yes": True, "true": True, "y": True, "no": False, "false": False, "n": False}.get(v)


def seed(draft_text):
    out = []
    for line in draft_text.splitlines():
        m = ROW.match(line)
        if not m or m.group(4) not in ("interchange", "connecting"):
            continue
        num, a, b, kind, walk, gates = m.groups()
        walk = walk.strip()
        out.append({"from": ns(a), "to": ns(b), "kind": kind,
                    "walk_min": float(walk) if walk else None,
                    "exits_gates": parse_bool(gates), "note": f"draft #{num}"})
    for a, b, kind, note in EXTRA:
        out.append({"from": a, "to": b, "kind": kind, "walk_min": None, "exits_gates": None, "note": note})
    return out


def main():
    if OUT.exists() and "--force" not in sys.argv:
        sys.exit(f"{OUT} exists; edit it by hand, or pass --force to re-seed (discards edits)")
    rows = seed(DRAFT.read_text(encoding="utf-8"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(rows)} transfers to {OUT}")


if __name__ == "__main__":
    main()
