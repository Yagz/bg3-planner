import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path

from scripts.wiki import fetch


def page(rows):
    return json.dumps(rows).encode()


class ExportTest(unittest.TestCase):
    def test_export_pages_until_short_page(self):
        urls = []
        pages = [[{"uid": str(i)} for i in range(500)], [{"uid": "last"}]]

        def get(url):
            urls.append(url)
            return page(pages[len(urls) - 1])

        rows = fetch.export("equipment", ["uid"], get)
        self.assertEqual(len(rows), 501)
        self.assertEqual(len(urls), 2)
        self.assertIn("tables=equipment", urls[0])
        self.assertIn("fields=uid", urls[0])
        self.assertIn("limit=500", urls[0])
        self.assertIn("offset=0", urls[0])
        self.assertIn("offset=500", urls[1])

    def test_export_stops_on_repeated_page(self):
        same = page([{"uid": str(i)} for i in range(500)])
        calls = []

        def get(url):
            calls.append(url)
            return same

        with self.assertRaises(ValueError):
            fetch.export("t", ["uid"], get)
        self.assertEqual(len(calls), 2)

    def test_export_stops_above_row_cap(self):
        counter = [0]

        def get(url):
            counter[0] += 1
            return page([{"uid": f"{counter[0]}-{i}"} for i in range(500)])

        with self.assertRaises(ValueError):
            fetch.export("t", ["uid"], get)
        self.assertLessEqual(counter[0], 201)

    def test_export_rejects_non_list_pages(self):
        for body in ({"error": "denied"}, [1, 2], "x"):
            with self.assertRaises(ValueError):
                fetch.export("t", ["a"], lambda u, b=body: page(b))

    def test_export_decodes_html_entities(self):
        rows = fetch.export("t", ["a"], lambda u: page([{"a": "Servants&#039; Quarters &amp; Co", "b": 3, "c": None}]))
        self.assertEqual(rows, [{"a": "Servants' Quarters & Co", "b": 3, "c": None}])

    def test_export_empty_first_page(self):
        self.assertEqual(fetch.export("t", ["a"], lambda u: page([])), [])


def eq(uid, **kw):
    return {"name": uid, "uid": uid, "uuid": "u-" + str(uid), "rarity": "Rare", "type": "Boots", "legacy": None, **kw}


