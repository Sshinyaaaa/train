# PLAN — Klang Valley rail route planner (static, GitHub Pages)

A static site. A Python build step turns the GTFS feeds and hand-written overrides into one
`site/data/network.json`, and the browser loads it and runs the router in JS. There is no backend.

Background facts come from `docs/data-audit.md`, `docs/interchange-candidates.md` and
`docs/interchange-review-draft.md`.

## 0. Scope

### Rapid-rail (Prasarana `rapid-rail-kl`)
All 8 routes: `AG`, `PH` (Sri Petaling), `KJ`, `KGL`, `PYL`, `MR`, `SA`, `BRT`.

### KTMB — route matching
The plan covers only the KTM services shown on the reference map
(`docs/reference/transit-map-2026-06.pdf`, not committed). Services are filtered by `route_id`,
never by coordinates.

| Map service | KTMB route_id | routes.txt short / long name | Match basis |
|---|---|---|---|
| 1 — Batu Caves – Pulau Sebang | `KC05_KB18` | Seremban Line / KTM Batu Caves - Pulau Sebang/Tampin | name; 27 stops = 27 map stations |
| 2 — Tanjung Malim – Pelabuhan Klang | `KA15_KD19` | Port Klang Line / KTM Tanjung Malim - Pelabuhan Klang | name; 34 stops = 34 map stations |
| 10 — KL Sentral – Terminal Skypark | **no match** | — | no KTMB route, trip or stop mentions Skypark |

Out of scope: `ETS`, `ERT`, `SH`, `ST`, `SS`, `100_47300`, `100_9000`. In-scope stops that other
routes also serve (e.g. `19100` KL Sentral, also served by ETS) are kept. Only the out-of-scope
*trips* are dropped.

**Skypark line: deferred (optional).** It isn't in the feed. If it's added later, it becomes a
manual line `overrides/lines/ktm-skypark.json` in the same format as the ERL lines.

### Manual lines (not in any feed): `overrides/lines/`
- **KLIA Ekspres** (`erl-klia-ekspres`) is its own non-stop line: KL Sentral → KLIA T1 → KLIA T2.
- **KLIA Transit** (`erl-klia-transit`) runs KL Sentral → Bandar Tasik Selatan → Putrajaya Sentral
  → Salak Tinggi → KLIA T1 → KLIA T2.

The station lists come from the reference map. The figures come from ERL's official site,
retrieved 2026-09-26. Each line file cites its sources.
- **Ekspres** (official): every 20 min all day; KL Sentral → KLIA T1 28 min; T1 → T2 3 min.
  First/last trains are 05:00/00:00 from KL Sentral and 04:55/00:00 from T2.
  <https://www.kliaekspres.com/products-fares/klia-ekspres/>
- **Transit** (official): 39 min from KLIA T2 to KL Sentral end to end. Trains run every 15 min at
  weekday peak and every 30 min off-peak and at weekends. First/last trains are 05:03/00:03 from
  KL Sentral and 05:18/00:30 from T2.
  <https://www.kliaekspres.com/products-fares/klia-transit/>
- **Transit inter-station times are ESTIMATED.** The official 39 min is split by straight-line
  distance between stations.
- **Station coordinates:** KL Sentral uses KTMB `19100`, BTS uses KTMB `19600`, and Putrajaya
  Sentral uses rapid `PY41`. Salak Tinggi, KLIA T1 and KLIA T2 come from their Wikipedia pages.
  KLIA T2 is given to 2 decimal places only, about 1 km precision.
- **Not modelled:**
  - Ekspres all-stop running after 23:00.
  - Transit's 15-min weekday peak. The peak hours aren't published, so weekdays use the
    30-min headway.

## 1. Repo layout

