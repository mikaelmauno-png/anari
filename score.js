// Änäri fantasy league: shared scoring and helpers for all pages. Reads
// league.json (rules + picks) and stats files written by scripts/fetch_stats.py.
const CATEGORIES = [
  { key: "goals", label: "Most goals", kind: "skater", value: s => s.g, unit: "G" },
  { key: "points", label: "Most points", kind: "skater", value: s => s.p, tiebreak: s => s.g, unit: "P" },
  {
    key: "finnish", label: "Most points, Finnish player", kind: "skater", value: s => s.p, tiebreak: s => s.g, unit: "P",
    check: s => s.nat === "FIN" ? null : `not Finnish (${s.nat || "unknown"})`,
  },
  { key: "gsax", label: "GSAx", kind: "goalie", value: g => g.gsax, unit: "GSAx", decimals: 2, source: "MoneyPuck" },
  { key: "pim", label: "Penalty minutes", kind: "skater", value: s => s.pim, unit: "PIM" },
  { key: "value", label: "€ per point", kind: "skater", value: null, unit: "k€/P" },
  {
    key: "rookies", label: "Most points, rookie", kind: "skater", value: s => s.p, tiebreak: s => s.g, unit: "P",
    check: s => s.rookie ? null : "not a rookie",
  },
  { key: "presidents", label: "Presidents' Trophy", kind: "team", value: t => -t.rank, unit: "" },
];

// € per point, lower is better. Ranking works on "higher is better" values, so
// the cost is negated; a player with no points ranks last.
const costValue = (p, cap) => p > 0 ? -cap / p : -Infinity;
const costText = v => v === -Infinity ? "no points" : `${Math.round(-v * 1000)}`;

const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const lastName = full => norm(full.split(" ").slice(1).join(" ") || full);

// A pick is "Name", "Last name", "Name (TEAM)", a numeric NHL player id, or for
// the value category {player, capHit}. When several players match, the
// category's rule (e.g. Finnish, rookie) picks between them. Returns {item, warning}.
function resolve(pick, pool, kind, check) {
  const raw = typeof pick === "object" && pick !== null ? pick.player : pick;
  if (kind === "team") {
    const t = pool.find(t => t.abbrev === String(raw).toUpperCase() || norm(t.name) === norm(String(raw)));
    return t ? { item: t } : { warning: `team "${raw}" not found` };
  }
  if (typeof raw === "number" || /^\d+$/.test(raw)) {
    const p = pool.find(p => p.id === Number(raw));
    return p ? { item: p } : { warning: `id ${raw} not found (no games yet?)` };
  }
  const m = String(raw).match(/^(.*?)\s*\(([A-Za-z]{2,3})\)\s*$/);
  const name = norm(m ? m[1] : raw);
  const team = m ? m[2].toUpperCase() : null;
  let hits = pool.filter(p => norm(p.name) === name);
  if (hits.length === 0) hits = pool.filter(p => lastName(p.name) === name);
  if (team) {
    // A traded player's team changes; fall back to the name alone if it's unique.
    const onTeam = hits.filter(p => p.team === team);
    if (onTeam.length || hits.length > 1) hits = onTeam;
  }
  if (hits.length > 1 && check) {
    const ok = hits.filter(p => !check(p));
    if (ok.length) hits = ok;
  }
  if (hits.length === 0) return { warning: `"${raw}" not found (no games yet, or misspelled?)` };
  if (hits.length > 1) {
    hits.sort((a, b) => b.gp - a.gp);
    return { item: hits[0], warning: `"${raw}" is ambiguous; add the team, e.g. "${hits[0].name} (${hits[0].team})"` };
  }
  return { item: hits[0] };
}

// Sorts best first; 0 means a real tie.
function compareEntries(a, b) {
  if (Math.abs(a.value - b.value) > 1e-9) return b.value - a.value;
  return (b.tb || 0) - (a.tb || 0);
}