class BuildTest(unittest.TestCase):
    def test_build_joins_act(self):
        report = []
        doc = fetch.build(
            [eq("B"), eq("A")],
            [eq("W", rarity=None, legacy="legacy")],
            [
                {"uid": "A", "location": "Zed", "x": 1, "y": 2},
                {"uid": "A", "location": "Inn", "x": None, "y": None},
                {"uid": "W", "location": "Inn", "x": 3, "y": 4},
            ],
            [{"name": "Inn", "act": "one", "region": "r"}, {"name": "Zed", "act": "three", "region": "r"}],
            report=report,
        )
        self.assertEqual(doc["source"], "https://bg3.wiki")
        self.assertEqual(doc["license"], "CC BY-NC-SA 4.0")
        items = doc["items"]
        self.assertEqual(items["A"]["kind"], "equipment")
        self.assertEqual(items["W"]["kind"], "weapon")
        self.assertEqual(items["W"]["legacy"], "legacy")
        self.assertIsNone(items["W"]["rarity"])
        self.assertEqual(items["B"]["locations"], [])
        self.assertEqual(
            items["A"]["locations"],
            [
                {"location": "Inn", "act": "one", "x": None, "y": None},
                {"location": "Zed", "act": "three", "x": 1, "y": 2},
            ],
        )
        self.assertEqual(report, [])

    def test_unknown_location_act_null_and_reported(self):
        report = []
        doc = fetch.build([eq("A")], [], [{"uid": "A", "location": "Nowhere", "x": 0, "y": 0}], [], report=report)
        self.assertIsNone(doc["items"]["A"]["locations"][0]["act"])
        self.assertTrue(any("Nowhere" in line for line in report))

    def test_identical_rows_merged_and_reported(self):
        report = []
        doc = fetch.build([eq("A"), eq("A")], [], [], [], report=report)
        self.assertEqual(list(doc["items"]), ["A"])
        self.assertTrue(any("1 identical" in line for line in report))

    def test_listed_ambiguous_uid_left_out_with_locations(self):
        report = []
        doc = fetch.build(
            [eq("A"), eq("A", uuid="other"), eq("B")],
            [],
            [{"uid": "A", "location": "Inn", "x": 0, "y": 0}],
            [{"name": "Inn", "act": "one", "region": "r"}],
            report=report,
            ambiguous={"A"},
        )
        self.assertEqual(list(doc["items"]), ["B"])
        self.assertTrue(any("ambiguous" in line and "A" in line for line in report))
        self.assertFalse(any("neither table" in line for line in report))

    def test_unlisted_ambiguous_uid_is_error(self):
        with self.assertRaises(ValueError):
            fetch.build([eq("A"), eq("A", uuid="other")], [], [], [])

    def test_stale_ambiguous_entry_is_error(self):
        with self.assertRaises(ValueError):
            fetch.build([eq("A")], [], [], [], ambiguous={"A"})
        with self.assertRaises(ValueError):
            fetch.build([eq("A")], [], [], [], ambiguous={"Gone"})

    def test_committed_ambiguous_file_parses(self):
        uids = fetch.load_ambiguous()
        self.assertIn("ARM_Robe_Body", uids)
        self.assertEqual(len(uids), 6)

    def test_duplicate_uid_is_error(self):
        with self.assertRaises(ValueError):
            fetch.build([eq("A")], [eq("A")], [], [])

    def test_location_without_item_reported(self):
        report = []
        doc = fetch.build([eq("A")], [], [{"uid": "Ghost", "location": "Inn", "x": 0, "y": 0}], [], report=report)
        self.assertEqual(list(doc["items"]), ["A"])
        self.assertTrue(any("Ghost" in line or "1 item location" in line for line in report))

    def test_bad_locations_rows_are_errors(self):
        for bad in (
            [{"name": "A", "act": "one"}, {"name": "A", "act": "two"}],
            [{"name": "A", "act": "four"}],
            [{"act": "one"}],
        ):
            with self.assertRaises(ValueError):
                fetch.build([], [], [], bad)

    def test_location_rows_with_no_data_dropped_and_counted(self):
        report = []
        doc = fetch.build(
            [eq("A")],
            [],
            [{"uid": "A", "location": None, "x": None, "y": None}, {"uid": "A", "location": "Inn", "x": None, "y": None}],
            [{"name": "Inn", "act": "one", "region": "r"}],
            report=report,
        )
        self.assertEqual(len(doc["items"]["A"]["locations"]), 1)
        self.assertTrue(any("1 location row(s) with no data" in line for line in report))

    def test_empty_uid_counted_not_kept(self):
        report = []
        doc = fetch.build([eq(None), eq("")], [], [], [], report=report)
        self.assertEqual(doc["items"], {})
        self.assertTrue(any("2" in line and "empty uid" in line for line in report))


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class GetTest(unittest.TestCase):
    def test_cache_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def opener(request, timeout=None):
                calls.append(request)
                return FakeResponse(b"[1]")

            get = fetch.make_get(Path(tmp), opener=opener, sleep=lambda s: None)
            self.assertEqual(get("https://bg3.wiki/x"), b"[1]")
            self.assertEqual(get("https://bg3.wiki/x"), b"[1]")
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0].get_header("User-agent"), "bg3-planner-data-fetch/1.0")
            self.assertEqual(len(list(Path(tmp).glob("*.json"))), 1)
            get2 = fetch.make_get(Path(tmp), opener=opener, sleep=lambda s: None)
            get2("https://bg3.wiki/x")
            self.assertEqual(len(calls), 1)
            get3 = fetch.make_get(Path(tmp), opener=opener, sleep=lambda s: None, refresh=True)
            get3("https://bg3.wiki/x")
            self.assertEqual(len(calls), 2)

    def test_waits_between_requests(self):
        with tempfile.TemporaryDirectory() as tmp:
            sleeps = []
            now = [100.0]
            get = fetch.make_get(
                Path(tmp),
                opener=lambda r, timeout=None: FakeResponse(b"[]"),
                sleep=lambda s: (sleeps.append(s), now.__setitem__(0, now[0] + s)),
                clock=lambda: now[0],
            )
            get("https://bg3.wiki/a")
            self.assertEqual(sleeps, [])
            get("https://bg3.wiki/b")
            self.assertEqual(sleeps, [5.0])

    def test_429_retry_then_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            sleeps = []
            calls = []

            def opener(request, timeout=None):
                calls.append(1)
                raise urllib.error.HTTPError(request.full_url, 429, "Too Many", {}, io.BytesIO(b""))

            get = fetch.make_get(Path(tmp), opener=opener, sleep=sleeps.append)
            with self.assertRaises(urllib.error.HTTPError):
                get("https://bg3.wiki/x")
            self.assertEqual(len(calls), 3)
            self.assertEqual(sleeps.count(60), 2)
            self.assertEqual(list(Path(tmp).glob("*.json")), [])

    def test_429_then_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def opener(request, timeout=None):
                calls.append(1)
                if len(calls) == 1:
                    raise urllib.error.HTTPError(request.full_url, 429, "Too Many", {}, io.BytesIO(b""))
                return FakeResponse(b"[]")

            get = fetch.make_get(Path(tmp), opener=opener, sleep=lambda s: None)
            self.assertEqual(get("https://bg3.wiki/x"), b"[]")


    def test_non_429_error_makes_one_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def opener(request, timeout=None):
                calls.append(1)
                raise urllib.error.HTTPError(request.full_url, 500, "Boom", {}, io.BytesIO(b""))

            get = fetch.make_get(Path(tmp), opener=opener, sleep=lambda s: None)
            with self.assertRaises(urllib.error.HTTPError):
                get("https://bg3.wiki/x")
            self.assertEqual(len(calls), 1)

    def test_non_json_body_not_cached_and_timeout_passed(self):
        with tempfile.TemporaryDirectory() as tmp:
            seen = []

            def opener(request, timeout=None):
                seen.append(timeout)
                return FakeResponse(b"<html>")

            get = fetch.make_get(Path(tmp), opener=opener, sleep=lambda s: None)
            with self.assertRaises(ValueError):
                get("https://bg3.wiki/x")
            self.assertEqual(seen, [60])
            self.assertEqual(list(Path(tmp).iterdir()), [])


