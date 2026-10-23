#!/usr/bin/env python3
"""
Build dashboard data files from the Google Drive calendar.

Reads the indie game event calendar from Google Drive,
parses confirmed/tentative events, and generates:
  - data.json    : all events with structured metadata
  - history.json : recent changes (new discoveries, confirmations)
  - summary.json : monthly stats and weekly digest

Usage:
  python3 build_dashboard_data.py [--output /path/to/data/] [--calendar-id FILE_ID]

Output directory defaults to /tmp/tracker-dashboard/data/
"""

import json, re, os, sys, argparse
from datetime import date, datetime, timedelta
from tracker_common import (STATE_DIR, event_summary, read_json, snapshot_id, today_kst,
                            utc_now, valid_url, validate_events, write_json)
from collections import Counter
from pathlib import Path

# ── Config ──────────────────────────────────────────────────
TOKEN_PATH = os.path.expanduser("~/.hermes/google_token.json")
CLIENT_SECRET_PATH = os.path.expanduser("~/.hermes/google_client_secret.json")
CALENDAR_FILE_ID = os.environ.get("INDIE_TRACKER_CALENDAR_ID", "")
HISTORY_PATH = None  # set by --history-path; if None, auto-detect from --output
OUTPUT_DIR = "/tmp/tracker-dashboard/data"
TODAY = today_kst()
CUTOFF_30 = (date.fromisoformat(TODAY) + timedelta(days=30)).isoformat()

# ── Event type mapping ──────────────────────────────────────
# Priority-ordered: longer/more specific keys first to avoid partial matches.
# Keys are matched case-insensitively against event names.
EVENT_TYPE_MAP = {
    # === 전시회 (Expo/Exhibition) ===
    'コウゲイゲームショウ': '전시회', 'ゲームパビリオン': '전시회',
    'GAME PIT TOKYO': '전시회', 'ゲームダンジョン': '전시회',
    'Game Dungeon': '전시회', 'TGS': '전시회', 'G-STAR': '전시회',
    'PlayX4': '전시회', 'ChinaJoy': '전시회', 'WePlay': '전시회',
    'INDIE Live Expo': '전시회', 'gamescom asia': '전시회',
    '게임파빌리온': '전시회', 'Seoul Game Town': '전시회', 'GXG': '전시회',
    '보도테크': '전시회', '즈쿠즈쿠': '전시회', 'デジゲー博': '전시회',
    '차이나조이': '전시회', '도쿄게임쇼': '전시회', 'INDIE GAME SHOWCASE': '전시회',
    'ゲームアイランド': '전시회', 'SANUKI X GAME': '전시회',
    'ゲームラビリンス': '전시회', 'HORROR GALLERY': '전시회',
    # ── suffix-based 전시회 ──
    'EXPO': '전시회', 'フェア': '전시회', '페어': '전시회',
    # === 페스티벌 (Festival) ===
    'ホッカイドウシュピールフェスト': '페스티벌', 'DREAMSCAPE': '페스티벌',
    'SHIBUYA GAMES WEEK': '페스티벌', 'BitSummit': '페스티벌',
    'BIC': '페스티벌', 'SIGF': '페스티벌', 'BEAVER ROCKS': '페스티벌',
    'Bilibili World': '페스티벌', 'Seoul POPCON': '페스티벌',
    'AKIBA 서브컬처 서밋': '페스티벌', 'Akibaサブカルサミット': '페스티벌',
    '九州学生ゲーム大祭': '페스티벌', 'ILLUSTAR': '페스티벌',
    'OTAFEST': '페스티벌', 'Comic Fiesta': '페스티벌', 'AGF': '페스티벌',
    '京まふ': '페스티벌', '全国エンタメまつり': '페스티벌',
    'OPEN GAME FEST': '페스티벌',
    # ── suffix-based 페스티벌 ──
    'フェス': '페스티벌', 'FES': '페스티벌', 'FEST': '페스티벌',
    'Fiesta': '페스티벌', 'まつり': '페스티벌', 'Con': '페스티벌',
    '文化祭': '페스티벌', 'ゲームホリデー': '페스티벌',
    # === 마켓 (Market) ===
    'Game Market': '마켓', 'KCCF': '마켓',
    'インディゲームマーケット': '마켓', 'そうさくマーケット': '마켓',
    # === 동인 (Doujin) ===
    'Comiket': '동인', 'COMITIA': '동인',
    # === 컨퍼런스 (Conference) ===
    'TIGS': '컨퍼런스', 'CiGA': '컨퍼런스', 'CEDEC': '컨퍼런스',
    '게임메이커즈': '컨퍼런스', '게임메이커즈 스크램블': '컨퍼런스',
    'サミット': '컨퍼런스', 'SUMMIT': '컨퍼런스',
    'Developers Conference': '컨퍼런스', 'Devs Digger': '컨퍼런스',
    '인디크래프트 네트워킹': '컨퍼런스',
    # === 공모전 (Contest) ===
    'GIGDC': '공모전', 'IndieCraft': '공모전', '인디크래프트': '공모전',
    'ゲームクリエイター甲子園': '공모전', '神ゲー創造主': '공모전',
    'indiePlay': '공모전',
    # === 게임잼 (Game Jam) ===
    'Build051': '게임잼',
    # === 온라인 이벤트 ===
    'RTAリレー': '페스티벌', 'MY GAME FES': '페스티벌',
    # === 체험형/기타 특수 ===
    '이스케이프 룸': '전시회', 'Dissonance': '전시회',
    '대전콘텐츠페어': '전시회', 'CCG EXPO': '전시회',
}