function scoreCategory(cat, league, stats) {
  const pool = { skater: stats.skaters, goalie: stats.goalies, team: stats.teams }[cat.kind];
  const entries = [];
  for (const manager of league.managers) {
    let picks = (league.picks[cat.key] || {})[manager] || [];
    if (!Array.isArray(picks)) picks = [picks];
    for (const pick of picks) {
      const { item, warning } = resolve(pick, pool, cat.kind, cat.check);
      const e = { manager, pick, item, warnings: warning ? [warning] : [], value: 0 };
      if (item) {
        const bad = cat.check && cat.check(item);
        if (bad) e.warnings.push(bad);
        if (cat.key === "value") {
          const cap = Number((pick && pick.capHit) || item.cap);
          if (item.elc) e.warnings.push("entry-level contract");
          if (!cap) e.warnings.push("cap hit missing; add it to capHits in league.json");
          else { e.cap = cap; e.value = costValue(item.p, cap); }
        } else {
          e.value = cat.value(item);
          if (cat.tiebreak) e.tb = cat.tiebreak(item);
        }
      } else if (cat.kind === "team") {
        e.value = -Infinity;
      }
      entries.push(e);
    }
  }
  // Competition ranking: a tie on the stat is broken by the category's tiebreak
  // (goals for the points categories); entries still tied share the higher
  // place (and its points), and the following place is skipped.
  entries.sort(compareEntries);
  for (const e of entries) {
    e.place = 1 + entries.filter(o => compareEntries(o, e) < 0).length;
    e.tied = entries.some(o => o !== e && compareEntries(o, e) === 0);
    e.points = league.scoring[e.place - 1] || 0;
  }
  for (const e of entries) {
    // The closest entry strictly ahead
    const ahead = entries.filter(o => compareEntries(o, e) < 0).pop();
    e.gap = ahead ? gapText(cat, e, ahead) : null;
  }
  return entries;
}

const fmtNum = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

// How far an entry is behind the one directly ahead of it, in the category's terms.
function gapText(cat, e, ahead) {
  if (!e.item || !ahead.item) return null;
  const who = esc(ahead.manager);
  if (cat.kind === "team") {
    const d = ahead.item.pts - e.item.pts;
    return d > 0 ? `${fmtNum(d)} pt${d === 1 ? "" : "s"} behind ${who}` : `level on points with ${who}, behind on tiebreak`;
  }
  if (cat.key === "value") {
    if (!e.cap || ahead.value === -Infinity) return null;
    // Points needed at the same cap hit to get under the € per point ahead
    const need = Math.floor(e.cap / -ahead.value + 1e-9) + 1 - e.item.p;
    return need > 0 ? `${fmtNum(need)} more point${need === 1 ? "" : "s"} to pass ${who}` : null;
  }
  const d = ahead.value - e.value;
  if (d > 1e-9) return `${fmtNum(d, cat.decimals || 0)} ${cat.unit} behind ${who}`;
  if (cat.tiebreak) return `level on ${cat.unit} with ${who}, ${fmtNum(ahead.tb - e.tb)} G behind on tiebreak`;
  return null;
}

// ---------- projection ----------

const SEASON_GAMES = 82;

// Season totals at the current pace: every stat scaled by 82 / team games played,
// so missed games count against a player. The playoff picture is redrawn from
// projected points (top 3 per division, then 2 wildcards per conference).
function projectStats(stats) {
  const proj = JSON.parse(JSON.stringify(stats));
  const teamGp = Object.fromEntries(proj.teams.map(t => [t.abbrev, t.gp]));
  const factor = team => teamGp[team] ? SEASON_GAMES / teamGp[team] : 0;
  for (const s of proj.skaters) {
    const f = factor(s.team);
    s.g *= f; s.p *= f; s.pim *= f;
  }
  for (const g of proj.goalies) g.gsax *= factor(g.team);
  for (const t of proj.teams) t.pts = t.gp ? t.pts * SEASON_GAMES / t.gp : 0;
  proj.teams.sort((a, b) => b.pts - a.pts || b.ptsPct - a.ptsPct);
  proj.teams.forEach((t, i) => { t.rank = i + 1; t.inPlayoffs = false; });
  for (const conf of new Set(proj.teams.map(t => t.conf))) {
    const inConf = proj.teams.filter(t => t.conf === conf);
    for (const div of new Set(inConf.map(t => t.div))) {
      inConf.filter(t => t.div === div).slice(0, 3).forEach(t => { t.inPlayoffs = true; });
    }
    inConf.filter(t => !t.inPlayoffs).slice(0, 2).forEach(t => { t.inPlayoffs = true; });
  }
  return proj;
}

// The regular season is over once every team has played 82 games. Add ?final to
// the address to preview the end-of-season view.
function finalPreview() {
  return typeof location !== "undefined" && new URLSearchParams(location.search).has("final");
}
function seasonOver(stats) {
  return finalPreview() || (stats.teams.length > 0 && stats.teams.every(t => t.gp >= SEASON_GAMES));
}

// Final ranking: by total; a tie for first goes to whoever won the most
// categories (1st places, shared 1sts count), and is shared if that's level too.
function rankFinal(league, rows) {
  for (const r of rows) r.wins = CATEGORIES.filter(c => r.byCat[c.key] === league.scoring[0]).length;
  const top = Math.max(...rows.map(r => r.total));
  const better = (o, r) => o.total > r.total || (o.total === top && r.total === top && o.wins > r.wins);
  rows.sort((a, b) => b.total - a.total || (a.total === top ? b.wins - a.wins : 0));
  for (const r of rows) r.place = 1 + rows.filter(o => better(o, r)).length;
  const tiedOnTotal = rows.filter(r => r.total === top);
  rows.decidedByWins = tiedOnTotal.length > 1 && rows.filter(r => r.place === 1).length < tiedOnTotal.length;
  return rows;
}

