#!/usr/bin/env python3
"""Fetch NHL + MoneyPuck stats for the web app.

Writes:
  data/stats.json            current season totals (standings page)
  data/lastnight.json        results and stat lines from the last game night
  data/history/<date>.json   season totals through each Sunday (weekly chart)
  data/history/index.json    list of the weekly snapshot dates
  data/caphits.json          cap hits looked up on CapFreeze, ~10 players a day
  data/schedule.json         regular-season games in the next 7 days
  data/seasons/<season>/     final stats and league file, saved once the regular season ends
  data/gamelogs.json         game-by-game lines for every picked player and team

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


NOT_STARTED = {"FUT", "PRE"}


def game_state(g):
    return "final" if g["gameState"] in FINAL_STATES else "upcoming" if g["gameState"] in NOT_STARTED else "live"


def last_game_night():
    """The most recent date on which games have started (some may still be in
    progress or not started yet), and its regular-season games."""
    board = scoreboard("now")
    day = board["currentDate"]
    while day:
        games = [g for g in board["games"] if g.get("gameType", 2) == 2]
        if any(game_state(g) != "upcoming" for g in games):
            return day, games
        day = board.get("prevDate")
        board = scoreboard(day) if day else None
    return None, []


def boxscore_lines(game):
    """Per-player lines from the NHL box score; works while a game is live."""
    box = json.loads(get(f"{WEB_API}/gamecenter/{game['id']}/boxscore"))
    skaters, goalies = [], []
    for side in ("awayTeam", "homeTeam"):
        team = box[side]["abbrev"]
        players = box.get("playerByGameStats", {}).get(side, {})
        for p in players.get("forwards", []) + players.get("defense", []):
            skaters.append({"id": p["playerId"], "name": p["name"]["default"], "team": team,
                            "g": p.get("goals", 0), "a": p.get("assists", 0), "p": p.get("points", 0),
                            "pim": p.get("pim", 0)})
        for p in players.get("goalies", []):
            if p.get("toi", "00:00") == "00:00":
                continue  # dressed but didn't play
            goalies.append({"id": p["playerId"], "name": p["name"]["default"], "team": team,
                            "sa": p.get("shotsAgainst", 0), "sv": p.get("saves", 0), "ga": p.get("goalsAgainst", 0)})
    return skaters, goalies


def write_last_night(f):
    path = os.path.join(DATA, "lastnight.json")
    day, games = last_game_night()
    if not day:
        return
    old = read_json(path)
    if (old and old["date"] == day and old.get("complete")):
        return  # every game final and every GSAx in already

    skaters, goalies = [], []
    for g in games:
        if game_state(g) != "upcoming":
            sk, gl = boxscore_lines(g)
            final = game_state(g) == "final"
            skaters += [dict(x, final=final) for x in sk]
            goalies += [dict(x, final=final) for x in gl]

    # GSAx from MoneyPuck, only for finished games and once MoneyPuck has them
    done = {g["id"]: g["gsax"] for g in (old or {}).get("goalies", [])
            if old["date"] == day and g.get("gsax") is not None}
    gp_through = {g["playerId"]: g["gamesPlayed"]
                  for g in stats_rest("goalie", "summary", f.season, date_filter(end=day))}
    mp_gp = {g["id"]: g["gp"] for g in f.goalies_season()}
    for g in goalies:
        g["gsax"] = done.get(g["id"])
        if g["gsax"] is None and g["final"] and mp_gp.get(g["id"], 0) >= gp_through.get(g["id"], 1):
            game = [r for r in f.goalie_games(g["id"]) if r["date"] == day]
            if game:
                g["gsax"] = round(game[0]["xga"] - game[0]["ga"], 2)

    out_games = []
    for g in games:
        pd = g.get("periodDescriptor") or {}
        out_games.append({
            "away": {"abbrev": g["awayTeam"]["abbrev"], "score": g["awayTeam"].get("score")},
            "home": {"abbrev": g["homeTeam"]["abbrev"], "score": g["homeTeam"].get("score")},
            "state": game_state(g),
            "start": g.get("startTimeUTC"),
            "period": pd.get("number"),
            "periodType": pd.get("periodType"),
            "clock": (g.get("clock") or {}).get("timeRemaining"),
            "ending": (g.get("gameOutcome") or {}).get("lastPeriodType", "REG"),
        })
    complete = all(x["state"] == "final" for x in out_games) and all(x["gsax"] is not None for x in goalies)
    write_json(path, {
        "date": day,
        "updated": now_iso(),
        "complete": complete,
        "games": out_games,
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
    # Up to and including the NHL's current date: its date only rolls over to
    # Monday late in the Finnish morning, so a Sunday is taken as soon as all
    # of its games are final instead of waiting for that.
    while sunday <= today:
        day = sunday.isoformat()
        sunday += timedelta(days=7)
        if day in index:
            continue
        games = scoreboard(day)["games"]
        if (games and not all_final(games)) or (not games and day == today.isoformat()):
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


def archive_finished_season(league):
    """Once every team has played 82 games, keep a permanent copy of the final
    stats and the league file (picks, cap hits) for that season."""
    stats = read_json(os.path.join(DATA, "stats.json"))
    if not stats["teams"] or any(t["gp"] < 82 for t in stats["teams"]):
        return
    folder = os.path.join(DATA, "seasons", str(stats["season"]))
    if os.path.exists(os.path.join(folder, "stats.json")):
        return
    write_json(os.path.join(folder, "stats.json"), stats)
    write_json(os.path.join(folder, "league.json"), league)
    caps = read_json(os.path.join(DATA, "caphits.json"))
    if caps:
        write_json(os.path.join(folder, "caphits.json"), caps)
    print(f"archived final {stats['season']} season")


# ---------- game logs of the picks ----------

PICK_KINDS = {"gsax": "goalie", "presidents": "team"}  # every other category is a skater
# Same tie-breaks as the web app when several players share a name
PICK_CHECKS = {"rookies": lambda s: s.get("rookie"), "finnish": lambda s: s.get("nat") == "FIN"}


def find_pick(name, pool, cat):
    item = find_skater(name, pool)
    if item or cat not in PICK_CHECKS:
        return item
    key = norm(str(name))
    hits = [s for s in pool if (norm(s["name"]) == key or last_name(s["name"]) == key) and PICK_CHECKS[cat](s)]
    return hits[0] if len(hits) == 1 else None


def write_gamelogs(f, league):
    """Game-by-game lines for every player and team someone has picked."""
    stats = read_json(os.path.join(DATA, "stats.json"))
    logs = {}
    for cat, by_manager in league["picks"].items():
        kind = PICK_KINDS.get(cat, "skater")
        for manager, picks in by_manager.items():
            for pick in picks if isinstance(picks, list) else [picks]:
                name = pick["player"] if isinstance(pick, dict) else pick
                if kind == "team":
                    key = f"team:{str(name).upper()}"
                    if key not in logs:
                        logs[key] = {"kind": "team", "abbrev": str(name).upper(), "picks": []}
                else:
                    item = find_pick(name, stats["goalies"] if kind == "goalie" else stats["skaters"], cat)
                    if not item:
                        print(f"game log: can't find {name}", file=sys.stderr)
                        continue
                    key = f"{kind}:{item['id']}"
                    if key not in logs:
                        logs[key] = {"kind": kind, "id": item["id"], "name": item["name"], "team": item["team"], "picks": []}
                logs[key]["picks"].append({"manager": manager, "cat": cat})

    for key, entry in logs.items():
        if entry["kind"] == "team":
            data = json.loads(get(f"{WEB_API}/club-schedule-season/{entry['abbrev']}/{f.season}", pause=0.3))
            games = []
            for g in data["games"]:
                if g.get("gameType") != 2 or g["gameState"] not in FINAL_STATES:
                    continue
                home = g["homeTeam"]["abbrev"] == entry["abbrev"]
                us, them = (g["homeTeam"], g["awayTeam"]) if home else (g["awayTeam"], g["homeTeam"])
                extra = (g.get("gameOutcome") or {}).get("lastPeriodType", "REG")
                won = us.get("score", 0) > them.get("score", 0)
                games.append({"date": g["gameDate"], "opp": them["abbrev"], "home": home,
                              "gf": us.get("score"), "ga": them.get("score"), "ending": extra,
                              "result": "W" if won else ("OTL" if extra in ("OT", "SO") else "L"),
                              "pts": 2 if won else (1 if extra in ("OT", "SO") else 0)})
            entry["games"] = games
            continue
        data = json.loads(get(f"{WEB_API}/player/{entry['id']}/game-log/{f.season}/2", pause=0.3))
        games = []
        for g in sorted(data.get("gameLog", []), key=lambda g: g["gameDate"]):
            line = {"date": g["gameDate"], "opp": g.get("opponentAbbrev"), "home": g.get("homeRoadFlag") == "H",
                    "toi": g.get("toi")}
            if entry["kind"] == "goalie":
                line.update({"dec": g.get("decision"), "sa": g.get("shotsAgainst", 0), "ga": g.get("goalsAgainst", 0),
                             "svp": g.get("savePctg")})
            else:
                line.update({"g": g.get("goals", 0), "a": g.get("assists", 0), "p": g.get("points", 0),
                             "pim": g.get("pim", 0), "shots": g.get("shots", 0)})
            games.append(line)
        if entry["kind"] == "goalie":
            by_date = {r["date"]: r for r in f.goalie_games(entry["id"])}
            for line in games:
                r = by_date.get(line["date"])
                line["gsax"] = round(r["xga"] - r["ga"], 2) if r else None  # MoneyPuck can lag a few hours
        entry["games"] = games

    write_json(os.path.join(DATA, "gamelogs.json"), {"updated": now_iso(), "logs": logs})


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


def likely_elc(row, skater, draft_cutoff):
    """CapFreeze doesn't mark entry-level deals. A cheap contract (under $1.1M)
    for a player aged 24 or under, a rookie or a recent draft pick is assumed to
    be one; the app lists these so they can be confirmed in league.json."""
    try:
        age = int(row.get("age") or 99)
    except ValueError:
        age = 99
    young = age <= 24 or skater.get("rookie") or (skater.get("draft") or 0) >= draft_cutoff
    return row["cap"] <= 1.1 and bool(young)


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
            elc = likely_elc(row, s, draft_cutoff)
            store["players"][str(s["id"])] = {
                "name": s["name"], "team": s["team"], "cap": row["cap"], "age": row["age"],
                "elc": elc, "date": today,
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
    archive_finished_season(league)
    try:
        write_gamelogs(f, league)
    except Exception as e:  # game logs are extra; never fail the whole update over them
        print(f"game logs failed: {e}", file=sys.stderr)
    try:
        write_cap_lookups(league)
    except Exception as e:  # a CapFreeze hiccup shouldn't stop the stats update
        print(f"cap lookups failed: {e}", file=sys.stderr)
    print("done")


if __name__ == "__main__":
    main()
