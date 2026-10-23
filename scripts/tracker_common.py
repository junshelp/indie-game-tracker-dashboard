"""Shared validation and snapshot helpers for the daily tracker."""

import hashlib
import json
import os
import tempfile
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
STATE_DIR = Path.home() / ".hermes/state/indie-game-event-tracker"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def today_kst():
    return datetime.now(KST).date().isoformat()


def read_json(path, default=None):
    path = Path(path)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_json(path, value):
    """Replace a complete JSON file, never a partially written file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".tracker-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def snapshot_id(value):
    body = json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    return hashlib.sha256(body).hexdigest()[:20]


def valid_url(value):
    if not isinstance(value, str) or any(c.isspace() for c in value):
        return False
    try:
        parsed = urlsplit(value)
        return parsed.scheme in ("http", "https") and bool(parsed.hostname)
    except ValueError:
        return False


def event_summary(events, as_of):
    cutoff = (date.fromisoformat(as_of) + timedelta(days=30)).isoformat()
    upcoming = [e for e in events if e["status"] == "upcoming"]
    return {
        "totalEvents": len(events),
        "upcomingEvents": len(upcoming),
        "pastEvents": len(events) - len(upcoming),
        "upcoming30Days": sum(as_of <= e["startDate"] <= cutoff for e in upcoming),
        "byCountry": dict(Counter(e["countryCode"] for e in events)),
        "byType": dict(Counter(e["typeLabel"] for e in events)),
        "byMonth": dict(Counter(str(e["month"]) for e in events)),
        "byYearMonth": dict(Counter(e["startDate"][:7] for e in events)),
        "submissionOpen": sum(e.get("submissionStatus") == "open" for e in events),
        "dateRange": {"earliest": min(e["startDate"] for e in events),
                      "latest": max(e["endDate"] for e in events)},
    }


def validate_events(data):
    events = data.get("events", [])
    if not events:
        raise ValueError("Event snapshot is empty")
    as_of = data["asOfDate"]
    date.fromisoformat(as_of)
    ids = set()
    for event in events:
        ident = event["id"]
        if ident in ids:
            raise ValueError(f"Duplicate event ID: {ident}")
        ids.add(ident)
        start, end = date.fromisoformat(event["startDate"]), date.fromisoformat(event["endDate"])
        if end < start:
            raise ValueError(f"Reversed dates: {event['name']}")
        expected = "past" if event["endDate"] < as_of else "upcoming"
        if event["status"] != expected or event["month"] != start.month:
            raise ValueError(f"Date/status/month mismatch: {event['name']}")
        if event.get("url") is not None and not valid_url(event["url"]):
            raise ValueError(f"Invalid event URL: {event['name']}")
        if event.get("submissionStatus") not in {"open", "closed", "upcoming", "unknown"}:
            raise ValueError(f"Invalid submission status: {event['name']}")
    if data.get("summary") != event_summary(events, as_of):
        raise ValueError("Event summary does not match event rows")


def validate_bundle(directory):
    directory = Path(directory)
    data, history, summary = [read_json(directory / name) for name in
                              ("data.json", "history.json", "summary.json")]
    validate_events(data)
    if not all(x.get("snapshotId") == data.get("snapshotId") for x in (history, summary)):
        raise ValueError("Mixed event snapshot versions")
    if not data.get("snapshotId") or history.get("totalTracked") != len(data["events"]):
        raise ValueError("Missing snapshot ID or history count mismatch")
    monthly = {f"{m}월": sum(e["month"] == m for e in data["events"]) for m in range(1, 13)}
    actual = {key: value["total"] for key, value in summary.get("monthly", {}).items()}
    if actual != {k: v for k, v in monthly.items() if v}:
        raise ValueError("Monthly summary does not match event rows")
    steam = read_json(directory / "steam/data.json")
    if steam:
        games = steam.get("games", [])
        if not games or len({g["appid"] for g in games}) != len(games):
            raise ValueError("Empty Steam snapshot or duplicate appid")
        stats = steam["summary"]
        if stats["total"] != len(games) or stats["released"] != sum(g["status"] == "released" for g in games):
            raise ValueError("Steam summary does not match status rows")
        if stats["upcoming"] != sum(g["status"] == "upcoming" for g in games):
            raise ValueError("Steam upcoming count mismatch")
        for game in games:
            if game["status"] not in {"upcoming", "released"} or not valid_url(game.get("store_url")):
                raise ValueError(f"Invalid Steam record: {game['appid']}")
    return len(data["events"])
