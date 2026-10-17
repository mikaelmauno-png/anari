#!/usr/bin/env python3
"""Fetch current NHL + MoneyPuck stats and write them to data/stats.json.

Runs on a schedule in GitHub Actions (the NHL API and MoneyPuck don't allow
direct browser requests), and the web app reads the resulting JSON file.
Standard library only.
"""

import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "stats.json")
LEAGUE = os.path.join(ROOT, "league.json")

STATS_API = "https://api.nhle.com/stats/rest/en"
WEB_API = "https://api-web.nhle.com/v1"
MONEYPUCK = "https://moneypuck.com/moneypuck/playerData/seasonSummary/{year}/regular/{kind}.csv"


def get(url, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": "anari-fantasy-tracker"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"retry {url}: {e}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))


def stats_rest(report, season, extra=""):
    expr = f"seasonId={season} and gameTypeId=2" + extra
    q = urllib.parse.urlencode({"limit": -1, "cayenneExp": expr})
    return json.loads(get(f"{STATS_API}/skater/{report}?{q}"))["data"]


def fetch_skaters(season):
    summary = stats_rest("summary", season)
    bios = {b["playerId"]: b for b in stats_rest("bios", season)}
    rookies = {r["playerId"] for r in stats_rest("summary", season, " and isRookie=1")}
    skaters = []
    for s in summary:
        bio = bios.get(s["playerId"], {})
        skaters.append({
            "id": s["playerId"],
            "name": s["skaterFullName"],
            "team": (s.get("teamAbbrevs") or "").split(",")[-1].strip(),
            "pos": s.get("positionCode"),
            "gp": s.get("gamesPlayed", 0),
            "g": s.get("goals", 0),
            "p": s.get("points", 0),
            "pim": s.get("penaltyMinutes", 0),
            "nat": bio.get("nationalityCode"),
            "draft": bio.get("draftYear"),
            "rookie": s["playerId"] in rookies,
        })
    return skaters


def fetch_goalies(season):
    # MoneyPuck labels a season by its starting year: 20262027 -> 2026
    year = str(season)[:4]
    text = get(MONEYPUCK.format(year=year, kind="goalies"))
    goalies = []
    for row in csv.DictReader(io.StringIO(text)):
        if row["situation"] != "all":
            continue
        xg, ga = float(row["xGoals"]), float(row["goals"])
        goalies.append({
            "id": int(row["playerId"]),
            "name": row["name"],
            "team": row["team"],
            "gp": int(float(row["games_played"])),
            "xga": round(xg, 2),
            "ga": int(ga),
            "gsax": round(xg - ga, 2),
        })
    return goalies


def fetch_teams():
    data = json.loads(get(f"{WEB_API}/standings/now"))
    return [{
        "abbrev": t["teamAbbrev"]["default"],
        "name": t["teamName"]["default"],
        "logo": t.get("teamLogo"),
        "gp": t["gamesPlayed"],
        "w": t["wins"],
        "l": t["losses"],
        "otl": t["otLosses"],
        "pts": t["points"],
        "ptsPct": t["pointPctg"],
        "rank": t["leagueSequence"],
    } for t in data["standings"]]


def main():
    with open(LEAGUE, encoding="utf-8") as f:
        season = json.load(f)["season"]
    out = {
        "season": season,
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "skaters": fetch_skaters(season),
        "goalies": fetch_goalies(season),
        "teams": fetch_teams(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}: {len(out['skaters'])} skaters, "
          f"{len(out['goalies'])} goalies, {len(out['teams'])} teams")


if __name__ == "__main__":
    main()
