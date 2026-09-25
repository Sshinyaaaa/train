# Interchange review — DRAFT (not final)

Cross-check of `docs/interchange-candidates.md` against the reference map
`docs/reference/transit-map-2026-06.pdf` (Klang Valley Integrated Transit Map, one page).

**How the map was read.** The PDF has no text layer; it was rendered and read visually at ~2–5× zoom.
The legend defines two link types:

- **interchange** — "Stesen Pertukaran / Interchange Station": station markers drawn joined
  (touching circles or a white double-outlined bar between them), or inside the KL Sentral hub block.
- **connecting** — "Stesen Sambungan / Connecting Station": separate stations joined by a **grey line**.
- **none** — no link drawn between the two markers.

The map is schematic. Nothing below estimates distance or walk time from it; distances are the
haversine figures from the GTFS coordinates. `walk_min` and `exits_gates` are left blank for review.

Scope: all 8 rapid-rail routes; KTMB `KC05_KB18` and `KA15_KD19` only (see PLAN.md). All 57
candidate pairs involve at least one in-scope route on each side, so all 57 are listed. `#` is the
row number in `interchange-candidates.md`.

## 1. Candidate pairs vs map

| # | dist_m | stop A | stop B | map | notes | walk_min | exits_gates |
|---|---|---|---|---|---|---|---|
| 1 | 0 | `AG11` Chan Sow Lin | `SP11` Chan Sow Lin | interchange | AG/SP joined | | |
| 2 | 0 | `AG10` Pudu | `SP10` Pudu | interchange | | | |
| 3 | 0 | `AG9` Hang Tuah | `SP9` Hang Tuah | interchange | | | |
| 4 | 0 | `AG8` Plaza Rakyat | `SP8` Plaza Rakyat | interchange | | | |
| 5 | 0 | `AG7` Masjid Jamek | `SP7` Masjid Jamek | interchange | | | |
| 6 | 0 | `AG6` Bandaraya | `SP6` Bandaraya | interchange | | | |
| 7 | 0 | `AG5` Sultan Ismail | `SP5` Sultan Ismail | interchange | | | |
| 8 | 0 | `AG4` PWTC | `SP4` PWTC | interchange | | | |
| 9 | 0 | `AG3` Titiwangsa | `SP3` Titiwangsa | interchange | | | |
| 10 | 0 | `AG2` Sentul | `SP2` Sentul | interchange | | | |
| 11 | 0 | `AG1` Sentul Timur | `SP1` Sentul Timur | interchange | | | |
| 12 | 6 | `KJ17` Abdullah Hukum | `52700` Abdullah Hukum (KTM 2) | connecting | very short grey stub between markers; confirm | | |
| 13 | 19 | `SP15` Bandar Tasik Selatan | `19600` Bdr Tasek Selatan (KTM 1) | connecting | grey link; KTM + KLIA Transit drawn joined on the other side | | |
| 14 | 23 | `KG04` Kwasa Damansara | `PY01` Kwasa Damansara | interchange | | | |
| 15 | 24 | `KJ37` Putra Heights | `SP31` Putra Heights | interchange | | | |
| 16 | 32 | `KJ15` KL Sentral | `19100` KL Sentral (KTM 1+2) | interchange | both inside KL Sentral hub block | | |
| 17 | 33 | `KJ14` Pasar Seni | `KG16` Pasar Seni | interchange | | | |
| 18 | 39 | `SP16` Sungai Besi | `PY29` Sungai Besi | interchange | | | |
| 19 | 50 | `KJ31` USJ 7 | `BRT7` USJ7 | interchange | | | |
| 20 | 56 | `AG9` Hang Tuah | `MR4` Hang Tuah | interchange | | | |
| 21 | 56 | `SP9` Hang Tuah | `MR4` Hang Tuah | interchange | | | |
| 22 | 58 | `KG20` TRX | `PY23` TRX | interchange | | | |
| 23 | 66 | `KG35` Kajang | `20400` Kajang (KTM 1) | connecting | grey link | | |
| 24 | 69 | `AG13` Maluri | `KG22` Maluri | interchange | | | |
| 25 | 69 | `AG7` Masjid Jamek | `KJ13` Masjid Jamek | interchange | | | |
| 26 | 69 | `KJ13` Masjid Jamek | `SP7` Masjid Jamek | interchange | | | |
| 27 | 71 | `PY13` Kampung Batu | `50400` Kampung Batu (KTM 1) | connecting | grey link | | |
| 28 | 80 | `AG3` Titiwangsa | `MR11` Titiwangsa | interchange | | | |
| 29 | 80 | `SP3` Titiwangsa | `MR11` Titiwangsa | interchange | | | |
| 30 | 81 | `AG3` Titiwangsa | `PY17` Titiwangsa | interchange | | | |
| 31 | 81 | `SP3` Titiwangsa | `PY17` Titiwangsa | interchange | | | |
| 32 | 81 | `KG18A` Bukit Bintang | `MR6` Bukit Bintang | connecting | grey link | | |
| 33 | 85 | `KJ28` Subang Jaya | `53700` Subang Jaya (KTM 2) | connecting | grey link; KTM 2 + Skypark line drawn joined | | |
| 34 | 95 | `PY08` Sri Damansara Timur | `18400` Kepong Sentral (KTM 2) | connecting | grey link | | |
| 35 | 102 | `PY17` Titiwangsa | `MR11` Titiwangsa | interchange | | | |
| 36 | 115 | `AG11` Chan Sow Lin | `PY24` Chan Sow Lin | interchange | | | |
| 37 | 115 | `SP11` Chan Sow Lin | `PY24` Chan Sow Lin | interchange | | | |
| 38 | 116 | `BRT1` Sunway-Setia Jaya | `53600` Setia Jaya (KTM 2) | connecting | grey link | | |
| 39 | 116 | `BRT1` Sunway-Setia Jaya | `53500` Seri Setia (KTM 2) | none | | | |
| 40 | 160 | `AG6` Bandaraya | `18900` Bank Negara (KTM 1+2) | connecting | grey link | | |
| 41 | 160 | `SP6` Bandaraya | `18900` Bank Negara (KTM 1+2) | connecting | grey link | | |
| 42 | 183 | `PY04` Sungai Buloh | `18500` Sungai Buloh (KTM 2) | connecting | grey link | | |
| 43 | 221 | `KG09` Bandar Utama | `SA1` Bandar Utama | connecting | very short grey stub between markers; confirm | | |
| 44 | 231 | `AG8` Plaza Rakyat | `KG17` Merdeka | interchange | joined bar from AG8/SP8 down to KG17 | | |
| 45 | 231 | `SP8` Plaza Rakyat | `KG17` Merdeka | interchange | as above | | |
| 46 | 231 | `KJ27` Glenmarie | `SA7` Glenmarie 2 | connecting | very short grey stub between markers; confirm | | |
| 47 | 239 | `MR1` KL Sentral | `19100` KL Sentral (KTM 1+2) | connecting | grey link from hub block to MR1 | | |
| 48 | 246 | `KJ15` KL Sentral | `MR1` KL Sentral | connecting | grey link from hub block to MR1 | | |
| 49 | 294 | `KJ9` Ampang Park | `PY20` Ampang Park | connecting | grey link | | |
| 50 | 295 | `AG4` PWTC | `18800` Putra (KTM 1+2) | connecting | grey link | | |
| 51 | 295 | `SP4` PWTC | `18800` Putra (KTM 1+2) | connecting | grey link | | |
| 52 | 317 | `KJ9` Ampang Park | `PY21` Persiaran KLCC | none | | | |
| 53 | 325 | `KJ12` Dang Wangi | `MR8` Bukit Nanas | connecting | grey link | | |
| 54 | 344 | `KJ15` KL Sentral | `KG15` Muzium Negara | connecting | grey link from KG15 to hub block | | |
| 55 | 355 | `PY14` Kentonmen | `50300` Batu Kentomenn (KTM 1) | none | | | |
| 56 | 376 | `KG15` Muzium Negara | `19100` KL Sentral (KTM 1+2) | connecting | grey link from KG15 to hub block | | |
| 57 | 399 | `KJ14` Pasar Seni | `19000` Kuala Lumpur (KTM 1+2) | connecting | grey link | | |