// ---------- next-season draft ----------
//
// Each manager submits (league.draft[manager]):
//   firstPicks: the 8 category keys, most wanted first, for claiming 1st pick
//   choices:    { category: [1st, 2nd, 3rd, 4th choice] }
//   playoffs:   8 East + 8 West team abbreviations (not drafted, overlap is fine)
// The order comes from last season's final standings, reversed (last place first).

// Managers from last place to first, using the final ranking (tie for first
// broken by category wins); any remaining tie keeps the league.json order.
function draftOrder(league, stats) {
  const { table } = computeStandings(league, stats);
  const po = playoffPoints(league, stats.teams);
  const rows = rankFinal(league, table.map(r => ({ ...r, total: r.total + (po[r.manager] || 0) })));
  const idx = m => league.managers.indexOf(m);
  return rows.slice().sort((a, b) => b.place - a.place || idx(a.manager) - idx(b.manager)).map(r => r.manager);
}

// Two rounds, last place first: each manager claims their highest-ranked
// category nobody has claimed yet and picks 1st in it. The rest of that
// category's order continues around the reverse standings, so everyone picks
// 1st, 2nd, 3rd and 4th exactly twice.
function categoryOrders(league, reverse) {
  const draft = league.draft || {};
  const claimed = {};
  for (let round = 0; round < 2; round++) {
    for (const m of reverse) {
      const wanted = [...((draft[m] || {}).firstPicks || []), ...CATEGORIES.map(c => c.key)];
      const key = wanted.find(k => CATEGORIES.some(c => c.key === k) && !claimed[k]);
      if (key) claimed[key] = m;
    }
  }
  return Object.fromEntries(CATEGORIES.map(c => {
    const start = reverse.indexOf(claimed[c.key]);
    return [c.key, reverse.map((_, i) => reverse[(start + i) % reverse.length])];
  }));
}

// In pick order, each manager gets their highest choice that's still available.
function runDraft(league, stats) {
  const reverse = draftOrder(league, stats);
  const orders = categoryOrders(league, reverse);
  const draft = league.draft || {};
  const results = CATEGORIES.map(cat => {
    const pool = { skater: stats.skaters, goalie: stats.goalies, team: stats.teams }[cat.kind];
    const taken = new Set();
    // Same player whether written "McDavid", "Connor McDavid" or "Connor McDavid (EDM)"
    const keyOf = choice => {
      const { item } = resolve(choice, pool, cat.kind, cat.check);
      return item ? `id:${item.id || item.abbrev}` : `name:${norm(String(choice))}`;
    };
    const picks = orders[cat.key].map((m, i) => {
      const choices = (((draft[m] || {}).choices || {})[cat.key] || []).filter(Boolean);
      if (!draft[m]) return { manager: m, slot: i + 1, waiting: true };
      const n = choices.findIndex(c => !taken.has(keyOf(c)));
      if (n < 0) return { manager: m, slot: i + 1, pick: null, choices };
      taken.add(keyOf(choices[n]));
      return { manager: m, slot: i + 1, pick: choices[n], choiceNo: n + 1, choices };
    });
    return { cat, picks };
  });
  return { reverse, orders, results };
}

// 2 points per playoff pick that's in a playoff spot
function playoffPoints(league, teams) {
  const inSpot = new Set(teams.filter(t => t.inPlayoffs).map(t => t.abbrev));
  return Object.fromEntries(league.managers.map(m =>
    [m, ((league.playoffs || {})[m] || []).filter(a => inSpot.has(String(a).toUpperCase())).length * 2]));
}

// Cap hits come from two places: data/caphits.json, looked up on CapFreeze a few
// players a day by the stats update (by NHL id), and league.capHits, entered by
// hand ("Name", "Name (TEAM)" or id -> millions, or "ELC" for entry-level
// contracts, which aren't eligible for €/point). Hand entries win.
function applyCapHits(league, stats) {
  const warnings = [];
  const looked = (league.lookedUpCaps && league.lookedUpCaps.players) || {};
  for (const item of stats.skaters) {
    const e = looked[item.id];
    if (!e) continue;
    item.capSource = "CapFreeze";
    if (e.elc) { item.elc = true; item.elcAssumed = true; item.capIfNotElc = e.cap; }
    else item.cap = e.cap;
  }
  for (const [key, val] of Object.entries(league.capHits || {})) {
    const { item, warning } = resolve(key, stats.skaters, "skater");
    if (warning) warnings.push(`capHits: ${warning}`);
    if (!item) continue;
    item.capSource = "league.json";
    item.elcAssumed = false;
    if (String(val).toUpperCase() === "ELC") { item.elc = true; delete item.cap; }
    else { item.elc = false; item.cap = Number(val); }
  }
  return warnings;
}

