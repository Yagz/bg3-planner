"""One-off, polite fetch of item rarity and locations from bg3.wiki's Cargo exports.

Produces data/wiki/items.json (CC BY-NC-SA 4.0, attribution in data/wiki/README.md).
Never called from the site: run by hand, slowly, once per game patch.
"""

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path

from scripts.data.importer import write_json

BASE = "https://bg3.wiki/w/index.php"
USER_AGENT = "bg3-planner-data-fetch/1.0"
PAGE_SIZE = 500
MAX_ROWS = 100_000
TIMEOUT = 60
ACTS = {"prologue", "one", "two", "three"}
MIN_DELAY = 5.0
RETRY_DELAY = 60
MAX_RETRIES = 2
ITEM_FIELDS = ["name", "uid", "uuid", "rarity", "type", "legacy"]
LOCATION_FIELDS = ["uid", "location", "x", "y"]
ZONE_FIELDS = ["name", "act", "region"]


def _url(table: str, fields: list[str], offset: int) -> str:
    query = urllib.parse.urlencode(
        [
            ("title", "Special:CargoExport"),
            ("tables", table),
            ("fields", ",".join(fields)),
            ("format", "json"),
            ("limit", PAGE_SIZE),
            ("offset", offset),
        ],
        safe=",:",
    )
    return f"{BASE}?{query}"


def export(table: str, fields: list[str], get: Callable[[str], bytes]) -> list[dict]:
    """All rows of a Cargo table, paging until a page is shorter than the page size."""
    rows: list[dict] = []
    offset = 0
    previous = None
    while True:
        batch = json.loads(get(_url(table, fields, offset)))
        if not isinstance(batch, list) or not all(isinstance(row, dict) for row in batch):
            raise ValueError(f"{table}: page at offset {offset} is not a list of objects")
        if previous is not None and batch == previous:
            raise ValueError(f"{table}: page at offset {offset} repeats the previous page (offset ignored?)")
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        if len(rows) > MAX_ROWS:
            raise ValueError(f"{table}: more than {MAX_ROWS} rows, giving up")
        previous = batch
        offset += PAGE_SIZE


def make_get(
    cache_dir: Path,
    refresh: bool = False,
    opener: Callable = urllib.request.urlopen,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> Callable[[str], bytes]:
    """A cached, rate-limited GET: at least 5 s between network requests, 429 retried twice after 60 s."""
    last = [None]

    def wait() -> None:
        if last[0] is not None:
            remaining = MIN_DELAY - (clock() - last[0])
            if remaining > 0:
                sleep(remaining)

    def get(url: str) -> bytes:
        cached = cache_dir / (hashlib.sha1(url.encode()).hexdigest() + ".json")
        if not refresh and cached.exists():
            return cached.read_bytes()
        retries = 0
        while True:
            wait()
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            try:
                with opener(request, timeout=TIMEOUT) as response:
                    body = response.read()
                last[0] = clock()
                break
            except urllib.error.HTTPError as error:
                last[0] = clock()
                if error.code != 429 or retries >= MAX_RETRIES:
                    raise
                retries += 1
                sleep(RETRY_DELAY)
        json.loads(body)  # never cache a body that is not JSON
        cache_dir.mkdir(parents=True, exist_ok=True)
        temporary = cached.with_suffix(".tmp")
        temporary.write_bytes(body)
        temporary.replace(cached)
        return body

    return get


def build(equipment: list[dict], weapons: list[dict], item_locations: list[dict], locations: list[dict], report: list[str] | None = None) -> dict:
    """Join items, their locations and the act of each location. Raises ValueError listing every error."""
    report = report if report is not None else []
    errors: list[str] = []
    items: dict[str, dict] = {}
    empty = 0
    for kind, rows in (("equipment", equipment), ("weapon", weapons)):
        for row in rows:
            uid = row.get("uid")
            if not uid:
                empty += 1
                continue
            if uid in items:
                errors.append(f"duplicate uid {uid!r} ({kind}, already seen as {items[uid]['kind']})")
                continue
            items[uid] = {"uuid": row.get("uuid"), "kind": kind, "rarity": row.get("rarity"), "legacy": row.get("legacy"), "locations": []}
    if empty:
        report.append(f"{empty} item row(s) with an empty uid skipped")
    if errors:
        raise ValueError("\n".join(errors))
    acts: dict[str, str | None] = {}
    for row in locations:
        name = row.get("name") if isinstance(row, dict) else None
        if not name:
            errors.append(f"malformed locations row: {row!r}")
        elif name in acts:
            errors.append(f"duplicate location name {name!r}")
        elif row.get("act") is not None and row["act"] not in ACTS:
            errors.append(f"location {name!r} has unknown act {row['act']!r}")
        else:
            acts[name] = row.get("act")
    if errors:
        raise ValueError("\n".join(errors))
    orphans = 0
    unknown: set[str] = set()
    for row in item_locations:
        item = items.get(row.get("uid"))
        if item is None:
            orphans += 1
            continue
        place = row.get("location")
        act = acts.get(place)
        if act is None:
            unknown.add(str(place))
        item["locations"].append({"location": place, "act": act, "x": row.get("x"), "y": row.get("y")})
    if orphans:
        report.append(f"{orphans} item location(s) whose uid is in neither table skipped")
    for place in sorted(unknown):
        report.append(f"location {place!r} has no act")
    for item in items.values():
        item["locations"].sort(key=lambda loc: (str(loc["location"]), loc["x"] is None, loc["x"] or 0, loc["y"] is None, loc["y"] or 0))
    return {"source": "https://bg3.wiki", "license": "CC BY-NC-SA 4.0", "items": items}


def run(output: Path, get: Callable[[str], bytes]) -> None:
    equipment = export("equipment", ITEM_FIELDS, get)
    weapons = export("weapons", ITEM_FIELDS, get)
    item_locations = export("item_locations", LOCATION_FIELDS, get)
    locations = export("locations", ZONE_FIELDS, get)
    report: list[str] = []
    doc = build(equipment, weapons, item_locations, locations, report)
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "items.json", doc)
    items = doc["items"]
    with_locations = sum(1 for item in items.values() if item["locations"])
    acts_null = sum(1 for item in items.values() for loc in item["locations"] if loc["act"] is None)
    print(f"{len(items)} items, {with_locations} with locations, {acts_null} locations without act")
    for line in report:
        print("report:", line)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--refresh", action="store_true", help="ignore the cache in cache/wiki")
    args = parser.parse_args(argv)
    try:
        run(args.output, make_get(Path("cache/wiki"), refresh=args.refresh))
    except (ValueError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
