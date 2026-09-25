# Manual TODO (needs human judgement)

Estimates fill every gap below, so the planner works without them. They are flagged as
estimated in the build warnings and in route output. A manual value always replaces its estimate.

1. **Confirm interchange classifications**: `docs/interchange-review-draft.md` §1.
   Especially rows 12 (Abdullah Hukum), 43 (Bandar Utama) and 46 (Glenmarie). On the map these are
   very short grey stubs, so they could be misread as interchanges. Also the 3 rows marked `none`
   (39, 52, 55). If a classification changes, edit `kind` in `overrides/transfers.json`, or delete
   the pair.
2. **Walk times**: all 70 transfers use estimated `walk_min` (straight-line × 1.4 at 4.5 km/h, plus
   1 or 2 min). Replace them with real values where you know them: `overrides/transfers.json`,
   field `walk_min`.
3. **Fare-gate flags**: `exits_gates` is unset on all 70 transfers, and unset counts as no penalty.
   Set `true`/`false`: `overrides/transfers.json`. The penalty is 5 min; change it in
   `scripts/build_network.py` `CONFIG["gate_penalty_min"]`.
4. **KLIA Transit timings (optional)**: inter-station times are estimated by distance split. If you
   find official per-segment times, or the weekday peak hours for the 15-min headway, set `run_sec`
   / `headways` in `overrides/lines/erl-klia-transit.json`, and cite the source in `sources`.
5. **Known routes**: write `tests/known-routes.json` (format in PLAN.md §6).

Deferred: the Skypark line (PLAN.md §0).