class MainTest(unittest.TestCase):
    def test_main_exit_code_1_on_os_error(self):
        def boom(output, get):
            raise OSError("network down")

        original = fetch.run
        fetch.run = boom
        try:
            with tempfile.TemporaryDirectory() as tmp:
                self.assertEqual(fetch.main(["--output", tmp]), 1)
        finally:
            fetch.run = original


class RunTest(unittest.TestCase):
    def test_run_writes_items_json_and_nothing_on_error(self):
        data = {
            "equipment": [eq("A")],
            "weapons": [],
            "item_locations": [{"uid": "A", "location": "Inn", "x": 1, "y": 2}],
            "locations": [{"name": "Inn", "act": "one", "region": "r"}],
        }

        def get(url):
            for table, rows in data.items():
                if f"tables={table}&" in url:
                    return page(rows)
            raise AssertionError(url)

        with tempfile.TemporaryDirectory() as tmp:
            fetch.run(Path(tmp), get, set())
            doc = json.loads((Path(tmp) / "items.json").read_text(encoding="utf-8"))
            self.assertEqual(doc["items"]["A"]["locations"][0]["act"], "one")
        data["weapons"] = [eq("A")]
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                fetch.run(Path(tmp), get, set())
            self.assertFalse((Path(tmp) / "items.json").exists())


if __name__ == "__main__":
    unittest.main()
