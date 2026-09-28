# GTFS-Realtime on data.gov.my: does it cover rail? (investigation, 2026-09-28)

Investigation only. Nothing was built and nothing in the site calls these endpoints.

## Summary

| Service | Realtime feed on data.gov.my | Usable for this planner? |
|---|---|---|
| Rapid KL rail (LRT, MRT, Monorail, BRT) | **None.** `prasarana?category=rapid-rail-kl` returns 404: *"Vehicle Position feed for prasarana (rapid-rail-kl) does not exist."* The docs say it *"does not yet have stable realtime feeds."* | No |
| KTMB (incl. KTM Komuter) | **Vehicle positions only**, one feed for all KTMB services (ETS, intercity, shuttle, Komuter) | Not reliably. It is sparse and incomplete for Komuter (below) |
| ERL (KLIA Ekspres / Transit) | **None.** ERL isn't an agency on data.gov.my, static or realtime | No |
| Trip updates (delays, predicted arrivals) and service alerts | **Not offered for any agency.** The docs say they are "in our pipeline for 2026" | No |

**Conclusion:** there is nothing today that would give live departures or delays for the lines this
planner routes on. The KTMB vehicle-position feed could at most show "a train is roughly here",
and it is too patchy for Komuter to be trustworthy.

## What exists

Sources:
- Developer docs: <https://developer.data.gov.my/realtime-api/gtfs-realtime>, cross-checked
  against the docs' source in the open-source repo `data-gov-my/datagovmy-front`
  (`apps/docs/pages/realtime-api/gtfs-realtime.en.mdx`, `rate-limit.en.mdx`, `faq.en.mdx`,
  `changelog.en.mdx`; main branch downloaded 2026-09-28).
- My own requests, below.

**Endpoints:**
- `GET https://api.data.gov.my/gtfs-realtime/vehicle-position/<agency>` (the docs show the general
  form `/gtfs-realtime/<feed>/<agency>`).
- **Documented agencies:**
  - `ktmb`
  - `prasarana?category=` with `rapid-bus-kl`, `rapid-bus-mrtfeeder`, `rapid-bus-kuantan` or
    `rapid-bus-penang`
  - `mybas-*` for BAS.MY cities
- **Feed type:** vehicle positions only. The docs say *"service alerts and trip updates are in our
  pipeline for 2026."*
- **Tested and absent** (all 404):
  - `vehicle-position/prasarana/?category=rapid-rail-kl`
  - `vehicle-position/erl/`, `klia-ekspres/` and `ktmb-komuter/`
  - `trip-update/ktmb` and `trip-update/prasarana?category=rapid-rail-kl`

**Update frequency:** the docs say *"All Vehicle Position feeds are updated every 30 seconds."*
Observed on KTMB: the header timestamp advanced by +28 to +31 s between fetches, which matches.
The vehicles' own timestamps were 35–114 s old when fetched.

**History (changelog):**
- 1.3.0 (2023-11-14): realtime launched with KTMB, Prasarana and myBAS Johor.
- 1.4.0 (2024-04-01): MRT feeder buses added.
- 1.5.0 / 1.6.0 (Oct 2025): more BAS.MY cities.
- No rail additions since launch.

## KTMB feed, observed

Nine snapshots on Mon 28 Sep 2026, 12:17–12:21 MYT. Decoded with a minimal raw protobuf reader, and
trip IDs matched against the committed KTMB static feed.

| | Observed |
|---|---|
| Vehicles per snapshot | 0, 7, 7, 7, 10, 12, 13, 7, 7. One snapshot was **empty**, and counts swing a lot within 30 s |
| Komuter `KA15_KD19` (KTM 2) | 2 vehicles, in **1 of 9** snapshots (SCS21 on trip `weekday_2138`, SCS07 on `weekday_2139`) |
| Komuter `KC05_KB18` (KTM 1) | **none** in any snapshot |
| Other KTMB services | ETS (up to 9), `SH` shuttle (up to 3), `100_9000` and `100_47300` intercity/northern |
| Scheduled in the same window (static feed, Monday service) | KTM 1: 2 trips, KTM 2: 3 trips, ETS: 25, SH: 5, others 5 |
| Fields present | `trip_id` (matches static trip IDs), vehicle id and label (e.g. `ETS309`, `SCS21`), lat/lon, timestamp |
| Fields absent (among those I decoded) | `route_id`, trip start date/time, `stop_id`, `current_status` |
| Bad data | ETS309 reported at (0.0027, 0.0155), next to 0°N 0°E, in 4 of 9 snapshots |

