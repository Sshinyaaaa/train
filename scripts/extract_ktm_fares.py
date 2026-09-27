"""Extract KTM Komuter fare matrices from KTMB's 2015 fare-table PDFs (PLAN.md §4d).

Inputs (gitignored, from https://www.ktmb.com.my/komuter.html):
  data/raw/ktmb-fares/TunaiDec.pdf     cash       (vector PDF, text layer)
  data/raw/ktmb-fares/KonsesiDec.pdf   concession (vector PDF, text layer)
The cashless table (TanpaTunaiDec.pdf) is an image only; its values come from
overrides/fares/ktm-cashless-transcribed.json (transcribed from the image, unverified).

Rows are read with `pdftotext -table` (one matrix row per line) and placed by the column of their
diagonal "-", because the row labels come out separately. Station order is the tables' column-header
order, checked against the header images. Writes overrides/fares/ktm.json. Needs `pdftotext`.
Usage: python scripts/extract_ktm_fares.py
"""
import json
import re
import subprocess

from gtfs_util import RAW, ROOT

SRC = RAW / "ktmb-fares"
OUT = ROOT / "overrides" / "fares" / "ktm.json"
CASHLESS = ROOT / "overrides" / "fares" / "ktm-cashless-transcribed.json"

# Column order of all three tables (3 route panels), with our KTMB stop ids; None = out of scope.
STATIONS = [
    ("PEL. KLANG", "55200"), ("JLN.KASTAM", "55100"), ("KG.RAJA UDA", "55000"), ("TELUK GADONG", "54900"),
    ("TELUK PULAI", "54800"), ("KLANG", "54700"), ("BUKIT BADAK", "54500"), ("PADANG JAWA", "54400"),
    ("SHAH ALAM", "54200"), ("BATU TIGA", "53800"), ("SUBANG JAYA", "53700"), ("SETIA JAYA", "53600"),
    ("SERI SETIA", "53500"), ("KG DATO HARUN", "53400"), ("JLN.TEMPLER", "53100"), ("PETALING", "53000"),
    ("PANTAI DALAM", "52900"), ("ANGKASAPURI", "52800"), ("KL SENTRAL", "19100"), ("KUALA LUMPUR", "19000"),
    ("BANK NEGARA", "18900"), ("PUTRA", "18800"), ("SENTUL", "50000"), ("BATU KENTONMEN", "50300"),
    ("KG BATU", "50400"), ("TAMAN WAHYU", "50500"), ("BATU CAVES", "50600"),
    ("TANJUNG MALIM", "15200"), ("KUALA KUBU", "16100"), ("RASA", "16300"), ("BATANG KALI", "16500"),
    ("SERENDAH", "17300"), ("RAWANG", "17800"), ("KUANG", "18100"), ("SUNGAI BULOH", "18500"),
    ("KEPONG SENTRAL", "18400"), ("KEPONG", "18600"), ("SEGAMBUT", "18700"),
    ("MID VALLEY", "19205"), ("SEPUTEH", "19300"), ("SALAK SELATAN", "19400"), ("B. T. SELATAN", "19600"),
    ("SERDANG", "19900"), ("KAJANG", "20400"), ("UKM", "20500"), ("BANGI", "20900"), ("BATANG BENAR", "21300"),
    ("NILAI", "21500"), ("LABU", "22000"), ("TIROI", "22400"), ("SEREMBAN", "22700"), ("SENAWANG", "22900"),
    ("SUNGAI GADUT", "23100"), ("REMBAU", "23900"), ("TAMPIN", "25100"), ("BTG MELAKA", None), ("GEMAS", None),
]
N = len(STATIONS)
TOKEN = re.compile(r"\d+\.\d\d|(?<![A-Z.])-(?![A-Z])")


