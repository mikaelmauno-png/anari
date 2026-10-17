#!/usr/bin/env python3
"""Fetch NHL + MoneyPuck stats for the web app.

Writes:
  data/stats.json            current season totals (standings page)
  data/lastnight.json        results and stat lines from the last game night
  data/history/<date>.json   season totals through each Sunday (weekly chart)
  data/history/index.json    list of the weekly snapshot dates
  data/caphits.json          cap hits looked up on CapFreeze, ~10 players a day
  data/schedule.json         regular-season games in the next 7 days

Runs on a schedule in GitHub Actions (the NHL API and MoneyPuck don't allow
direct browser requests). Standard library only.
"""

import csv
import html
import io
import json
import os
import re
import unicodedata
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
HISTORY = os.path.join(DATA, "history")
LEAGUE = os.path.join(ROOT, "league.json")

STATS_API = "https://api.nhle.com/stats/rest/en"
WEB_API = "https://api-web.nhle.com/v1"
MONEYPUCK = "https://moneypuck.com/moneypuck/playerData/seasonSummary/{year}/regular/{kind}.csv"
MONEYPUCK_GOALIE_GAMES = "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/regular/goalies/{id}.csv"
FINAL_STATES = {"OFF", "FINAL"}
CAPFREEZE_PLAYERS = "https://capfreeze.com/players.html"
CAP_LOOKUPS_PER_DAY = 10


def get(url, retries=4, pause=0):
    req = urllib.request.Request(url, headers={"User-Agent": "anari-fantasy-tracker"})
    for attempt in range(retries):
        try:
            time.sleep(pause)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if attempt == retries - 1:
                raise
            limited = getattr(e, "code", None) == 429
            print(f"retry {url}: {e}", file=sys.stderr)
            time.sleep((30 if limited else 3) * (attempt + 1))


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def date_filter(start=None, end=None):
    """Extra cayenne expression limiting stats to a game date range."""
    expr = ""
    if start:
        expr += f' and gameDate>="{start}"'
    if end:
        expr += f' and gameDate<="{end}"'
    return expr


def stats_rest(kind, report, season, extra=""):
    expr = f"seasonId={season} and gameTypeId=2" + extra
    q = urllib.parse.urlencode({"limit": -1, "cayenneExp": expr})
    return json.loads(get(f"{STATS_API}/{kind}/{report}?{q}"))["data"]


def last_team(s):
    return (s.get("teamAbbrevs") or "").split(",")[-1].strip()