Counts: 32 interchange, 22 connecting, 3 none, 0 unclear. Three connecting rows (12, 43, 46)
are very short grey stubs that are easy to confuse with the interchange style — flagged "confirm".

## 2. Map connections missing from the candidate list

| map link | stop_ids | why not a candidate |
|---|---|---|
| Sultan Ismail ↔ Medan Tuanku (connecting, grey) | `AG5`, `SP5` ↔ `MR9` | > 400 m apart in GTFS |
| KL Sentral hub: KLIA Ekspres, KLIA Transit, Skypark line | `19100`, `KJ15` ↔ (none) | ERL and Skypark line not in either feed |
| Bandar Tasik Selatan: KTM 1 ↔ KLIA Transit (interchange) | `19600` ↔ (none) | KLIA Transit not in feeds |
| Bandar Tasik Selatan: `SP15` ↔ KLIA Transit (connecting, same grey link as #13) | `SP15` ↔ (none) | KLIA Transit not in feeds |
| Putrajaya Sentral: `PY41` ↔ KLIA Transit (connecting, grey) | `PY41` ↔ (none) | KLIA Transit not in feeds |
| Subang Jaya: KTM 2 ↔ Skypark line (interchange) | `53700` ↔ (none) | Skypark line not in KTMB feed |
| KLIA T1 / KLIA T2: KLIA Ekspres ↔ KLIA Transit (interchange) | (none) | ERL not in feeds |
| KTM 1 ↔ KTM 2 at Putra, Bank Negara, Kuala Lumpur, KL Sentral (interchange) | `18800`, `18900`, `19000`, `19100` | already one shared stop_id in KTMB feed (not a pair) |

## 3. Map stations with no stop_id

- **Skypark line (map line 10):** Skypark Terminal (Sultan Abdul Aziz Shah Airport). Its other two
  stops, Subang Jaya and KL Sentral, exist as KTMB stops `53700` / `19100`, but no KTMB route serves
  them on that line.
- **KLIA Ekspres (line 6):** KL Sentral, KLIA T1, KLIA T2.
- **KLIA Transit (line 7):** KL Sentral, Bandar Tasik Selatan, Putrajaya Sentral, Salak Tinggi,
  KLIA T1, KLIA T2. (ERL's own site calls the Putrajaya stop "Putrajaya & Cyberjaya".)

All other map stations on lines 1–5, 8, 9, 11, 12 and B1 match a stop_id by name; spelling
differences only, e.g. map "Tanjung Malim" = `15200` TANJONG MALIM, "Batu Kentonmen" = `50300`
BATU KENTOMENN, "Pelabuhan Klang" = `55200` PEL KLANG SEL, "Mid Valley" = `19205` PERHENTIAN
MIDVALLEY, "Kinrara BK5" = `SP22` KINRARA.

## 4. In-scope stop_ids not on the map

None. Per-line station counts in the feed equal the map's: KTM 1 = 27, KTM 2 = 34, AG 18, SP 29,
KJ 37, MR 11, KG 29, PY 36, SA 20, BRT 7. The map's station numbers skip the same gaps as the feed's
stop_ids (e.g. no KG32, SP23, SP30, PY35).
