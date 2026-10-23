#!/usr/bin/env python3
"""
Steam Indie Watch — Track popular upcoming indie games on Steam.

Queries Steam search for indie-tagged games across three filters:
  - popularwishlist: the REAL wishlist ranking (relative order, no absolute counts)
  - comingsoon:      date-ordered upcoming releases
  - popularnew:      recently released popular games
Fetches metadata via appdetails API and detects changes vs. previous runs.

Usage:
  python3 steam_indie_watch.py [--output /path/to/data/] [--count 50]
"""

import json, re, os, sys, argparse, time
from datetime import datetime
from pathlib import Path
from tracker_common import STATE_DIR, read_json, snapshot_id, today_kst, utc_now, write_json
from collections import OrderedDict

# ── Config ──────────────────────────────────────────────────
STEAM_SEARCH_URL = "https://store.steampowered.com/search/results/"
STEAM_APPDETAIL_URL = "https://store.steampowered.com/api/appdetails"
OUTPUT_DIR = "/tmp/steam-tracker"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
TODAY = today_kst()


def fetch_search_results(filter_type="comingsoon", count=50):
    """Fetch indie games from Steam search.

    filter_type: 'popularwishlist' (most-wishlisted, relative ranking only)
                 'comingsoon'      (unreleased, date-ordered)
                 'popularnew'      (recently released, ranked by popularity)
    """
    import requests
    params = {
        "query": "",
        "term": "",
        "filter": filter_type,
        "tags": "492",        # Indie
        "ndl": "1",
        "ignore_preferences": "1",
        "count": str(count),
    }
    
    print(f"Fetching Steam search (filter={filter_type} + indie, top {count})...")
    r = requests.get(STEAM_SEARCH_URL, params=params, headers=HEADERS, timeout=30)
    r.raise_for_status()
    
    html = r.text
    
    # Keep fields inside their own result row; missing reviews must not shift rows.
    import html as html_module
    blocks = re.findall(r'<a\b[^>]*class="[^"]*\bsearch_result_row\b[^"]*"[^>]*>.*?</a>', html, re.S)
    games = []
    for block in blocks:
        appid = re.search(r'data-ds-appid="(\d+)"', block)
        name = re.search(r'<span class="title">([^<]+)</span>', block)
        if not appid or not name:
            continue  # exclude packages/bundles without one appid
        release = re.search(r'<div class="[^"]*search_released[^"]*">\s*(.*?)\s*</div>', block, re.S)
        review = re.search(r'data-tooltip-html="([^"]+)"', block)
        tooltip = html_module.unescape(review[1]) if review else ''
        tooltip = re.split(r'<br\s*/?>', tooltip)[0]
        games.append({"steam_rank": len(games) + 1, "appid": int(appid[1]),
                      "name": html_module.unescape(name[1]),
                      "release_date": html_module.unescape(release[1].strip()) if release else '',
                      "review_summary": re.sub(r'<[^>]+>', '', tooltip)})

    print(f"  Found {len(games)} games in search results")
    return games


def fetch_appdetails(appid, retries=2):
    """Fetch detailed app info from Steam API."""
    import requests
    for attempt in range(retries):
        try:
            r = requests.get(
                STEAM_APPDETAIL_URL,
                params={"appids": appid, "l": "english"},
                headers=HEADERS,
                timeout=15,
            )
            if r.status_code == 429:
                wait = 5 * (attempt + 1)
                print(f"  Rate limited for {appid}, waiting {wait}s...")
                time.sleep(wait)
                continue
            r.raise_for_status()
            data = r.json()
            
            app_data = data.get(str(appid), {})
            if not app_data.get("success", False):
                return None
            
            details = app_data.get("data", {})
            return {
                "appid": appid,
                "name": details.get("name", ""),
                "type": details.get("type", ""),
                "is_free": details.get("is_free", False),
                "developers": details.get("developers", []),
                "publishers": details.get("publishers", []),
                "genres": [g["description"] for g in details.get("genres", [])],
                "categories": [c["description"] for c in details.get("categories", [])],
                "release_date": details.get("release_date", {}).get("date", ""),
                "coming_soon": details.get("release_date", {}).get("coming_soon", False),
                "short_description": (details.get("short_description", "") or "")[:200],
                "header_image": details.get("header_image", ""),
                "recommendations": details.get("recommendations", {}),
            }
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(3)
            else:
                print(f"  Failed to fetch app {appid}: {e}")
    return None


METADATA_FIELDS = ("developers", "publishers", "genres", "is_free", "coming_soon",
                   "short_description", "header_image", "recommendations", "metadataCheckedAt")