TYPE_EN_TO_KR = {
    '전시회': 'expo', '페스티벌': 'festival', '마켓': 'market',
    '동인': 'doujin', '컨퍼런스': 'conference', '공모전': 'contest',
    '게임잼': 'gamejam', '기타': 'other'
}


# ── Google Drive helpers ────────────────────────────────────
def get_drive_token():
    """Get a valid Drive access token, refreshing if needed."""
    with open(TOKEN_PATH) as f:
        t = json.load(f)
    # Quick check — try a lightweight call
    import requests
    r = requests.get(
        "https://www.googleapis.com/drive/v3/about",
        params={"fields": "user"},
        headers={"Authorization": f"Bearer {t['token']}"},
        timeout=10
    )
    if r.status_code == 401:
        # Refresh
        with open(CLIENT_SECRET_PATH) as f:
            cs = json.load(f)
        rr = requests.post("https://oauth2.googleapis.com/token", data={
            "client_id": cs["installed"]["client_id"],
            "client_secret": cs["installed"]["client_secret"],
            "refresh_token": t["refresh_token"],
            "grant_type": "refresh_token"
        })
        if rr.ok:
            t["token"] = rr.json()["access_token"]
            with open(TOKEN_PATH, "w") as f:
                json.dump(t, f)
        else:
            raise RuntimeError(f"Token refresh failed: {rr.json()}")
    return t["token"]


def download_calendar(file_id=CALENDAR_FILE_ID):
    """Download calendar file from Drive, return text content."""
    if not file_id:
        raise ValueError("Pass --calendar-id or use --no-drive --calendar-file")
    import requests
    token = get_drive_token()
    r = requests.get(
        f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15
    )
    r.raise_for_status()
    raw = r.content
    for enc in ["utf-8", "utf-8-sig"]:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1").encode("latin-1").decode("utf-8")


# ── URL cleaning ────────────────────────────────────────────
def clean_url(raw):
    """Only publish usable HTTP(S) addresses; calendar notes are not URLs."""
    raw = (raw or "").strip()
    match = re.fullmatch(r'\[.*?\]\((https?://[^\s)]+)\)', raw)
    value = match[1] if match else raw
    return value if valid_url(value) else None