class Fetcher:
    """Caches lookups that several outputs share within one run."""

    def __init__(self, season):
        self.season = season
        self.mp_year = str(season)[:4]  # MoneyPuck labels 20262027 as 2026
        self._bios = None
        self._rookies = None
        self._goalie_games = {}
        self._goalies_season = None

    @property
    def bios(self):
        if self._bios is None:
            self._bios = {b["playerId"]: b for b in stats_rest("skater", "bios", self.season)}
        return self._bios

    @property
    def rookies(self):
        if self._rookies is None:
            rows = stats_rest("skater", "summary", self.season, " and isRookie=1")
            self._rookies = {r["playerId"] for r in rows}
        return self._rookies

    def skaters(self, through=None):
        summary = stats_rest("skater", "summary", self.season, date_filter(end=through))
        out = []
        for s in summary:
            bio = self.bios.get(s["playerId"], {})
            out.append({
                "id": s["playerId"],
                "name": s["skaterFullName"],
                "team": last_team(s),
                "pos": s.get("positionCode"),
                "gp": s.get("gamesPlayed", 0),
                "g": s.get("goals", 0),
                "p": s.get("points", 0),
                "pim": s.get("penaltyMinutes", 0),
                "nat": bio.get("nationalityCode"),
                "draft": bio.get("draftYear"),
                "rookie": s["playerId"] in self.rookies,
            })
        return out

    def goalies_season(self):
        """Current season GSAx for every goalie, from MoneyPuck's season summary."""
        if self._goalies_season is not None:
            return self._goalies_season
        text = get(MONEYPUCK.format(year=self.mp_year, kind="goalies"))
        out = []
        for row in csv.DictReader(io.StringIO(text)):
            if row["situation"] != "all":
                continue
            xg, ga = float(row["xGoals"]), float(row["goals"])
            out.append({
                "id": int(row["playerId"]), "name": row["name"], "team": row["team"],
                "gp": int(float(row["games_played"])),
                "xga": round(xg, 2), "ga": int(ga), "gsax": round(xg - ga, 2),
            })
        self._goalies_season = out
        return out

    def goalie_games(self, pid):
        """MoneyPuck per-game rows ("all" situations) for one goalie this season."""
        if pid not in self._goalie_games:
            try:
                # One file per goalie: space the requests out, MoneyPuck rate-limits
                text = get(MONEYPUCK_GOALIE_GAMES.format(id=pid), pause=2)
            except Exception as e:
                print(f"no MoneyPuck games for {pid}: {e}", file=sys.stderr)
                text = ""
            rows = []
            for row in csv.DictReader(io.StringIO(text)):
                if row["situation"] == "all" and row["season"] == self.mp_year:
                    d = row["gameDate"]
                    rows.append({
                        "date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
                        "xga": float(row["xGoals"]),
                        "ga": float(row["goals"]),
                    })
            self._goalie_games[pid] = rows
        return self._goalie_games[pid]

    def goalies_through(self, through):
        """GSAx through a date. Uses MoneyPuck's season summary when it covers
        exactly the games through that date (the usual Monday case), otherwise
        sums its per-game data. Returns None if MoneyPuck hasn't caught up yet."""
        nhl = stats_rest("goalie", "summary", self.season, date_filter(end=through))
        mp = {g["id"]: g for g in self.goalies_season()}
        if all(g["playerId"] in mp and mp[g["playerId"]]["gp"] == g["gamesPlayed"] for g in nhl):
            return [mp[g["playerId"]] for g in nhl]
        out = []
        for g in nhl:
            games = [r for r in self.goalie_games(g["playerId"]) if r["date"] <= through]
            if len(games) != g["gamesPlayed"]:
                print(f"MoneyPuck has {len(games)}/{g['gamesPlayed']} games for "
                      f"{g['goalieFullName']} through {through}", file=sys.stderr)
                return None
            xga = sum(r["xga"] for r in games)
            ga = sum(r["ga"] for r in games)
            out.append({
                "id": g["playerId"], "name": g["goalieFullName"], "team": last_team(g),
                "gp": g["gamesPlayed"], "xga": round(xga, 2), "ga": int(ga),
                "gsax": round(xga - ga, 2),
            })
        return out

    @staticmethod
    def teams(on=None):
        data = json.loads(get(f"{WEB_API}/standings/{on or 'now'}"))
        return [{
            "abbrev": t["teamAbbrev"]["default"],
            "name": t["teamName"]["default"],
            "gp": t["gamesPlayed"],
            "w": t["wins"], "l": t["losses"], "otl": t["otLosses"],
            "pts": t["points"],
            "ptsPct": t["pointPctg"],
            "rank": t["leagueSequence"],
            "conf": t["conferenceAbbrev"],
            "div": t["divisionAbbrev"],
            "divRank": t["divisionSequence"],
            "wcRank": t["wildcardSequence"],
            # Top 3 in the division or one of the conference's two wildcards
            "inPlayoffs": t["divisionSequence"] <= 3 or 1 <= t["wildcardSequence"] <= 2,
            # x/y/z/p = clinched, e = eliminated (only set late in the season)
            "clinch": t.get("clinchIndicator"),
        } for t in data["standings"]]


def scoreboard(day):
    return json.loads(get(f"{WEB_API}/score/{day}"))


def all_final(games):
    return bool(games) and all(g["gameState"] in FINAL_STATES for g in games)


# ---------- outputs ----------

def write_current(f):
    write_json(os.path.join(DATA, "stats.json"), {
        "season": f.season,
        "updated": now_iso(),
        "skaters": f.skaters(),
        "goalies": f.goalies_season(),
        "teams": f.teams(),
    })


def last_game_night():
    """The most recent date whose games have all finished, and its games."""
    board = scoreboard("now")
    if all_final(board["games"]):
        return board["currentDate"], board["games"]
    day = board.get("prevDate")
    while day:
        board = scoreboard(day)
        if all_final(board["games"]):
            return day, board["games"]
        day = board.get("prevDate")
    return None, []