def enrich_games(games, max_details=20, previous=None):
    """Reuse per-app metadata and rotate the request budget through missing/stale apps."""
    previous_by_id = {g["appid"]: g for g in (previous or [])}
    for game in games:
        cached = previous_by_id.get(game["appid"], {})
        for key in METADATA_FIELDS:
            if key in cached:
                game[key] = cached[key]
        game["metadataStatus"] = "cached" if "genres" in game else "missing"
    ordered = sorted(games, key=lambda g: ("genres" in g,
                     g.get("metadataCheckedAt", ""), g.get("source") != "recent_release"))
    for game in ordered[:max_details]:
        print(f"  Fetching metadata: {game['appid']} {game['name'][:50]}...")
        details = fetch_appdetails(game["appid"])
        time.sleep(1.5)
        if not details:
            game["metadataStatus"] = "cached_after_error" if "genres" in game else "failed"
            continue
        for key in METADATA_FIELDS:
            if key in details:
                game[key] = details[key]
        if not game.get("release_date"):
            game["release_date"] = details.get("release_date", "")
        recs = details.get("recommendations", {})
        game["recommendations"] = recs.get("total", 0) if isinstance(recs, dict) else recs
        game["metadataCheckedAt"] = utc_now()
        game["metadataStatus"] = "complete"
    return games


def load_previous(output_dir):
    """Load yesterday's data for comparison."""
    path = os.path.join(output_dir, "data.json")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            pass
    return {"generatedAt": "", "games": [], "summary": {}}


def detect_changes(prev_data, current_games):
    """Compare with previous run and detect changes."""
    prev_games = {g["appid"]: g for g in prev_data.get("games", [])}
    curr_games = {g["appid"]: g for g in current_games}
    
    changes = []
    
    # New entries (appeared in top N that weren't there before)
    prev_ids = set(prev_games.keys())
    curr_ids = set(curr_games.keys())
    new_ids = curr_ids - prev_ids
    dropped_ids = prev_ids - curr_ids
    
    for appid in new_ids:
        g = curr_games[appid]
        changes.append({
            "date": TODAY,
            "type": "new_entry",
            "appid": appid,
            "name": g["name"],
            "detail": f"Steam 인디 다가오는 게임 Top {len(current_games)} 신규 진입 (랭크 #{g['steam_rank']})",
        })
    
    # Dropped out
    for appid in dropped_ids:
        g = prev_games[appid]
        changes.append({
            "date": TODAY,
            "type": "dropped",
            "appid": appid,
            "name": g["name"],
            "detail": f"Top {len(current_games)}에서 이탈 (이전 랭크 #{g['steam_rank']})",
        })
    
    # Rank changes (moved up/down more than 5 positions)
    for appid in curr_ids & prev_ids:
        prev_rank = prev_games[appid].get("steam_rank", 0)
        curr_rank = curr_games[appid].get("steam_rank", 0)
        diff = prev_rank - curr_rank  # positive = moved up
        if abs(diff) >= 5:
            direction = "↑" if diff > 0 else "↓"
            changes.append({
                "date": TODAY,
                "type": "rank_change",
                "appid": appid,
                "name": curr_games[appid]["name"],
                "detail": f"랭크 변동: #{prev_rank} → #{curr_rank} ({direction}{abs(diff)})",
            })
    
    # Release date changes
    for appid in curr_ids & prev_ids:
        prev_date = prev_games[appid].get("release_date", "")
        curr_date = curr_games[appid].get("release_date", "")
        if prev_date and curr_date and prev_date != curr_date:
            changes.append({
                "date": TODAY,
                "type": "date_change",
                "appid": appid,
                "name": curr_games[appid]["name"],
                "detail": f"출시일 변경: {prev_date} → {curr_date}",
            })
    
    # Status change: coming_soon → released
    for appid in curr_ids & prev_ids:
        prev = prev_games[appid]
        curr = curr_games[appid]
        if prev.get("coming_soon") and not curr.get("coming_soon"):
            changes.append({
                "date": TODAY,
                "type": "released",
                "appid": appid,
                "name": curr["name"],
                "detail": f"출시 완료! ({curr.get('release_date', '')})",
            })
    
    return changes


def build_summary(games):
    """Build summary statistics."""
    from collections import Counter
    
    genre_counts = Counter()
    dev_counts = Counter()
    free_count = 0
    released_count = 0
    wishlisted_count = 0
    
    for g in games:
        for genre in g.get("genres", []):
            genre_counts[genre] += 1
        for dev in g.get("developers", []):
            dev_counts[dev] += 1
        if g.get("is_free"):
            free_count += 1
        if g.get("status") == "released":
            released_count += 1
        if g.get("wishlist_rank"):
            wishlisted_count += 1
    
    return {
        "total": len(games),
        "free_games": free_count,
        "released": released_count,
        "upcoming": len(games) - released_count,
        "wishlisted": wishlisted_count,
        "genreCount": len(genre_counts),
        "metadataMissing": sum("genres" not in g for g in games),
        "metadataKnown": sum("genres" in g for g in games),
        "top_genres": genre_counts.most_common(5),
        "top_developers": dev_counts.most_common(5),
    }