# ── Parsing helpers ─────────────────────────────────────────
def clean_name(name_str):
    return re.sub(r'\*\*([^*]+)\*\*', r'\1', name_str).strip()


def parse_country(country_str):
    if "한국" in country_str: return "KR", "🇰🇷 한국"
    elif "일본" in country_str: return "JP", "🇯🇵 일본"
    elif "중국" in country_str: return "CN", "🇨🇳 중국"
    elif "온라인" in country_str or "🌏" in country_str: return "ONLINE", "🌏 온라인"
    elif "대만" in country_str: return "TW", "🇹🇼 대만"
    elif "태국" in country_str: return "TH", "🇹🇭 태국"
    return "OTHER", country_str


def parse_date(date_str, year=None):
    """Parse M/D, M/D-D, M/D-M/D, and ISO dates without partial matches."""
    year = year or date.fromisoformat(TODAY).year
    value = re.sub(r'[✅🆕⚠️🔴🟢*]', '', date_str)
    value = re.split(r'[（(]', value)[0].strip()
    if re.fullmatch(r'\d{1,2}월\s*중', value):
        return None, None
    iso = re.fullmatch(r'(\d{4}-\d{2}-\d{2})(?:\s*[～~–]\s*(\d{4}-\d{2}-\d{2}))?', value)
    if iso:
        start = date.fromisoformat(iso[1])
        end = date.fromisoformat(iso[2]) if iso[2] else None
    else:
        match = re.fullmatch(r'(\d{1,2})/(\d{1,2})(?:\s*[～~–-]\s*(?:(\d{1,2})/)?(\d{1,2}))?', value)
        if not match:
            raise ValueError(f"Unrecognized calendar date: {date_str!r}")
        month, day = int(match[1]), int(match[2])
        start = date(year, month, day)
        end = None
        if match[4]:
            end_month = int(match[3]) if match[3] else month
            end_year = year + int(bool(match[3]) and end_month < month)
            end = date(end_year, end_month, int(match[4]))
    if end and end < start:
        raise ValueError(f"Reversed calendar date: {date_str!r}")
    return start.isoformat(), end.isoformat() if end else None


def submission_status(text):
    if not text:
        return "unknown"
    if re.search(r'마감|종료|closed', text, re.I):
        return "closed"
    if re.search(r'접수중|모집중|受付中|募集中', text, re.I):
        return "open"
    if re.search(r'예정', text):
        return "upcoming"
    return "unknown"


def detect_event_type(name):
    """Detect event type from name using EVENT_TYPE_MAP."""
    for key, val in EVENT_TYPE_MAP.items():
        if key.lower() in name.lower():
            return val
    return "기타"


def parse_calendar_events(cal_text):
    """Parse confirmed events from the calendar markdown."""
    # Find confirmed table
    conf_start = cal_text.find("## 🟢 확정 일정")
    conf_end = cal_text.find("## 🟡 연례", conf_start)
    if conf_end == -1:
        conf_end = cal_text.find("## 🧭", conf_start)
    if conf_start == -1:
        return []

    conf_section = cal_text[conf_start:conf_end if conf_end != -1 else None]
    lines = conf_section.split("\n")

    in_table = False
    events = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|---"):
            in_table = True
            continue
        if in_table and (stripped.startswith("## ") or stripped == "---"):
            break
        if not stripped:
            continue
        if in_table and stripped.startswith("|"):
            cols = [c.strip() for c in stripped.strip("|").split("|")]
            if len(cols) == 7:  # legacy calendar without a submission column
                cols.insert(6, "")
            if cols and cols[0] == "월":
                continue
            if len(cols) >= 3:
                events.append(cols)
    return events


