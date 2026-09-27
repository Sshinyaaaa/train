"""Converter tests. Run: python -m unittest discover -s tests

Real-feed tests are skipped when data/raw/ is absent (it is gitignored).
"""
import datetime as dt
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_network as bn  # noqa: E402
from gtfs_util import RAW, to_secs  # noqa: E402
from validate import validate  # noqa: E402

HAVE_FEEDS = (RAW / "ktmb" / "trips.txt").exists() and (RAW / "rapid_rail_kl" / "trips.txt").exists()


class Units(unittest.TestCase):
    def test_times_past_midnight(self):
        self.assertEqual(to_secs("25:56:00"), 93360)
        self.assertEqual(to_secs("6:00:18"), 21618)

    def test_lapsed_calendar_keeps_service(self):
        row = {"monday": "1", "tuesday": "1", "wednesday": "1", "thursday": "1", "friday": "1",
               "saturday": "0", "sunday": "0", "start_date": "20200401", "end_date": "20260331"}
        self.assertEqual(bn.day_types(row), ["weekday"])

    def test_walk_estimate(self):
        # 0 m: overhead only; 100 m * 1.4 / 75 m/min = 1.87 -> +2 connecting = 3.87 -> 4
        self.assertEqual(bn.estimate_walk_min(0, "interchange"), 1)
        self.assertEqual(bn.estimate_walk_min(100, "connecting"), 4)
        # exact integer result is not bumped up by float noise: 375 m * 1.4 / 75 = 7.0 (+1)
        self.assertEqual(bn.estimate_walk_min(375, "interchange"), 8)

    def test_distance_split(self):
        cum = bn.distance_split([(3.0, 101.0), (3.01, 101.0), (3.03, 101.0)], 300)
        self.assertEqual(cum, [0, 100, 300])

    def test_station_name(self):
        self.assertEqual(bn.station_name(["KL SENTRAL", "KL SENTRAL - REDONE"]), "KL SENTRAL")
        self.assertEqual(bn.station_name(["USJ 7", "USJ7"]), "USJ7")
        self.assertEqual(bn.station_name(["PLAZA RAKYAT", "MERDEKA"]), "MERDEKA / PLAZA RAKYAT")


def tiny_net():
    stops = {s: {"name": s, "lat": 3.0, "lon": 101.0, "lines": ["x:L"], "station": "st:" + s} for s in ("x:a", "x:b")}
    return {
        "meta": {"feeds": {"f": {"calendar_end": "2030-01-01", "days_left": 1000}}},
        "stops": stops,
        "stations": {"st:" + s: {"stops": [s]} for s in stops},
        "lines": {"x:L": {"color": "#000", "display": {"number": "1", "name": "Test", "mode": "LRT"}, "patterns": [{"dir": 0, "stops": ["x:a", "x:b"], "run_sec": [0, 60], "run_source": "gtfs",
                                        "headways": {"weekday": [[0, 1, 1]], "saturday": [[0, 1, 1]], "sunday": [[0, 1, 1]]}}]}},
        "transfers": [],
    }


