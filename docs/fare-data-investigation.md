# Fare data investigation (read-only)

Investigated on 2026-09-27. Nothing was built and no bulk data was downloaded. Rapid KL was checked
in the built-in browser, as a normal visitor. ERL and KTMB pages were fetched as HTML, and the KTMB
PDFs by header only (`HEAD`). Every fare below was returned live by the operator's own site on that
date.

## Summary

| Operator | Where the fare data lives | Machine-readable? | Date / version shown | Reuse terms found |
|---|---|---|---|---|
| Rapid KL (LRT, MRT, Monorail, BRT) | Per-trip JSON API behind the calculator; the fare tables are images | API: yes (JSON, one pair per request). Tables: images | Page says "Data as at 6 June 2026"; the API gives no version | None for the site or calculator |
| KLIA Ekspres / KLIA Transit | Fare tables in the HTML of the product pages | Yes, as an HTML table / text | No effective date on the page | Not checked beyond the pages (see open questions) |
| KTMB Komuter | 3 PDFs linked from the Komuter page (cash, cashless, concession) | Unknown; PDFs not opened | File `Last-Modified` 31 Jul 2024; filenames end in "Dec" | Only Komuter T&C and privacy PDFs linked |

## 1. Rapid KL: myrapid.com.my

### Where the calculator gets its data

- **Page:** <https://myrapid.com.my/bus-train/rapid-kl/integrated-fare-table/>. It's a WordPress page,
  behind Imperva bot protection. Plain HTTP clients get a 302 and then a 403. I didn't try to get
  around that; the page loaded normally in a browser.
- **Calculator:** an iframe to the separate app `https://jp-web.myrapid.com.my/#/fare_calculator`
  ("JP-WEB – Journey Planner", "Powered by PULSE"). It has two modes: "BRT, MRL, AGL, KJL, SPL, PYL,
  KGL" and "SAL Only – Shah Alam Line".
- **Station list:** `GET https://jp-web.myrapid.com.my/endpoint/geoservice/stations`. It returns
  GTFS-style JSON of about 166 KB, with routes, stops, lat/lon and `trip_list`. The stop IDs are the
  same as our Prasarana GTFS feed.
- **Fares:** `GET https://jp-web.myrapid.com.my/endpoint/geoservice/fares?agency=rapidkl&from=<stop_id>&to=<stop_id>`.
  This was found in the app's script (`calculateFares()` → `app.request.custom("GET","geoservice","fares",…)`).
  - **Response:** `{"fares":{"adult":"6.60","cash":"6.60","cashless":"5.60","consession":"3.20","fare":"6.60"}}`,
    about 90 bytes, with fares as strings in RM. The concession key is spelled `consession`.
  - **One origin–destination pair per request.** There's no bulk table or download behind the
    calculator.
  - **No version or date** in the response or its headers (Azure-hosted, `x-cache: CONFIG_NOCACHE`,
    weak ETag).
  - **CORS:** it sends `Access-Control-Allow-Origin: *`, so a browser page on another site could
    call it. But it's **undocumented and internal**, with no stated API terms. See open questions.
- **Fare tables:** four PNG images linked from the page:

  | Table | File |
  |---|---|
  | Cash/Token (~5 MB) | `wp-content/uploads/2022/10/INTEGRATED-FARE-TABLE_updated-06MAY21_Cash.png` |
  | Cashless (~4 MB) | `wp-content/uploads/2022/10/INTEGRATED-FARE-TABLE_updated-06MAY21_Cashless_1_small.png` |
  | Shah Alam Line, English (~1.6 MB) | `wp-content/uploads/2026/06/FA_Rapid-KL_Shah-Alam-Line_Fare-Table_ENG-scaled.png` |
  | Shah Alam Line, Malay (~1.6 MB) | `wp-content/uploads/2026/06/FA_Rapid-KL_Laluan-Shah-Alam_Jadual-Tambang_MY-scaled.png` |

  - Older 2018 tables are also on the page (`uploads/2020/12/12122018-FareTable-*.png`).
  - **Date mismatch:** the page says "Data as at 6 June 2026", but the cash and cashless filenames
    say **6 May 2021**. That predates the full Putrajaya Line. I didn't open the images, so I can't
    say which is right.

### Robots and terms