def write_last_night(f):
    path = os.path.join(DATA, "lastnight.json")
    day, games = last_game_night()
    if not day:
        return
    old = read_json(path)
    if old and old["date"] == day and all(g["gsax"] is not None for g in old["goalies"]):
        return  # already complete for this night

    skaters = [{
        "id": s["playerId"], "name": s["skaterFullName"], "team": last_team(s),
        "g": s["goals"], "a": s["assists"], "p": s["points"], "pim": s["penaltyMinutes"],
    } for s in stats_rest("skater", "summary", f.season, date_filter(day, day))]

    done = {g["id"]: g for g in (old or {}).get("goalies", []) if old["date"] == day and g["gsax"] is not None}
    gp_through = {g["playerId"]: g["gamesPlayed"]
                  for g in stats_rest("goalie", "summary", f.season, date_filter(end=day))}
    mp_gp = {g["id"]: g["gp"] for g in f.goalies_season()}
    goalies = []
    for g in stats_rest("goalie", "summary", f.season, date_filter(day, day)):
        pid = g["playerId"]
        if pid in done:
            goalies.append(done[pid])
            continue
        ready = mp_gp.get(pid, 0) >= gp_through.get(pid, 1)
        game = [r for r in f.goalie_games(pid) if r["date"] == day] if ready else []
        goalies.append({
            "id": g["playerId"], "name": g["goalieFullName"], "team": last_team(g),
            "sa": g["shotsAgainst"], "sv": g["saves"], "ga": g["goalsAgainst"],
            "w": g["wins"], "l": g["losses"], "otl": g["otLosses"],
            # MoneyPuck may lag behind the NHL by a few hours; filled in on a later run
            "gsax": round(game[0]["xga"] - game[0]["ga"], 2) if game else None,
        })

    write_json(path, {
        "date": day,
        "updated": now_iso(),
        "games": [{
            "away": {"abbrev": g["awayTeam"]["abbrev"], "score": g["awayTeam"].get("score")},
            "home": {"abbrev": g["homeTeam"]["abbrev"], "score": g["homeTeam"].get("score")},
            "ending": (g.get("gameOutcome") or {}).get("lastPeriodType", "REG"),
        } for g in games],
        "skaters": skaters,
        "goalies": goalies,
    })


def write_weekly_snapshots(f):
    """A snapshot of season totals through every Sunday so far, built from
    date-filtered stats so missed runs and the season start can be backfilled."""
    index_path = os.path.join(HISTORY, "index.json")
    index = read_json(index_path) or []
    today = date.fromisoformat(scoreboard("now")["currentDate"])  # NHL (US Eastern) date
    start_year = int(str(f.season)[:4])
    sunday = date(start_year, 10, 1)
    sunday += timedelta(days=(6 - sunday.weekday()) % 7)
    changed = False
    while sunday < today:
        day = sunday.isoformat()
        sunday += timedelta(days=7)
        if day in index:
            continue
        games = scoreboard(day)["games"]
        if games and not all_final(games):
            print(f"snapshot {day}: games not final yet", file=sys.stderr)
            break
        skaters = f.skaters(through=day)
        if not skaters:
            continue  # season hadn't started
        goalies = f.goalies_through(day)
        if goalies is None:
            print(f"snapshot {day}: waiting for MoneyPuck", file=sys.stderr)
            break
        write_json(os.path.join(HISTORY, f"{day}.json"), {
            "season": f.season, "asOf": day, "updated": now_iso(),
            "skaters": skaters, "goalies": goalies, "teams": f.teams(on=day),
        })
        index.append(day)
        changed = True
        print(f"wrote snapshot through {day}")
    if changed or not os.path.exists(index_path):
        write_json(index_path, sorted(index))


def write_schedule():
    """Unplayed regular-season games over the next 7 days, starting from the
    first game that hasn't finished yet."""
    games, day, start = [], "now", None
    for _ in range(3):  # each response covers one week
        week = json.loads(get(f"{WEB_API}/schedule/{day}"))
        for d in week["gameWeek"]:
            for g in d["games"]:
                if g["gameType"] != 2 or g["gameState"] in FINAL_STATES:
                    continue
                start = start or d["date"]
                games.append({"date": d["date"], "away": g["awayTeam"]["abbrev"],
                              "home": g["homeTeam"]["abbrev"], "start": g["startTimeUTC"]})
        day = week.get("nextStartDate")
        if not day or (start and day > (date.fromisoformat(start) + timedelta(days=6)).isoformat()):
            break
    if start:
        end = (date.fromisoformat(start) + timedelta(days=6)).isoformat()
        games = [g for g in games if g["date"] <= end]
    else:
        end = None
    write_json(os.path.join(DATA, "schedule.json"),
               {"updated": now_iso(), "from": start, "to": end, "games": games})


# ---------- cap hits ----------

def norm(name):
    s = unicodedata.normalize("NFD", name)
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if not unicodedata.combining(c)).lower())


def last_name(full):
    parts = full.split(" ", 1)
    return norm(parts[1] if len(parts) > 1 else full)


