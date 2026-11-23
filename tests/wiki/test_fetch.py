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

    def test_duplicate_uid_is_error(self):
        with self.assertRaises(ValueError):
            fetch.build([eq("A")], [eq("A")], [], [])
        with self.assertRaises(ValueError):
            fetch.build([eq("A"), eq("A")], [], [], [])

    def test_location_without_item_reported(self):
        report = []
        doc = fetch.build([eq("A")], [], [{"uid": "Ghost", "location": "Inn", "x": 0, "y": 0}], [], report=report)
        self.assertEqual(list(doc["items"]), ["A"])
        self.assertTrue(any("Ghost" in line or "1 item location" in line for line in report))

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

            def opener(request):
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
                opener=lambda r: FakeResponse(b"[]"),
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

            def opener(request):
                calls.append(1)
                raise urllib.error.HTTPError(request.full_url, 429, "Too Many", {}, None)

            get = fetch.make_get(Path(tmp), opener=opener, sleep=sleeps.append)
            with self.assertRaises(urllib.error.HTTPError):
                get("https://bg3.wiki/x")
            self.assertEqual(len(calls), 3)
            self.assertEqual(sleeps.count(60), 2)
            self.assertEqual(list(Path(tmp).glob("*.json")), [])

    def test_429_then_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []

            def opener(request):
                calls.append(1)
                if len(calls) == 1:
                    raise urllib.error.HTTPError(request.full_url, 429, "Too Many", {}, None)
                return FakeResponse(b"[]")

            get = fetch.make_get(Path(tmp), opener=opener, sleep=lambda s: None)
            self.assertEqual(get("https://bg3.wiki/x"), b"[]")


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
            fetch.run(Path(tmp), get)
            doc = json.loads((Path(tmp) / "items.json").read_text(encoding="utf-8"))
            self.assertEqual(doc["items"]["A"]["locations"][0]["act"], "one")
        data["weapons"] = [eq("A")]
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                fetch.run(Path(tmp), get)
            self.assertFalse((Path(tmp) / "items.json").exists())


if __name__ == "__main__":
    unittest.main()