- **robots.txt:** allows everything except `/search/*`, `/?s=*`, `/wp-content/uploads/keys/*`,
  `/wp-content/uploads/tem*`, `/wp-content/uploads/f*`, `/wp-content/uploads/u*`, `/use*`, `/pr*`,
  `/ca*` and `/user-concession/`.
  - The fare-table page is allowed.
  - The fare images are under `/wp-content/uploads/2022/…` and `/2026/…`, which aren't disallowed.
  - I didn't find a robots.txt policy for the calculator host `jp-web.myrapid.com.my`, and didn't
    request it.
- **Terms of use:** there's no terms-of-use link on the page or in the site footer (the footer has a
  PDPA notice).
  - Search found <https://myrapid.com.my/rod/terms-condition/>, which is the **Rapid On-Demand bus
    service** T&C, not general website terms. It forbids copying or distributing the *Software*
    without permission, and says nothing about fare data.
  - Search also found a shop T&C (<https://shop.myrapid.com.my/terms-conditions/>), which I didn't
    read.
  - **Reuse permission for the fare data is unstated.**

### Payment types covered

Cash (token), cashless (Touch 'n Go) and concession all come from the API. The response also has
`adult` and `fare` fields, both equal to `cash` in every sample.

### Station coverage vs our network

The calculator's station list has 8 Rapid KL lines, with **exactly the same stop IDs** as our
network:

| Line | Stations (theirs = ours) |
|---|---|
| AG Ampang | 18 |
| PH Sri Petaling | 29 |
| KJ Kelana Jaya | 37 |
| MR Monorail | 11 |
| KGL Kajang | 29 |
| **PYL Putrajaya** | **36** |
| **SA Shah Alam** | **20** |
| BRT Sunway | 7 |

- **In-scope Rapid KL stations missing: none.** All 187 of our rapid stop IDs are present, with the
  same numbering gaps (e.g. no KG32, SP23, PY35).
- The list also includes the two ERL lines (`klia_transit`, 6 stations; `klia_ekspress`, 3 stations)
  for journey planning. I didn't test whether `agency=rapidkl` returns ERL fares.
- **No KTM stations.**

### Cross-line trips: one fare?

**Yes.** Every cross-line query returned a single fare, so a paid-area transfer is priced as one
journey:

| From → To | Lines | Cash | Cashless | Concession |
|---|---|---|---|---|
| Gombak `KJ1` → Kajang `KG35` | KJ + KGL | 6.60 | 5.60 | 3.20 |
| 16 Sierra `PY38` → KLCC `KJ10` | PYL + KJ | 5.90 | 5.00 | 2.90 |
| Bandar Utama `SA1` → KLCC `KJ10` | SA + KJ | 5.50 | 4.90 | 2.70 |
| USJ 7 `BRT7` → KLCC `KJ10` | BRT + KJ | 3.80 | 3.30 | 1.90 |
| Gombak `KJ1` → KLCC `KJ10` | KJ only | 3.50 | 3.00 | 1.70 |
| Bandar Utama `SA1` → Johan Setia `SA26` | SA only | 4.90 | 4.30 | 2.40 |
| Masjid Jamek `AG7` → KLCC `KJ10` | AG + KJ | 1.80 | 1.70 | 0.90 |
| Masjid Jamek `KJ13` → KLCC `KJ10` | KJ | 1.80 | 1.70 | 0.90 |
| Gombak `KJ1` → Gombak `KJ1` | — | 0.80 | 0.80 | 0.40 |

Notes:
- The two Masjid Jamek rows (AG7 and KJ13) give the same fare, so the fare seems to depend on the
  station, not which line's platform.
- The Shah Alam Line integrates with the rest of the network (SA1 → KJ10 is one fare), despite the
  calculator's separate "SAL Only" mode.

### 3 spot checks for the live calculator

Use the calculator's default (non-"SAL Only") mode:

1. **Gombak → Kajang (MRT Kajang Line):** cash RM6.60, cashless RM5.60, concession RM3.20.
2. **16 Sierra → KLCC:** cash RM5.90, cashless RM5.00, concession RM2.90.
3. **Bandar Utama → KLCC:** cash RM5.50, cashless RM4.90, concession RM2.70.

## 2. ERL: kliaekspres.com

Plain HTTP fetches worked for ERL.

### KLIA Ekspres

- **Where:** <https://www.kliaekspres.com/products-fares/klia-ekspres/>, as HTML text.
- **Fares:**

  | KL Sentral ↔ KLIA (T1 & T2) | Adult | Child (6–15) | Under 6 |
  |---|---|---|---|
  | Single | RM55.00 | RM25.00 | free |
  | Return | RM100.00 | RM45.00 | free |

  Up to 3 free children per adult.
- **Rules:** the ticket is valid 90 minutes from entry to exit. Buying online through the app or
  website gives 10% off.
- **Not interchangeable with KLIA Transit tickets:** "different ticketing systems".
- **Concession:** no concession table; the FAQ says to write in for disabled or senior fares.
- **Date:** none on the page.

### KLIA Transit

- **Where:** <https://www.kliaekspres.com/products-fares/klia-transit/>. A full station-to-station
  matrix in HTML, one way, adult / child (6–15). Children under 6 ride free.

  | | KL Sentral | Bandar Tasik Selatan | Putrajaya & Cyberjaya | Salak Tinggi | KLIA T1 |
  |---|---|---|---|---|---|
  | Bandar Tasik Selatan | 6.50 / 2.90 | | | | |
  | Putrajaya & Cyberjaya | 14.00 / 6.30 | 8.00 / 3.60 | | | |
  | Salak Tinggi | 18.30 / 8.20 | 12.40 / 5.60 | 4.70 / 2.10 | | |
  | KLIA T1 | 55.00 / 25.00 | 38.40 / 17.30 | 9.40 / 4.20 | 4.90 / 2.20 | |
  | KLIA T2 | 55.00 / 25.00 | 38.40 / 17.30 | 9.40 / 4.20 | 4.90 / 2.20 | 2.00 / 1.00 |

- **Return fare:** "twice the one-way fare, except KL Sentral–KLIA (T1 & T2) at RM100 (Adult)/RM45
  (Child)".
- **Concession** (<https://www.kliaekspres.com/products-fares/concession-ticket/>):
  - Category A (Malaysians: seniors 60+, registered disabled, students 16+ and higher-education):
    **one-way fare less 30%**, all sectors.
  - Category B (airline crew, airport staff, tourist guides): RM35 one way KL Sentral–KLIA, RM30
    one way BTS–KLIA.
- **Date:** none on the pages.
- **Coverage:** all 6 stations of our `erl-klia-transit` line, and the 3 of `erl-klia-ekspres`.

## 3. KTMB Komuter: ktmb.com.my

- **Where:** the Komuter page <https://www.ktmb.com.my/komuter.html> embeds three PDFs, in modals
  with no visible titles:

  | File | Size | `Last-Modified` |
  |---|---|---|
  | `pdf/TunaiDec.pdf` (*tunai* = cash) | 129,575 B | 31 Jul 2024 |
  | `pdf/TanpaTunaiDec.pdf` (*tanpa tunai* = cashless) | 391,464 B | 31 Jul 2024 |
  | `pdf/KonsesiDec.pdf` (*konsesi* = concession) | 119,911 B | 31 Jul 2024 |

  - `Last-Modified` is the server's file date, not necessarily the fares' effective date. "Dec" in
    the filenames suggests a December fare revision.
  - A third-party calculator (`ktm-fare-calculator.web.app`, not official) claims KTMB's official
    cash table is "effective 2 December 2015". **Unverified.**
- **Not opened:** per instructions, I requested headers only. So I haven't confirmed their format
  (a text table vs a scanned image), station coverage, or effective date.
- **robots.txt:** `Disallow:` is empty, so nothing is disallowed.
- **Terms:** only the Komuter T&C (`assets/pdf/2025/T&C Komuter Jun 2025.pdf`) and privacy PDFs are
  linked. I didn't read them.
- **Other:** there's no JSON, API or calculator on the Komuter page. KTMB's GTFS (which we use)
  has no `fare_attributes.txt` or `fare_rules.txt`.

### KTMB PDFs: contents (downloaded 2026-09-28)

The three PDFs were downloaded to `data/raw/ktmb-fares/` (gitignored), after your go-ahead.
**Nothing has been extracted into the project.**

| File | What it is | Format | Effective date on the document |
|---|---|---|---|
| `TunaiDec.pdf` | "Kadar Tambang Tiket Tunai / Cash Fare Ticket" | Vector PDF (Adobe Illustrator 15), **with a text layer**: `pdftotext` works, although some names are split by kerning (e.g. "KAJAN G", "KLAN G") | **2 December 2015** ("Kadar tambang KTM Komuter baharu berkuatkuasa mulai 2 Disember 2015") |
| `KonsesiDec.pdf` | "Concession Ticket (children, senior citizens, disabled and students)" | Vector PDF with a text layer, same layout | **2 December 2015** |
| `TanpaTunaiDec.pdf` | "Kadar Tambang Tiket Tanpa Tunai / Cashless Fare Ticket" | **Raster only**: one 5400×3508 RGB image, made with the IrfanView PDF plugin on 2018-08-16. There's no text layer, so it would need OCR or manual reading | **2 December 2015** (in the image title) |

**Layout:** in each file, one full station-by-station matrix, split into three route panels:
- Pel. Klang – Batu Caves
- Tg. Malim – Segambut
- Mid Valley – Seremban – Gemas

Every pair has a single fare, including pairs across panels (e.g. Pel. Klang → Seremban). So a KTM
trip with a change seems to be priced as one journey.

Sample, cash, from Pel. Klang: RM1.50 to Jln Kastam, RM1.90 to Kg Raja Uda. Concession from Pel.
Klang: RM0.80 and RM1.00 for the same pairs.

**Coverage vs our 57 in-scope KTM stations:**
- **55 match**, allowing for abbreviations and spelling: B. T. Selatan = Bdr Tasek Selatan, Kuala
  Kubu = Kuala Kubu Bharu, Mid Valley = Perhentian Midvalley, Pel. Klang = Pel Klang Sel,
  Tampin = Pulau Sebang/Tampin, Tanjung Malim = Tanjong Malim, Batu Kentonmen = Batu Kentomenn,
  and so on.
- **Missing: Abdullah Hukum (`52700`) and Kajang 2 (`20402`).** Neither appears in the text of the
  cash or concession PDFs. Both are also absent from the cashless image's station list.
- **Extra, out of scope:** Batang Melaka and Gemas.

**Currency caveat:** the tables are nearly 11 years old (2015). This investigation doesn't show
whether KTMB fares have changed since. The files' `Last-Modified` of 31 Jul 2024 only says when they
were uploaded.

## Open questions for review

1. **Rapid KL permission.** The fare API is undocumented, with no published terms, although it does
   allow cross-origin calls. Options:
   - Ask Prasarana for permission or an official fare feed. Their GTFS on data.gov.my has no fares.
   - Call it live, per trip, from the browser, with attribution.
   - Build a static table. That would need about 187² ≈ 35k requests, i.e. bulk collection, which
     needs a decision on permission first.
2. **Rapid KL image tables:** worth opening the 2021-named cash and cashless PNGs (~9 MB) to see
   whether they include the full Putrajaya Line, or are out of date despite "as at 6 June 2026"?
3. **KTMB:** OK to download the three fare PDFs (~620 KB total) to check format, coverage and
   effective date?
4. **ERL:** do you want the ERL site's terms checked before transcribing its HTML fare table? It's
   small and stable enough to maintain by hand.
5. **Cross-operator trips** (e.g. KTM + LRT, ERL + LRT) are separate fares per operator. ERL
   explicitly says Ekspres and Transit tickets aren't interchangeable. Summing per-operator fares
   seems right, but it isn't verified.

## Sources

- <https://myrapid.com.my/bus-train/rapid-kl/integrated-fare-table/> and
  <https://myrapid.com.my/robots.txt>
- <https://jp-web.myrapid.com.my/#/fare_calculator>, plus its endpoints `/endpoint/geoservice/stations`
  and `/endpoint/geoservice/fares`
- <https://myrapid.com.my/rod/terms-condition/> (Rapid On-Demand T&C)
- <https://www.kliaekspres.com/products-fares/klia-ekspres/>,
  <https://www.kliaekspres.com/products-fares/klia-transit/> and
  <https://www.kliaekspres.com/products-fares/concession-ticket/>
- <https://www.ktmb.com.my/komuter.html> and <https://www.ktmb.com.my/robots.txt>