def find_skater(key, skaters):
    """Same matching as the web app: id, "Name", "Last name" or "Name (TEAM)"."""
    key = str(key)
    if key.isdigit():
        return next((s for s in skaters if s["id"] == int(key)), None)
    m = re.match(r"^(.*?)\s*\(([A-Za-z]{2,3})\)\s*$", key)
    name, team = (norm(m.group(1)), m.group(2).upper()) if m else (norm(key), None)
    hits = [s for s in skaters if norm(s["name"]) == name] or [s for s in skaters if last_name(s["name"]) == name]
    if team and (len(hits) > 1 or any(s["team"] == team for s in hits)):
        hits = [s for s in hits if s["team"] == team]
    return hits[0] if len(hits) == 1 else None


def capfreeze_players():
    """Rows of CapFreeze's player contract table: name, team, cap hit (M), age."""
    page = get(CAPFREEZE_PLAYERS)
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
        if len(cells) < 5 or not cells[4].startswith("$"):
            continue
        rows.append({"name": cells[0], "team": cells[1], "age": cells[3],
                     "cap": round(int(re.sub(r"[^0-9]", "", cells[4])) / 1e6, 3)})
    return rows


def match_capfreeze(skater, rows):
    """By full name and team; falls back to last name and team for spelling
    differences (NHL "Fedor Svechkov" vs CapFreeze "Fyodor Svechkov")."""
    for test in (lambda r: norm(r["name"]) == norm(skater["name"]) and r["team"] == skater["team"],
                 lambda r: norm(r["name"]) == norm(skater["name"]),
                 lambda r: last_name(r["name"]) == last_name(skater["name"]) and r["team"] == skater["team"]):
        hits = [r for r in rows if test(r)]
        if len(hits) == 1:
            return hits[0]
    return None


def write_cap_lookups(league):
    """Look up a few players' cap hits a day: the highest scorers without a
    known cap hit who could still beat the cheapest known € per point."""
    path = os.path.join(DATA, "caphits.json")
    store = read_json(path) or {"source": "CapFreeze (capfreeze.com)", "players": {}, "notFound": {}}
    today = date.today().isoformat()
    if store.get("checked") == today:
        return

    stats = read_json(os.path.join(DATA, "stats.json"))
    skaters = stats["skaters"]
    by_id = {s["id"]: s for s in skaters}
    known = {}  # id -> cap in millions, or "ELC"
    for key, val in (league.get("capHits") or {}).items():  # manual entries win
        s = find_skater(key, skaters)
        if s:
            known[s["id"]] = val
    for pid, entry in store["players"].items():
        known.setdefault(int(pid), "ELC" if entry.get("elc") else entry["cap"])

    costs = [float(v) / by_id[pid]["p"] for pid, v in known.items()
             if str(v).upper() != "ELC" and pid in by_id and by_id[pid]["p"] > 0]
    best = min(costs) if costs else None
    min_cap = league.get("minCap", 0.85)
    retry_after = (date.today() - timedelta(days=7)).isoformat()
    todo = [s for s in skaters
            if s["id"] not in known and s["p"] > 0
            and store["notFound"].get(str(s["id"]), "") < retry_after
            and (best is None or min_cap / s["p"] < best)]
    todo.sort(key=lambda s: -s["p"])
    todo = todo[:CAP_LOOKUPS_PER_DAY]

    if todo:
        rows = capfreeze_players()
        draft_cutoff = int(str(league["season"])[:4]) - 3
        for s in todo:
            row = match_capfreeze(s, rows)
            if not row:
                store["notFound"][str(s["id"])] = today
                print(f"cap hit: no CapFreeze match for {s['name']} ({s['team']})", file=sys.stderr)
                continue
            # CapFreeze doesn't mark entry-level deals: a cheap contract for a rookie
            # or a recent draft pick is assumed to be one (confirm in league.json)
            elc = row["cap"] <= 1.1 and (s["rookie"] or (s.get("draft") or 0) >= draft_cutoff)
            store["players"][str(s["id"])] = {
                "name": s["name"], "team": s["team"], "cap": row["cap"], "elc": elc, "date": today,
            }
            store["notFound"].pop(str(s["id"]), None)
            print(f"cap hit: {s['name']} {row['cap']}M{' (ELC?)' if elc else ''}")

    store["checked"] = today
    store["updated"] = now_iso()
    write_json(path, store)


def main():
    league = read_json(LEAGUE)
    f = Fetcher(league["season"])
    write_current(f)
    write_last_night(f)
    write_weekly_snapshots(f)
    write_schedule()
    try:
        write_cap_lookups(league)
    except Exception as e:  # a CapFreeze hiccup shouldn't stop the stats update
        print(f"cap lookups failed: {e}", file=sys.stderr)
    print("done")


if __name__ == "__main__":
    main()