def filter_recent_releases(games, days=30):
    """Keep only games with release dates within the last N days."""
    from datetime import datetime, timedelta
    cutoff = datetime.now() - timedelta(days=days)
    recent = []
    for g in games:
        date_str = g.get("release_date", "")
        if not date_str:
            # No date = keep (likely upcoming)
            recent.append(g)
            continue
        # Try to parse various date formats from Steam
        for fmt in ["%d %b, %Y", "%b %d, %Y", "%B %d, %Y", "%d %B, %Y",
                     "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"]:
            try:
                dt = datetime.strptime(date_str.strip(), fmt)
                if dt >= cutoff:
                    recent.append(g)
                break
            except ValueError:
                continue
        else:
            # Couldn't parse date, keep it
            recent.append(g)
    return recent


def main():
    parser = argparse.ArgumentParser(description="Steam Indie Watch — track upcoming indie games")
    parser.add_argument("--output", default=OUTPUT_DIR, help="Output directory")
    parser.add_argument("--count", type=int, default=30, help="Games per filter")
    parser.add_argument("--max-details", type=int, default=20, help="Max appdetails API calls")
    parser.add_argument("--no-details", action="store_true", help="Skip appdetails API calls")
    parser.add_argument("--days", type=int, default=30, help="Recent release window in days")
    parser.add_argument("--state-dir", default=str(STATE_DIR))
    parser.add_argument("--baseline-dir", help="Existing published Steam data directory")
    args = parser.parse_args()
    
    os.makedirs(args.output, exist_ok=True)
    prev = read_json(Path(args.state_dir) / "steam/data.json")
    if not prev:
        prev = load_previous(args.baseline_dir or args.output)
    
    # 1. Fetch top wishlisted games (the REAL Steam wishlist ranking — relative order)
    top_wishlisted = fetch_search_results(filter_type="popularwishlist", count=args.count)
    for g in top_wishlisted:
        g["wishlist_rank"] = g["steam_rank"]  # capture wishlist position

    # 2. Fetch coming soon games (date-ordered upcoming releases)
    coming_soon = fetch_search_results(filter_type="comingsoon", count=args.count)

    # 3. Fetch popular new games (recently released, ranked by popularity)
    popular_new = fetch_search_results(filter_type="popularnew", count=args.count)
    popular_new = filter_recent_releases(popular_new, days=args.days)

    # 4. Merge: top_wishlisted → coming_soon → popular_new (dedup, first-wins priority)
    merged = {}
    for g in top_wishlisted:
        g["source"] = "top_wishlisted"
        merged[g["appid"]] = g
    for g in coming_soon:
        g["source"] = "coming_soon"
        merged.setdefault(g["appid"], g)  # keep wishlisted version if already present
    for g in popular_new:
        g["source"] = "recent_release"
        merged.setdefault(g["appid"], g)
    games = list(merged.values())

    print(f"\nMerged: {len(top_wishlisted)} wishlisted + {len(coming_soon)} coming soon + {len(popular_new)} recent ({len(games)} unique)")
    
    if not games:
        print("No games found", file=sys.stderr)
        sys.exit(1)
    
    # 5. Enrich with appdetails
    if not args.no_details:
        games = enrich_games(games, max_details=args.max_details, previous=prev.get("games", []))
    
    # 6. Tag status and source
    from datetime import datetime
    cutoff = datetime.now()
    for g in games:
        if g.get("source") in ("coming_soon", "top_wishlisted") and g.get("coming_soon", True):
            g["status"] = "upcoming"
        else:
            g["status"] = "released"
        # Add store URL
        g["store_url"] = f"https://store.steampowered.com/app/{g['appid']}/"

    # NOTE: Steam follower/wishlist ABSOLUTE counts are NOT publicly available
    # (partner-API only, confirmed via SteamTracking schema audit 2026-08-13).
    # The popularwishlist filter gives the RELATIVE wishlist ranking (wishlist_rank)
    # for free — this is the best available proxy. Recommendations (appdetails API)
    # covers released games.
    
    # 7. Load previous data & detect changes
    changes = detect_changes(prev, games) if prev.get("games") else []
    if changes:
        print(f"Changes: {len(changes)}")
        for c in changes[:10]:
            print(f"  {c['type']}: {c['detail']}")
        if len(changes) > 10:
            print(f"  ... and {len(changes) - 10} more")
    
    # 8. Build data.json
    data = {
        "generatedAt": utc_now(),
        "games": games,
        "summary": build_summary(games),
    }
    
    data["snapshotId"] = snapshot_id([data["generatedAt"], games])
    existing_history = read_json(Path(args.state_dir) / "steam/history.json") or read_json(
        Path(args.baseline_dir or args.output) / "history.json", {"changes": []})
    existing_history["changes"] = changes + existing_history.get("changes", [])
    existing_history.update(updatedAt=data["generatedAt"], snapshotId=data["snapshotId"])
    write_json(Path(args.output) / "data.json", data)
    write_json(Path(args.output) / "history.json", existing_history)
    print(f"Wrote {len(games)} games; missing metadata={data['summary']['metadataMissing']}; changes={len(changes)}")

    print("Done.")


if __name__ == "__main__":
    main()