```
data/raw/                     GTFS zips + extracted feeds            (gitignored)
docs/reference/               RapidKL map PDF                        (gitignored)
overrides/
  transfers.json              all transfers (no transfers.txt in either feed)
  patterns.json               feed-gap fixes: stops inserted into a GTFS pattern
  display.json                map number + full name per line
  lines/erl-klia-ekspres.json
  lines/erl-klia-transit.json
scripts/
  gtfs_util.py                shared helpers (read, times, haversine)
  build_network.py            GTFS + overrides -> site/data/network.json (runs validate)
  validate.py                 section 5 checks; exit 1 on errors
  seed_transfers.py           one-off: reviewed draft table -> overrides/transfers.json
  audit_gtfs.py, audit_interchanges.py, inspect_pattern.py   (read-only reports)
site/
  index.html, app.js, style.css, router.js
  data/network.json           committed; last good build
tests/
  test_build.py               python -m unittest discover -s tests
  known-routes.json           written by hand (owner)
  router.test.mjs             node --test tests/*.test.mjs
  known-routes-lib.mjs, known-routes-report.mjs   evaluator + markdown table
docs/                         audits, review draft, TODO-manual.md
.github/workflows/pages.yml   (M3)
```

## 2. network.json schema

IDs are namespaced by source: `rapid:AG7`, `ktmb:19100`, `erl-klia-ekspres:klia_t1`.
- A **line-stop** is one line's platform at a place. Each ERL line has its own line-stops.
- A **station** groups one or more line-stops.

```jsonc
{
  "meta": {
    "built_at": "…", "today": "2026-09-26",
    "config": { "gate_penalty_min": 5,
                "walk": { "detour_factor": 1.4, "speed_kmh": 4.5,
                          "overhead_min": { "interchange": 1, "connecting": 2 } },
                "ktmb_routes": ["KC05_KB18", "KA15_KD19"] },
    "gate_penalty_min": 5,
    "feeds": { "ktmb": { "calendar_end": "2026-10-10", "days_left": 14 }, "rapid_rail_kl": { … } },
    "notes": ["…"], "warnings": ["…"], "stats": { … }
  },
  "stations": { "st:rapid:AG7": { "name": "MASJID JAMEK", "lat": …, "lon": …,
                                   "stops": ["rapid:AG7", "rapid:KJ13", "rapid:SP7"] } },
  "stops":    { "rapid:AG7": { "name": "MASJID JAMEK", "lat": …, "lon": …,
                               "lines": ["rapid:AG"], "station": "st:rapid:AG7" } },
  "lines": {
    "rapid:KJ": { "name": "LRT Kelana Jaya Line", "short": "KJL", "color": "#D50032", "source": "gtfs",
      "patterns": [ { "dir": 0, "stops": ["rapid:KJ1", "…"],
                      "run_sec": [0, …],              // cumulative seconds from first stop
                      "run_source": "gtfs",           // gtfs | official | estimated
                      "headways": { "weekday": [[start_sec, end_sec, headway_sec], …],
                                    "saturday": […], "sunday": […] },
                      "headway_source": "gtfs_frequencies" } ] } // | gtfs_typical | official
  },
  "transfers": [ { "from": "rapid:KJ28", "to": "ktmb:53700", "kind": "connecting",
                   "walk_min": 4, "walk_source": "estimated", "dist_m": 85,
                   "exits_gates": null, "note": "draft #33" } ]
}
```

How the fields are built:
- **Patterns:** one per (line, direction), using the longest stop sequence. Trips that skip or
  reorder stops are left out of the run times and listed in `meta.notes`. The KTMB feed has 2 such
  trips on `KA15_KD19`: they run the opposite way under the same `direction_id`.
- **Rapid-rail:**
  - The feed is frequency-based. `stop_times` gives inter-station travel times only; `run_sec` is
    the median arrival-to-arrival time per segment.
  - Headways come from the `frequencies.txt` windows.
- **KTMB:**
  - `run_sec` is the median time per segment over that pattern's trips.
  - Headways are the typical value per time band: the median gap between departures at the
    most-served stop. Bands are 00–06, 06–09, 09–17, 17–20 and 20–end, clipped to the first and
    last departure.
- **Day types:** `weekday` / `saturday` / `sunday`, taken from the calendar weekday flags only.
  Calendar start/end dates and `calendar_dates` are ignored, so a lapsed calendar never drops
  service.
- **GTFS times:** parsed with no 24 h wrap (`25:56:00` = 93360).
- **Ignored feed quirks:**
  - the `route_id` column in rapid `stop_times.txt`
  - the `category`, `route_id` and `geometry` columns in rapid `stops.txt`
  - unpadded `H:MM:SS` times