def build_events(calendar_rows, previous=None, year=None):
    """Build structured event list from raw calendar rows."""
    parsed = []
    previous_ids = {(e["countryCode"], e["name"]): e["id"] for e in (previous or [])}
    for idx, row in enumerate(calendar_rows):
        if len(row) < 3:
            continue
        month_label = row[0]
        date_str = row[1]
        name_full = row[2] if len(row) > 2 else ""
        country_str = row[3] if len(row) > 3 else ""
        venue = row[4] if len(row) > 4 else ""
        type_str = row[5] if len(row) > 5 else ""
        submission = row[6] if len(row) > 6 else ""
        url_raw = row[7] if len(row) > 7 else ""

        name_clean = clean_name(name_full)
        start_date, end_date = parse_date(date_str, year=year)
        if not start_date:
            continue

        country_code, country_label = parse_country(country_str)
        etype_label = detect_event_type(name_clean)
        etype = TYPE_EN_TO_KR.get(etype_label, "other")

        status = "past" if end_date and end_date < TODAY else (
            "past" if start_date < TODAY and not end_date else "upcoming"
        )

        parsed.append({
            "id": previous_ids.get((country_code, name_clean)) or "evt-" + snapshot_id([country_code, name_clean]),
            "name": name_clean,
            "country": country_label,
            "countryCode": country_code,
            "startDate": start_date,
            "endDate": end_date or start_date,
            "venue": venue,
            "type": etype,
            "typeLabel": etype_label,
            "submissionPeriod": submission if submission and submission != "미확인" else "",
            "submissionStatus": submission_status(submission),
            "url": clean_url(url_raw),
            "status": status,
            "month": date.fromisoformat(start_date).month,
        })
    parsed.sort(key=lambda e: e["startDate"])
    return parsed


