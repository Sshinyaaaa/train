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
4. **KLIA Transit**: done. Headways and last trains now come from ERL's timetable, effective
   21 Mar 2026. Check it again if ERL publishes a newer schedule.
5. **Known routes**: write `tests/known-routes.json` (format in PLAN.md §6).
6. **Rapid KL fares**: waiting on Prasarana's reply about permission. Until then, Rapid KL segments
   link to the official calculator.
7. **KTM fares**: check these against the KTMB app, then tell me to drop the "may be outdated"
   caveat, or to replace the table. Figures are from the 2015 tables, cash / cashless:
   - KL Sentral → Seremban: RM8.70 / RM7.40
   - Batu Caves → Subang Jaya: RM4.70 / RM4.00
   - Pelabuhan Klang → KL Sentral: RM6.40 / RM5.40

   The cashless figures were transcribed from an image. The table's maximum (Tanjung Malim ↔ Tampin,
   RM23.20) matches the T&C's April 2026 Klang Valley maximum fare. Abdullah Hukum and Kajang 2 are
   not in the table.

Deferred: the Skypark line (PLAN.md §0).