- **Feed gap patched by override:** in the KTMB feed, no southbound (`direction_id 1`)
  `KA15_KD19` trip stops at Kuala Kubu Bharu (`16100`) or Rasa (`16300`), while 33 northbound trips
  do. `overrides/patterns.json` inserts both stops into the southbound pattern after Tanjung Malim.
  - Their segment times are mirrored from the northbound pattern.
  - The pattern's `estimated_segments` marks those segments, and the router flags any ride through
    them as `estimated_run`.
  - Side effect: every modelled southbound train now stops there, 60 s longer than the feed's
    non-stop Tanjung Malim → Batang Kali segment.
- **Stations:** union-find over `interchange` transfers, plus KTMB stops already shared by both KTM
  lines. The station name joins the distinct stop names with " / ", treating sponsor suffixes as
  the same name, and prefers the manual line's name when there is one.

## 3. Overrides formats

`overrides/transfers.json` is a list with one object per undirected pair:
```json
{ "from": "rapid:AG7", "to": "rapid:KJ13", "kind": "interchange",
  "walk_min": null, "exits_gates": null, "note": "draft #25" }
```
- `kind` is `interchange` (the map draws the same station) or `connecting` (a grey link on the map).
- **walk_min:** a number here is **manual and always wins**. If it's `null`, the build estimates it:
  `ceil(straight-line m × 1.4 ÷ 75 m/min + overhead)`, where 75 m/min is 4.5 km/h and the overhead
  is 1 min for interchange and 2 min for connecting. The result is marked
  `"walk_source": "estimated"` with `dist_m`.
- **exits_gates:** `true` adds `gate_penalty_min` (5, configurable in `build_network.py` `CONFIG`).
  `null` means unknown and is treated as no penalty, with a warning.
- **Seeding:** `seed_transfers.py` produced 70 pairs:
  - the 54 rows marked `interchange` or `connecting` in the review draft §1
  - Sultan Ismail (`AG5`, `SP5`) ↔ Medan Tuanku (`MR9`), connecting
  - 14 ERL links (KL Sentral hub, BTS, Putrajaya Sentral, KLIA T1/T2)

  `transfers.json` is now the source of truth; edit it by hand.

`overrides/patterns.json`: a list of stop insertions into GTFS patterns, for feed gaps.
```json
{ "line": "ktmb:KA15_KD19", "dir": 1, "insert_after": "ktmb:15200",
  "stops": ["ktmb:16100", "ktmb:16300"], "run_from": "opposite_direction", "note": "Feed gap: …" }
```
- New segment times come from the opposite-direction pattern. The build errors if the stops aren't
  adjacent there.
- The segments are listed in `estimated_segments`, and the note is kept in `patterns[*].overrides`.

`overrides/lines/<id>.json`:
- a line `id` and `name`, plus `sources`
- `stops`, each with `lat`/`lon` + `coord_source`, or `coord_from: "<existing stop id>"`
- `patterns`, each with `dir`, `stops`, `run_sec` + `run_source`, and `headways` + `headway_source`
- `run_sec: null` with `run_estimate: {"method": "distance_split", "total_sec": N}` makes the build
  split N by straight-line distance and mark the pattern `run_source: "estimated"`. A manual
  `run_sec` always wins.

## 4. Algorithm (MVP, `site/router.js`)

The query is (origin station, destination station, day type, departure time). There is no
timetable; waiting is estimated.

- **Nodes:** line-stops, and (line, direction, line-stop) pattern nodes.
- **Edges:**
  - *Board*: line-stop → pattern node. Cost = headway / 2, using the band that contains the
    query time; no band means the line isn't running.
  - *Ride*: consecutive pattern nodes. Cost = the `run_sec` difference.
  - *Alight*: pattern node → line-stop, cost 0.
  - *Transfer*: line-stop ↔ line-stop. Cost = `walk_min`, plus `gate_penalty_min` if
    `exits_gates` is true.
  - KTM 1 ↔ KTM 2 at a shared stop (e.g. `ktmb:19100`) needs no transfer edge. Alighting and
    re-boarding costs only the new wait.