class Validation(unittest.TestCase):
    def errors(self, net):
        return [e for e in validate(net)[0] if not e.startswith("coverage")]

    def test_clean(self):
        self.assertEqual(self.errors(tiny_net()), [])

    def test_unknown_transfer_stop(self):
        net = tiny_net()
        net["transfers"].append({"from": "x:a", "to": "x:zz", "kind": "connecting", "walk_min": 1, "exits_gates": None})
        self.assertTrue(any("unknown stop x:zz" in e for e in self.errors(net)))

    def test_bad_segment_and_missing_headway(self):
        net = tiny_net()
        p = net["lines"]["x:L"]["patterns"][0]
        p["run_sec"], p["headways"] = [0, 0], {"weekday": [[0, 1, 1]]}
        errs = self.errors(net)
        self.assertTrue(any("segment" in e for e in errs))
        self.assertTrue(any("no headway for sunday" in e for e in errs))

    def test_missing_display_metadata(self):
        net = tiny_net()
        del net["lines"]["x:L"]["display"]
        self.assertTrue(any("missing display metadata" in e for e in self.errors(net)))

    def test_missing_or_bad_mode(self):
        net = tiny_net()
        del net["lines"]["x:L"]["display"]["mode"]
        self.assertTrue(any("display mode" in e for e in self.errors(net)))
        net["lines"]["x:L"]["display"]["mode"] = "Tram"
        self.assertTrue(any("display mode 'Tram'" in e for e in self.errors(net)))

    def test_bad_service_hours(self):
        net = tiny_net()
        net["lines"]["x:L"]["patterns"][0]["service_hours"] = [80000, 70000]
        self.assertTrue(any("bad service_hours" in e for e in self.errors(net)))

    def test_fare_systems(self):
        net = tiny_net()
        net["fares"] = {"systems": {"s": {"lines": ["x:L"], "fare_types": {"cash": {"table": {"ids": ["a", "zz"], "cents": [[None, 100], [100, None]]}}}}}}
        errs = self.errors(net)
        self.assertTrue(any("unknown stop zz" in e for e in errs))
        net["fares"]["systems"]["s"]["fare_types"]["cash"]["table"] = {"ids": ["a", "b"], "cents": [[None, 0], [0, None]]}
        self.assertTrue(any("bad price" in e for e in self.errors(net)))
        net["fares"]["systems"]["s"]["fare_types"] = {"student": {"text": "x"}, "concession": {}}
        errs = self.errors(net)
        self.assertTrue(any("unknown fare type student" in e for e in errs))
        self.assertTrue(any("concession has neither a table nor text" in e for e in errs))
        net["fares"]["systems"] = {}
        self.assertTrue(any("in 0 fare systems" in e for e in self.errors(net)))

    def test_out_of_scope_ktmb_line(self):
        net = tiny_net()
        net["lines"]["ktmb:ETS"] = {"color": "#000", "display": {"number": "x", "name": "x", "mode": "KTM"}, "patterns": []}
        self.assertTrue(any("out-of-scope KTMB line ktmb:ETS" in e for e in self.errors(net)))

    def test_stale_is_warning_not_error(self):
        net = tiny_net()
        net["meta"]["feeds"]["f"] = {"calendar_end": "2020-01-01", "days_left": -5}
        errors, warnings = validate(net)
        self.assertFalse([e for e in errors if "STALE" in e])
        self.assertTrue(any(w.startswith("STALE:") for w in warnings))