def matrix_from_pdf(path):
    """pdftotext -table keeps each matrix row on one line (-layout splits some concession rows).
    Row labels come out separately, so each row is placed by the column of its diagonal "-"."""
    text = subprocess.run(["pdftotext", "-table", str(path), "-"], capture_output=True, text=True, check=True).stdout
    rows = [r for r in (TOKEN.findall(line) for line in text.splitlines()) if len(r) == N]
    if len(rows) != N:
        raise SystemExit(f"{path.name}: expected {N} rows of {N} values, found {len(rows)}")
    m = [None] * N
    for r in rows:
        diag = [i for i, v in enumerate(r) if v == "-"]
        if len(diag) != 1 or m[diag[0]] is not None:
            raise SystemExit(f"{path.name}: row without a unique diagonal: {r[:6]}")
        m[diag[0]] = [None if v == "-" else float(v) for v in r]
    return m


def check(m, name):
    asym = [(STATIONS[i][0], STATIONS[j][0], m[i][j], m[j][i]) for i in range(N) for j in range(i + 1, N) if m[i][j] != m[j][i]]
    return {"table": name, "asymmetric_pairs": len(asym), "examples": asym[:5]}


def pairs(m, only_in_scope=True):
    out = []
    for i in range(N):
        for j in range(i + 1, N):
            a, b = STATIONS[i][1], STATIONS[j][1]
            if only_in_scope and (a is None or b is None):
                continue
            out.append([a, b, m[i][j]])
    return out


def main():
    cash = matrix_from_pdf(SRC / "TunaiDec.pdf")
    conc = matrix_from_pdf(SRC / "KonsesiDec.pdf")
    checks = [check(cash, "cash"), check(conc, "concession")]
    ids = {name: sid for name, sid in STATIONS}
    inconsistent = [[ids[a], ids[b], ab, ba] for a, b, ab, ba in checks[1]["examples"] if ids[a] and ids[b]]
    top = max((cash[i][j], STATIONS[i][0], STATIONS[j][0]) for i in range(N) for j in range(N) if i != j)
    top_in = max((cash[i][j], STATIONS[i][0], STATIONS[j][0]) for i in range(N) for j in range(N)
                 if i != j and STATIONS[i][1] and STATIONS[j][1])
    tables = {
        "cash": {"status": "extracted from PDF text layer", "source": "https://www.ktmb.com.my/pdf/TunaiDec.pdf",
                 "pairs": pairs(cash)},
        "concession": {"status": "extracted from PDF text layer", "source": "https://www.ktmb.com.my/pdf/KonsesiDec.pdf",
                       "applies_to": "children, senior citizens, disabled persons and students (per the 2015 table title)",
                       "inconsistent_in_source": {"note": "[a, b, fare a->b, fare b->a]; pairs uses a->b", "pairs": inconsistent},
                       "pairs": pairs(conc)},
    }
    if CASHLESS.exists():
        cl = json.loads(CASHLESS.read_text(encoding="utf-8"))
        tables["cashless"] = {"status": "transcribed from image, unverified", "source": "https://www.ktmb.com.my/pdf/TanpaTunaiDec.pdf",
                              "pairs": cl["pairs"]}
    doc = {
        "operator": "KTMB (KTM Komuter)",
        "effective": "2015-12-02",
        "retrieved": "2026-09-28",
        "currency": "MYR",
        "status": "unconfirmed: KTMB fare table effective 2 Dec 2015, may be outdated",
        "fare_type": "Adult one-way (cash / cashless) and concession, as printed in the 2015 tables",
        "symmetric": True,
        "not_in_tables": ["20402 (Kajang 2)", "52700 (Abdullah Hukum)"],
        "checks": checks,
        "max_fare_2015_table": {"any": top, "in_scope": top_in},
        "tables": tables,
    }
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"checks": checks, "max": doc["max_fare_2015_table"],
                      "pairs": {k: len(v["pairs"]) for k, v in tables.items()}}, indent=1))


if __name__ == "__main__":
    main()