def load_history(history_path):
    """Load existing history.json or return empty template."""
    if history_path and os.path.exists(history_path):
        try:
            with open(history_path, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            pass
    return {"updatedAt": "", "events": [], "totalTracked": 0}


def merge_history(existing_hist, new_events, prev_events):
    """Detect changes between previous and new event lists, append to history."""
    prev_ids = {e["id"]: e for e in (prev_events or [])}
    new_ids = {e["id"]: e for e in new_events}
    if prev_events is None:
        existing_hist["baselineCreatedAt"] = utc_now()
        existing_hist["totalTracked"] = len(new_events)
        return existing_hist

    changes = []

    # New events
    for ident, ev in new_ids.items():
        if ident not in prev_ids:
            changes.append({
                "date": TODAY,
                "type": "discovered",
                "eventId": ev["id"],
                "name": ev["name"],
                "detail": f"신규 발견 ({ev['country']})",
                "country": ev["country"],
            })

    # Date changes
    for ident, ev in new_ids.items():
        if ident in prev_ids:
            prev = prev_ids[ident]
            if (prev["startDate"], prev["endDate"]) != (ev["startDate"], ev["endDate"]):
                changes.append({
                    "date": TODAY,
                    "type": "changed",
                    "eventId": ev["id"],
                    "name": ev["name"],
                    "detail": f"일정 변경: {prev['startDate']}–{prev['endDate']} → {ev['startDate']}–{ev['endDate']}",
                    "country": ev["country"],
                })

    # Submission changes
    for ident, ev in new_ids.items():
        if ident in prev_ids:
            prev = prev_ids[ident]
            if prev.get("submissionPeriod", "") != ev.get("submissionPeriod", ""):
                changes.append({
                    "date": TODAY,
                    "type": "confirmed",
                    "eventId": ev["id"],
                    "name": ev["name"],
                    "detail": f"접수 기간 확정: {ev['submissionPeriod']}",
                    "country": ev["country"],
                })

    existing_hist["events"] = changes + existing_hist["events"]
    existing_hist["updatedAt"] = utc_now()
    existing_hist["totalTracked"] = len(new_events)
    return existing_hist


def build_summary(events):
    """Build summary.json from event list."""
    monthly = {}
    for m in range(1, 13):
        month_events = [e for e in events if e["month"] == m]
        if month_events:
            month_countries = Counter(e["countryCode"] for e in month_events)
            monthly[f"{m}월"] = {
                "total": len(month_events),
                "byCountry": dict(month_countries),
                "events": [
                    {"name": e["name"], "startDate": e["startDate"],
                     "endDate": e["endDate"], "type": e["typeLabel"],
                     "country": e["countryCode"]}
                    for e in month_events
                ],
            }

    return {
        "generatedAt": utc_now(),
        "kstDate": TODAY,
        "monthly": monthly,
        "weekly": {
            "newDiscoveries": 0,  # filled by cron context
            "dateChanges": 0,
            "submissionUpdates": 0,
            "totalChanges": 0,
            "note": "",
        },
    }


# ── Main ────────────────────────────────────────────────────
def main():
    global TODAY
    parser = argparse.ArgumentParser(description="Build validated dashboard data from the calendar")
    parser.add_argument("--output", default=OUTPUT_DIR)
    parser.add_argument("--calendar-id", default=CALENDAR_FILE_ID)
    parser.add_argument("--no-drive", action="store_true")
    parser.add_argument("--calendar-file", default="/tmp/calendar.md")
    parser.add_argument("--state-dir", default=str(STATE_DIR))
    parser.add_argument("--baseline-dir", help="Published data to use when no successful state exists")
    parser.add_argument("--as-of", default=today_kst(), help="KST date, YYYY-MM-DD")
    parser.add_argument("--year", type=int, help="Calendar year; inferred from its title otherwise")
    parser.add_argument("--allow-removals", action="store_true", help="Allow reviewed removal of existing events")
    args = parser.parse_args()
    TODAY = date.fromisoformat(args.as_of).isoformat()
    out = Path(args.output)
    state = Path(args.state_dir) / "events"
    baseline = Path(args.baseline_dir) if args.baseline_dir else out
    previous = read_json(state / "data.json") or read_json(baseline / "data.json")
    existing_hist = read_json(state / "history.json") or read_json(baseline / "history.json") or {"events": []}
    cal_text = Path(args.calendar_file).read_text(encoding="utf-8-sig") if args.no_drive else download_calendar(args.calendar_id)
    title_year = re.search(r"20[0-9]{2}", cal_text.splitlines()[0] if cal_text else "")
    year = args.year or (int(title_year[0]) if title_year else date.fromisoformat(TODAY).year)
    rows = parse_calendar_events(cal_text)
    if not rows:
        raise ValueError("No confirmed rows found; refusing to publish")
    prev_events = previous.get("events", []) if previous else None
    events = build_events(rows, prev_events, year)
    if previous and not args.allow_removals:
        missing = {e["id"] for e in prev_events} - {e["id"] for e in events}
        if missing:
            raise ValueError(f"{len(missing)} previously tracked events missing; review before --allow-removals")
    generated = utc_now()
    snap = snapshot_id([generated, events])
    data = {"generatedAt": generated, "asOfDate": TODAY, "snapshotId": snap,
            "events": events, "summary": event_summary(events, TODAY)}
    validate_events(data)
    history = merge_history(existing_hist, events, prev_events)
    history.update(updatedAt=generated, snapshotId=snap, totalTracked=len(events))
    summary = build_summary(events)
    summary.update(generatedAt=generated, snapshotId=snap)
    recent = [change for change in history["events"] if change["date"] >=
              (date.fromisoformat(TODAY) - timedelta(days=6)).isoformat()]
    summary["weekly"].update(newDiscoveries=sum(c["type"] == "discovered" for c in recent),
                              dateChanges=sum(c["type"] == "changed" for c in recent),
                              submissionUpdates=sum(c["type"] == "confirmed" for c in recent),
                              totalChanges=len(recent))
    for name, value in [("data.json", data), ("history.json", history), ("summary.json", summary)]:
        write_json(out / name, value)
    print(f"Validated {len(events)} events; upcoming={data['summary']['upcomingEvents']}; snapshot={snap}")
    print("State advances only after a successful publish")


if __name__ == "__main__":
    from pathlib import Path
    main()