So during the sample the feed showed at most 2 of the 5 scheduled Komuter trains, and at most 9 of
25 ETS trains. With no `stop_id`/status and no trip updates, a train's position would have to be
snapped to the line to estimate progress. There's also no way to tell a train that is missing from
the feed from one that isn't running.

## Can a browser fetch it directly (CORS)?

**Yes.** This matters because the planner is a static site with no backend.

| Check | Result |
|---|---|
| `Access-Control-Allow-Origin` | `*` on the 200 response **and** on the 301 redirect (both checked with `Origin: https://sshinyaaaa.github.io`) |
| Preflight (`OPTIONS`) | 200. Allows GET, max-age 86400. A plain GET is a "simple" request anyway, so no preflight is sent |
| Redirect | The documented URLs without a trailing slash 301 to `…/ktmb/` and `…/prasarana/?category=…`. Browsers follow it, but calling the slash URL directly saves a round trip |
| Response | `Content-Type: application/octet-stream`: binary protobuf (428–805 bytes for KTMB, ~11 KB for `rapid-bus-kl`). A browser would need a protobuf decoder (GTFS-RT bindings or protobufjs from a CDN, or a small hand-written reader of the few fields used) |
| Caching | `Cache-Control: private`, no `ETag` / `Last-Modified`, so no conditional requests. Cloudflare sets a `__cf_bm` bot-management cookie; normal browsers handle this, and nothing here needs or should attempt bypassing it |
| Auth | None needed; no API key is documented |

## Terms of use

- **Licence:** the data.gov.my FAQ source says: *"This data is made open under the Creative Commons
  Attribution 4.0 International License (CC BY 4.0)."* Use would need attribution, e.g.
  "Realtime data: data.gov.my (CC BY 4.0)". The site's MIT licence covers only its source code, not
  the data.
  - A search-engine summary claimed a "Malaysian Government Open Data Terms of Use 1.0". I found no
    such document linked from data.gov.my or the developer docs, so it is **unverified**. The
    data.gov.my footer links only "Guiding Principles" (a JDN policy PDF, not read).
- **Rate limit:** `rate-limit.en.mdx` gives **4 requests per minute** for GTFS Realtime, the same as
  every other data.gov.my API. Going over returns `429 Too Many Requests`.
  - The docs don't say whether the limit is per IP, and I didn't observe it being enforced: no 429 across
    about 30 requests in about 7 minutes during this investigation, some of them in bursts above
    4/min. Don't rely on that.
  - **Implications for a browser client:**
    - Each visitor polls from their own IP. Polling at the feed's 30 s cadence is 2/min, within the
      limit, but visitors behind a shared NAT (office, campus, mobile carrier CGNAT) would share the
      budget.
    - Polling must stop when the tab is hidden, and must back off on 429.
    - A central poller (e.g. a GitHub Action) can't serve a live feed from a static site: it could
      only publish snapshots at most every few minutes, which defeats "realtime".
- **Accuracy:** the docs acknowledge bad GPS positions for buses (validator E028) and trip or route
  ID mismatches for some bus feeds (E003/E004), blaming "legacy operational systems". The KTMB
  sample above shows the same kind of problem.

## If this is revisited

Only worth building once at least one of these is true:
1. `rapid-rail-kl` gets a realtime feed, or
2. **trip updates** or **service alerts** appear for `ktmb` or `rapid-rail-kl`, or
3. the KTMB vehicle feed reliably covers Komuter, with `route_id` / `stop_id`.

Recheck: the GTFS-Realtime docs page, and `changelog.en.mdx` in `data-gov-my/datagovmy-front`.
