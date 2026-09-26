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
- **Transit inter-station times are official.** They are the differences between consecutive
  stations in the per-station first/last train table at
  <https://www.kliaekspres.com/products-fares/concession-ticket/> (retrieved 2026-09-26; the
  table's text was checked in the raw HTML).
  - KL Sentral → KLIA T2: 7, 12, 10, 7, 3 min.
  - KLIA T2 → KL Sentral: 4, 7, 9, 11, 8 min.
  - First and last trains give identical gaps.
- **Transit service hours**, from the same table: KL Sentral 05:03–24:03 and KLIA T2 05:18–24:30,
  in GTFS 24:00+ notation.
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
- **Service hours:** a pattern can have `service_hours: [first, last]`, the departures from its
  first stop in seconds with 24:00+ allowed.
  - It can be boarded at stop *i* only between `first + run_sec[i]` and `last + run_sec[i]`. An
    early-morning query is also tried as +24 h.
  - Its headway is looked up at the matching first-stop time.
  - Patterns without service hours are limited only by their headway bands.
  - `linesNotRunning()` lists lines that can't be boarded at the origin at the query time, and
    the UI uses it to explain a "no route" result.
- **Known simplifications:**
  - Waits are average-based, so a query just before the last train still shows "wait up to <full
    headway>".
  - The headway band is looked up at each boarding using the query time plus elapsed journey
    time. There is no actual timetable, so waits are averages.
  - AG/SP share track from Sentul Timur to Chan Sow Lin but aren't merged, so the wait there is
    overestimated.

## 4b. Places and access legs (M4)

**Endpoints.** Origin and destination can each be:
- a **station** (`{type: "station", id}`), as before
- **"Current location"**, from the browser Geolocation API. It's requested only when the user taps
  that option.
- a **typed place**, geocoded with Photon

A place is `{type: "place", lat, lon, name}`.

**Geocoding: Photon** (`https://photon.komoot.io/api`, OSM data, no API key).
- **Request:** `q=<typed text>&limit=5&lang=en&bbox=101.2,2.6,102.0,3.4`, the Klang Valley box
  from the audit, as minLon,minLat,maxLon,maxLat.
- **Rate:** debounced 350 ms, with at least 3 characters. This keeps usage within Photon's
  fair-use policy.
- **Privacy:** only the typed text is sent, plus the fixed bbox. No location bias parameters.
  **Current location never leaves the browser.** It's only used by the in-page router, and it isn't
  stored in `localStorage`.
- **Attribution:** "Search by Photon · © OpenStreetMap contributors", linked, shown in the place
  results and in the footer.

**Access legs.** These are computed in `router.js`, with no network I/O:
- **Distance to a station:** the minimum straight-line distance to any of its line-stops.
- **Walk time:** `distance × 1.3 / 75 m/min` (1.3 detour at 4.5 km/h), without the fixed transfer
  overhead.
- **Candidates:** the 4 nearest stations within the **max walk** setting (default 1 km; see §4c)
  that are served by an enabled mode. If none is in range, the nearest 2 enabled stations are used
  and marked `far`.
- **Virtual start and end:**
  - Every line-stop of each origin candidate is seeded with its own access walk.
  - At a destination candidate's line-stop, an egress edge leads to a virtual `END` state.
  - Dijkstra picks the best combination.
  - A place-to-place route needs at least one train. The result also carries `direct_walk_min`,
    so the UI can say "or walk ~N min" when that's quicker.
- **Far legs:**
  - They are costed as walking, only for choosing between candidates.
  - They are **excluded from `journey_min` / `expected_min`**.
  - The UI shows "X km to [station], consider e-hailing/bus" instead of a walk time.
  - Times are labelled as excluding that leg.

**Output:**
- The first and last legs are `{type: "access" | "egress", place, stop, dist_m, walk_min, far}`.
- They're shown as "Walk 800 m (~12 min) to Kuchai".

**Failures (graceful):**
- **Location denied, unavailable or timed out:** show a message, and the input stays usable for
  stations and places.
- **Geocoder down or errored:** show "Place search unavailable", and station search keeps working.
- **Nothing matches:** show "No matching stations or places".

## 4c. Route filters (M4.1)

**Modes.**
- Each line in `overrides/display.json` has a `mode`: one of `LRT`, `MRT`, `Monorail`, `BRT`,
  `KTM`, `ERL`. The build copies it to `lines[*].display.mode`.
- Validation errors if any line has no mode, or an unknown one.
- The query takes `modes`, the list of enabled modes. The default is all six.
- The router **boards only lines of enabled modes**.
- Walking transfers between line-stops still work as normal. So does starting or ending at a
  station the user picked, even if only disabled lines serve it: the route can walk to a connected
  station.
- Access candidates for a place or the current location only include stations with at least one
  line of an enabled mode.

| mode | lines |
|---|---|
| LRT | 3 Ampang, 4 Sri Petaling, 5 Kelana Jaya, 11 Shah Alam |
| MRT | 9 Kajang, 12 Putrajaya |
| Monorail | 8 KL Monorail |
| BRT | B1 BRT Sunway |
| KTM | 1 Batu Caves–Pulau Sebang, 2 Tanjung Malim–Pelabuhan Klang |
| ERL | 6 KLIA Ekspres, 7 KLIA Transit |

**Max walk.**
- The query takes `maxWalkM`: 500, 1000 (default) or 2000. It applies only to the first and last
  walks from a place.
- A stretch beyond it is shown as "X km to [station], consider e-hailing". It's excluded from
  times, as in §4b.
- Transfers between stations aren't affected.

**No route because of filters.**
- If filters block every route, `suggestModes()` retries with each single disabled mode added.
- It returns the modes that give a route, fastest first by `expected_min`.
- The UI shows, e.g., "No route with MRT only. Enabling LRT gives ~40 min", where the mode name is
  a button that enables it.
- If even all modes give no route, the normal no-route message is shown.

**Hint when a filter hides a closer station.**
- `blockedNearby()` lists the stations within the max walk that only switched-off modes serve.
- If one is closer than the station a first or last walk uses, the page shows e.g. "16 Sierra
  (MRT) is 260 m away, but MRT is switched off. Turn on MRT", with a one-tap enable.

**UI and persistence.**
- Mode chips (multi-select toggle buttons) and a max-walk select sit under day/time.
- Filters and max walk are saved in `localStorage` under `klrail.filters`, inside try/catch. If
  storage is unavailable or the data is invalid, the defaults apply.
- When the filters aren't the defaults, results show "Filters active · Reset filters".

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
- `tests/filters.test.mjs` tests, on synthetic networks:
  - disabled lines are never boarded
  - access candidates respect the enabled modes
  - `suggestModes()` returns only the modes that help, fastest first
  - the max-walk cut-off (500 m / 1 km / 2 km) and the far fallback
- `tests/access.test.mjs` tests the access-leg logic on synthetic coordinates:
  - picking the 4 nearest stations within the max walk
  - the max-walk cut-off
  - falling back to the nearest 2 marked `far`
  - the walk-time formula
  - the virtual start/end choosing the best combination
  - far legs excluded from the times
  - `direct_walk_min`

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
5. **M4 – places — DONE:** search from and to a place or the current location, with access legs
   (§4b).
   - **M4.1 – filters:** mode chips, max walk, no-route mode suggestions (§4c).
6. **M5 – timetable-aware KTM:** real departures (next train after arrival) instead of headway / 2,
   respecting `calendar_dates`.
7. **Later / optional:**
   - Skypark line
   - Ekspres all-stop after 23:00
   - Transit peak headway once the peak hours are known
   - merging the AG/SP shared trunk