- **Origin/destination:** every line-stop of the station, at cost 0.
- **No station twice:** a route may not return to a station it has left. Stations passed through
  on a train count. This is checked per label on its own path.
- **Routes returned:**
  - *Fastest*: Dijkstra on minutes.
  - *Fewest transfers*: Dijkstra on (boardings, minutes).

  Both are returned, deduplicated.
- **Two times per route:**
  - `journey_min`: from boarding the first train to arrival. It includes ride time, transfer walks,
    gate penalties and the waits at *transfers*.
  - `expected_min`: `journey_min` plus the initial wait (headway / 2 at the first boarding).
  - The UI shows both. Tests assert against `journey_min`.
  - Dijkstra minimises `expected_min`, so the initial wait still affects which line is chosen.
- **Waits shown in the UI:**
  - "~`journey_min` + up to X min wait", where X = `initial_headway_min`, the full headway at the
    first boarding (worst case).
  - Transfer waits (`transfer_wait_min`, half-headway averages) are shown separately when there
    are any.
  - `expected_min` still uses half-headway averages throughout.
- **Line labels:** the UI never shows raw GTFS codes. `overrides/display.json` gives each line its
  reference-map number and full name, e.g. "12 · MRT Putrajaya Line" or "B1 · BRT Sunway". The build
  copies them to `lines[*].display`, and validation errors if any are missing. The same file
  supplies the approximate ERL colours (`color_source: "display_approx"`).
- **Output:**
  - Legs are line, from, to, stop count, ride time, and wait.
  - Transfers show walk time, and an "exits fare gates" flag when `exits_gates` is true.
  - **Every leg or transfer that uses an estimate is flagged**: `run_source: "estimated"`,
    `walk_source: "estimated"`, or `headway_source: "gtfs_typical"` (KTM waits are averages).
- **Known simplifications:**
  - The headway band is looked up at each boarding using the query time plus elapsed journey
    time. There is no actual timetable, so waits are averages.
  - AG/SP share track from Sentul Timur to Chan Sow Lin but aren't merged, so the wait there is
    overestimated.

## 5. Validation checks (`scripts/validate.py`, run by the build)

Errors: the build writes nothing, and CI doesn't deploy. Warnings: stored in `meta.warnings`,
and the site shows a banner.

- **Error:** a pattern or transfer references an unknown stop, or a stop isn't in exactly one
  station.
- **Error:** a KTMB line is outside `{KC05_KB18, KA15_KD19}`.
- **Error:** incomplete `run_sec`, or a segment that is ≤ 0 s or > 30 min.
- **Error:** a pattern has no headway for some day type.
- **Coverage (error):** station count per line differs from the reference map. The counts are
  hardcoded (KTM 1 27, KTM 2 34, AG 18, SP 29, KJ 37, MR 11, KG 29, PY 36, SA 20, BRT 7, Ekspres 3,
  Transit 6). The map is used only for this.
- **Warning:** stations unreachable from KL Sentral.
- **Warning:** transfers with an estimated walk time, transfers with `exits_gates` unset, and lines
  with estimated run times.
- **Warning (stale):** a feed's calendar has ended, or ends within 14 days. Service is kept anyway.
  The CLI recomputes this against the current date, so the check is right at deploy time.

## 6. Tests

- `tests/test_build.py` (unittest):
  - times past midnight
  - a lapsed calendar keeps service
  - the walk estimate formula
  - the distance split
  - station naming
  - each validation rule
  - manual walk values win
  - with real feeds, if `data/raw/` is present: no errors, KTMB route filter, a lapsed KTMB still
    has service, and Transit estimates sum to 39 min