@unittest.skipUnless(HAVE_FEEDS, "data/raw feeds not present")
class RealFeeds(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.net = bn.build(dt.date(2026, 11, 1))  # after KTMB calendar end
        cls.errors, cls.warnings = validate(cls.net)

    def test_no_errors(self):
        self.assertEqual(self.errors, [])

    def test_ktmb_filtered_by_route(self):
        self.assertEqual(sorted(l for l in self.net["lines"] if l.startswith("ktmb:")),
                         ["ktmb:KA15_KD19", "ktmb:KC05_KB18"])

    def test_lapsed_ktmb_still_has_service(self):
        self.assertTrue(any(w.startswith("STALE: ktmb") for w in self.warnings))
        for p in self.net["lines"]["ktmb:KC05_KB18"]["patterns"]:
            self.assertTrue(p["headways"]["weekday"])

    def test_rasa_kkb_pattern_override(self):
        south = next(p for p in self.net["lines"]["ktmb:KA15_KD19"]["patterns"] if p["dir"] == 1)
        north = next(p for p in self.net["lines"]["ktmb:KA15_KD19"]["patterns"] if p["dir"] == 0)
        self.assertEqual(south["stops"][:4], ["ktmb:15200", "ktmb:16100", "ktmb:16300", "ktmb:16500"])
        self.assertEqual(south["estimated_segments"], [0, 1, 2])
        # mirrored: southbound 15200->16100 equals northbound 16100->15200
        n = north["stops"]
        self.assertEqual(south["run_sec"][1] - south["run_sec"][0],
                         north["run_sec"][n.index("ktmb:15200")] - north["run_sec"][n.index("ktmb:16100")])
        self.assertEqual(len(set(south["stops"])), len(south["stops"]))

    def test_transit_official_run_times_and_service_hours(self):
        t = {p["dir"]: p for p in self.net["lines"]["erl-klia-transit"]["patterns"]}
        # differences between consecutive stations on the official first/last train table
        self.assertEqual(t[0]["run_sec"], [0, 420, 1140, 1740, 2160, 2340])
        self.assertEqual(t[1]["run_sec"], [0, 240, 660, 1200, 1860, 2340])
        self.assertEqual(t[0]["run_source"], "official")
        # ERL timetable effective 21 Mar 2026: last trains 00:00 from KL Sentral, 01:00 from KLIA T2
        self.assertEqual(t[0]["service_hours"], [5 * 3600 + 3 * 60, 24 * 3600])               # 05:03-24:00
        self.assertEqual(t[1]["service_hours"], [5 * 3600 + 18 * 60, 25 * 3600])              # 05:18-25:00
        self.assertIn("effective 21 Mar 2026", t[0]["headway_source_detail"])
        self.assertFalse(any("erl-klia-transit: run times are estimated" in w for w in self.warnings))


class TransferWalkSources(unittest.TestCase):
    """manual walk_min > OSM-routed distance (only if routed for the same coordinates) > estimate."""

    def run_with(self, transfers, routed):
        stops = {"a": {"lat": 3.0, "lon": 101.0}, "b": {"lat": 3.001, "lon": 101.0}}   # ~111 m apart
        orig = bn.OVERRIDES
        tmp = Path(__file__).resolve().parent / "_tmp_overrides2"
        try:
            tmp.mkdir(exist_ok=True)
            (tmp / "transfers.json").write_text(json.dumps(transfers), encoding="utf-8")
            bn.OVERRIDES = tmp
            return bn.load_transfers(stops, routed=routed), stops
        finally:
            bn.OVERRIDES = orig
            (tmp / "transfers.json").unlink(missing_ok=True)
            tmp.rmdir()

    def test_routed_used_when_coords_match(self):
        t = [{"from": "a", "to": "b", "kind": "connecting", "walk_min": None, "exits_gates": None}]
        stops = {"a": {"lat": 3.0, "lon": 101.0}, "b": {"lat": 3.001, "lon": 101.0}}
        routed = {bn.pair_key("a", "b"): {"dist_m": 600.0, "coords": bn.coords_key(stops["a"], stops["b"], "a", "b"), "routed": "2026-09-28"}}
        (row,), _ = self.run_with(t, routed)
        self.assertEqual(row["walk_source"], "osm-routed")
        self.assertEqual(row["dist_m"], 600)
        self.assertEqual(row["walk_min"], 10)          # 600 m / 75 m/min = 8 + 2 min connecting overhead

    def test_stale_coords_fall_back_to_estimate(self):
        t = [{"from": "a", "to": "b", "kind": "connecting", "walk_min": None, "exits_gates": None}]
        routed = {bn.pair_key("a", "b"): {"dist_m": 600.0, "coords": [3.1, 101.1, 3.2, 101.2], "routed": "2026-09-28"}}
        (row,), _ = self.run_with(t, routed)
        self.assertEqual(row["walk_source"], "estimated")

    def test_manual_beats_routed(self):
        t = [{"from": "a", "to": "b", "kind": "connecting", "walk_min": 3, "exits_gates": False}]
        stops = {"a": {"lat": 3.0, "lon": 101.0}, "b": {"lat": 3.001, "lon": 101.0}}
        routed = {bn.pair_key("a", "b"): {"dist_m": 600.0, "coords": bn.coords_key(stops["a"], stops["b"], "a", "b")}}
        (row,), _ = self.run_with(t, routed)
        self.assertEqual((row["walk_min"], row["walk_source"]), (3, "manual"))

    def routed_row(self, dist_m):
        t = [{"from": "a", "to": "b", "kind": "connecting", "walk_min": None, "exits_gates": None}]
        stops = {"a": {"lat": 3.0, "lon": 101.0}, "b": {"lat": 3.001, "lon": 101.0}}
        routed = {bn.pair_key("a", "b"): {"dist_m": dist_m, "coords": bn.coords_key(stops["a"], stops["b"], "a", "b")}}
        (row,), _ = self.run_with(t, routed)
        return row

    def test_implausible_routed_walk_rejected(self):
        row = self.routed_row(27645.0)                 # Sungai Besi case: OSRM snapped to a disconnected path
        self.assertEqual(row["walk_source"], "estimated")
        self.assertEqual(row["routed_rejected_m"], 27645)

    def test_routed_shorter_than_straight_line_is_floored(self):
        row = self.routed_row(50.0)                    # ~111 m straight line
        self.assertEqual(row["walk_source"], "osm-routed")
        self.assertEqual(row["dist_m"], 111)


class ManualOverrideWins(unittest.TestCase):
    def test_manual_walk_not_replaced(self):
        stops = {"a": {"lat": 3.0, "lon": 101.0}, "b": {"lat": 3.001, "lon": 101.0}}
        orig = bn.OVERRIDES
        tmp = Path(__file__).resolve().parent / "_tmp_overrides"
        try:
            tmp.mkdir(exist_ok=True)
            (tmp / "transfers.json").write_text(
                '[{"from":"a","to":"b","kind":"connecting","walk_min":7,"exits_gates":true},'
                ' {"from":"b","to":"a","kind":"connecting","walk_min":null,"exits_gates":null}]', encoding="utf-8")
            bn.OVERRIDES = tmp
            manual, est = bn.load_transfers(stops)
        finally:
            bn.OVERRIDES = orig
            (tmp / "transfers.json").unlink(missing_ok=True)
            tmp.rmdir()
        self.assertEqual((manual["walk_min"], manual["walk_source"]), (7, "manual"))
        self.assertEqual(est["walk_source"], "estimated")


if __name__ == "__main__":
    unittest.main()
