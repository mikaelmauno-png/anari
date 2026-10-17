# Änäri

Standings for our NHL fantasy league. Eight categories, scored 5 / 3 / 2 / 1 for places 1–4. Tied picks share the higher place.

| Key in `league.json` | Category | Source |
|---|---|---|
| `goals` | Most goals | NHL |
| `points` | Most points | NHL |
| `finnish` | Most points by a Finnish player (nationality FIN) | NHL |
| `gsax` | Goals saved above expected | MoneyPuck |
| `pim` | Penalty minutes | NHL |
| `rookies` | Most points by a rookie | NHL |
| `presidents` | Presidents' Trophy (league standings, team abbreviation) | NHL |
| `value` | Cap hit per point, lowest wins (no entry-level contracts) | NHL + cap hit in `league.json` |

## Pages

- **Standings** (`index.html`): totals, every category, best possible picks.
- **Last round** (`round.html`): the last game night (your picks' stat lines, all scores) and fantasy score changes this week and last week.
- **Trend** (`trend.html`): each manager's points above or below the league average at the end of every week (Monday–Sunday).

## Editing picks

Edit `league.json`. A pick can be:

- a name: `"Auston Matthews"` (accents don't matter)
- a name with a team, when the name is ambiguous: `"Sebastian Aho (CAR)"`
- an NHL player id: `8478402`
- for `presidents`, a team abbreviation: `"COL"`

A manager can have several picks in a category. Each pick is ranked on its own. The page shows a ⚠ next to picks that can't be found or break a category rule (not Finnish, not a rookie, missing cap hit).

## Cap hits

No free source allows automated cap hit downloads, so cap hits are entered by hand in `capHits` in `league.json`, in millions. Use `"ELC"` for entry-level contracts, which aren't eligible:

```json
"capHits": { "Zuccarello": 1.0, "Matt Boldy (MIN)": 7.0, "Gavin McKenna": "ELC" }
```

Every drafted €/point player needs a cap hit. The €/point card also lists players without one who would beat the best known pick if they earned the league minimum (`minCap`). Look those up (e.g. on CapWages or PuckPedia) and add them until the list is empty. The best pick is then the true best. For players who are clearly too expensive, a rough number is enough.

## Stats

`scripts/fetch_stats.py` downloads current stats into `data/stats.json`, the last game night into `data/lastnight.json`, and a snapshot of season totals through every Sunday into `data/history/`. Missed weeks are rebuilt from date-filtered stats. On GitHub, `.github/workflows/update-stats.yml` runs it every 3 hours. To run it manually from the Actions tab, use *Update stats → Run workflow*. Locally:

```bash
python3 scripts/fetch_stats.py
python3 -m http.server 8765
```