- `tests/known-routes.json` holds the owner's expected values:
  ```json
  [ { "from": "Gombak", "to": "KLCC", "from_station": "st:rapid:KJ1", "to_station": "st:rapid:KJ10",
      "source": "gemini, unverified (not from Maps routing)", "verified": false,
      "expect": { "max_minutes": 29, "max_transfers": 0 },
      "reference": { "minutes": 23, "transfers": 0, "lines": ["Kelana Jaya Line"] } } ]
  ```
  - `from_station` / `to_station` are station IDs, so names like "Kajang" and "KL Sentral" can't
    match the wrong station.
  - **`verified`**: only `verified: true` cases can fail the test run. For `verified: false`, a
    miss is **reported as a warning**. All 4 current cases are `false`: their reference values came
    from Gemini, which cannot query Google Maps routing. The owner will replace them with checked
    values.
  - `expect` is what gets checked:
    - `max_minutes` is ⌈reference × 1.25⌉, checked against the router's **`journey_min`** (not
      `expected_min`).
    - `max_transfers` is the reference count, +1 if the route uses a `connecting` transfer.
  - `reference` is informational only.
  - `day` / `time` are optional per case. The runner default is **weekday 11:00**.
  - `"status": "disputed"` plus a `dispute` field records a known disagreement. On its own it
    doesn't change the pass/fail rule; that follows `verified`.
    - Current case: Kajang → Kwasa Damansara. The GTFS gives 88.1 min, and the 70-min comparison
      figure is unverified.
    - `scripts/inspect_pattern.py` prints per-segment in-train times and dwells for any rapid
      route.
- `tests/router.test.mjs` runs `router.js` against `site/data/network.json`
  (`node --test tests/*.test.mjs`). Node 22 doesn't accept a directory argument.
  - `max_minutes` is checked against the **fastest** route's `journey_min`.
  - `max_transfers` is checked against the **fewest-transfers** route.
  - Unverified misses are printed as `WARNING` diagnostics.
  - Structural tests cover journey vs expected, transfer waits, estimate flags, KTM shared-stop
    changes, no service outside hours, and bands past 24:00.
  - No station twice: a synthetic network whose only path revisits a station returns no route.
    Real station pairs are also swept to check no returned route revisits one.
- `node tests/known-routes-report.mjs` prints a markdown table of every case.

## 7. GitHub Action (`.github/workflows/pages.yml`, M3)

**Triggers:** push to `main`, weekly (Monday 02:17 UTC), and manual dispatch. **No secrets:** the
feeds are public and Pages uses the built-in OIDC token.

The Action:
1. Downloads both feeds from the data.gov.my GTFS static API. No key is documented.
   - `https://api.data.gov.my/gtfs-static/ktmb`
   - `https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl`

   It unzips them into `data/raw/`, skipping `__MACOSX/`.
2. Runs `build_network.py`, which also validates, into a temp file, then copies the result to
   `site/data/network.json`.
3. **If the fetch or the build fails:** restores the committed `site/data/network.json` (the last
   good data), deletes `data/raw/` so the real-feed tests skip, and emits a `::warning::`
   annotation.
4. Runs `validate.py` on the final `network.json`, recomputing staleness against today. Stale
   feeds become `::warning::` annotations, and the Action **still deploys**.
5. Runs the Python and Node tests. **A test failure fails the run and nothing deploys.** The live
   site keeps the previous deployment.
6. Deploys `site/` with `configure-pages` → `upload-pages-artifact` → `deploy-pages`.

A freshly built `network.json` is deployed but not committed back, so the committed copy is the
fallback. To update it, rebuild locally and commit.

## 8. Milestones

1. **M0 – data plumbing — DONE:**
   - `gtfs_util.py`, `build_network.py`, `validate.py`, `test_build.py`, `seed_transfers.py`
   - the ERL line files
   - the first `network.json`
2. **M1 – transfers (owner):** confirm the review draft rows, and fill in manual `walk_min` /
   `exits_gates` in `transfers.json`. Estimates cover the gaps until then.
3. **M2 – router + UI — DONE:**
   - `router.js` (both route types, estimate flags, fare-gate flag)
   - a minimal page with station pickers, day type and time
   - `router.test.mjs` with `known-routes.json`
4. **M3 – deploy — DONE:** the Pages Action described in section 7.
5. **M4 – timetable-aware KTM:** real departures (next train after arrival) instead of headway / 2,
   respecting `calendar_dates`.
6. **Later / optional:**
   - Skypark line
   - Ekspres all-stop after 23:00
   - Transit peak headway once the peak hours are known
   - merging the AG/SP shared trunk