// Players whose cap hit isn't entered yet but who would beat the best known
// €/point pick if paid the league minimum. Fill these in until the list is empty.
function valueCandidates(league, stats, best, limit = 12) {
  const minCap = league.minCap || 0.85;
  const draftCutoff = Math.floor(stats.season / 10000) - 3;
  const all = stats.skaters
    .filter(s => s.cap === undefined && !s.elc && s.p > 0 && (!best || costValue(s.p, minCap) > best.value))
    .sort((a, b) => b.p - a.p || a.gp - b.gp)
    .map(s => ({
      item: s,
      // Above this cap hit the player can't beat the current best
      maxCap: best && best.value > -Infinity ? s.p * -best.value : null,
      likelyElc: s.rookie || (s.draft && s.draft >= draftCutoff),
    }));
  return { list: all.slice(0, limit), total: all.length };
}

// The best pick anyone could have made: the leader among all eligible players.
// For €/point only players with a known cap hit count.
function bestPick(cat, stats) {
  const pool = { skater: stats.skaters, goalie: stats.goalies, team: stats.teams }[cat.kind];
  let candidates;
  if (cat.key === "value") {
    candidates = pool.filter(s => s.cap && !s.elc).map(s => ({ item: s, cap: s.cap, value: costValue(s.p, s.cap) }));
    if (!candidates.length) return null;
  } else {
    candidates = pool.filter(x => !cat.check || !cat.check(x))
      .map(x => ({ item: x, value: cat.value(x), tb: cat.tiebreak && cat.tiebreak(x) }));
  }
  candidates.sort(compareEntries);
  return candidates[0] || null;
}

function computeStandings(league, stats) {
  const capWarnings = applyCapHits(league, stats);
  const results = CATEGORIES.map(cat => ({ cat, entries: scoreCategory(cat, league, stats), best: bestPick(cat, stats) }));
  const value = results.find(r => r.cat.key === "value");
  value.candidates = valueCandidates(league, stats, value.best);
  value.capWarnings = capWarnings;
  const table = league.managers.map(manager => {
    const byCat = {};
    for (const { cat, entries } of results) {
      byCat[cat.key] = entries.filter(e => e.manager === manager).reduce((s, e) => s + e.points, 0);
    }
    return { manager, byCat, total: Object.values(byCat).reduce((a, b) => a + b, 0) };
  });
  table.sort((a, b) => b.total - a.total);
  for (const row of table) row.place = 1 + table.filter(o => o.total > row.total).length;
  return { results, table };
}

// ---------- rendering ----------

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SHORT = { goals: "G", points: "P", finnish: "FIN", gsax: "GSAx", pim: "PIM", rookies: "ROO", presidents: "PRES", value: "€/P" };

function fmtValue(cat, e) {
  if (!e.item) return "–";
  if (cat.kind === "team") return `${e.item.pts} pts · ${e.item.gp} GP`;
  if (cat.key === "value") return e.cap ? `${costText(e.value)} <small>${e.value > -Infinity ? "k€/P " : ""}(${e.cap} M / ${e.item.p} P)</small>` : "–";
  const v = cat.value(e.item);
  const shown = cat.decimals ? v.toFixed(cat.decimals) : v;
  const tb = cat.tiebreak ? ` · ${cat.tiebreak(e.item)} G` : "";
  return `${cat.decimals && v > 0 ? "+" : ""}${shown} <small>${cat.unit}${tb} · ${e.item.gp} GP</small>`;
}

function pickLabel(cat, e) {
  if (e.item) return cat.kind === "team" ? esc(e.item.name) : `${esc(e.item.name)} <small>${esc(e.item.team)}</small>`;
  return esc(typeof e.pick === "object" ? e.pick.player : e.pick);
}

// ---------- shared page helpers ----------

// Fixed categorical order (validated palette slots 1-4), by manager order in
// league.json, so a manager keeps the same color on every page.
const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
const managerColor = (league, m) => SERIES[league.managers.indexOf(m) % SERIES.length];

const seasonLabel = season => `${String(season).slice(0, 4)}–${String(season).slice(6)}`;
const fmtDay = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-GB", opts);

// league.json plus the cap hits looked up so far (missing file is fine)
async function loadLeague() {
  const [league, caps] = await Promise.all([
    loadJSON("league.json"), loadJSON("data/caphits.json").catch(() => null),
  ]);
  league.lookedUpCaps = caps;
  return league;
}

async function loadJSON(path) {
  const r = await fetch(`${path}?t=${Date.now()}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function showError(err) {
  console.error(err);
  document.querySelector("main").insertAdjacentHTML("beforeend",
    `<p class="warn">Could not load data: ${esc(err.message)}</p>`);
}
