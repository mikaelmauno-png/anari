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
  {
    key: "rookies", label: "Most points, rookie", kind: "skater", value: s => s.p, tiebreak: s => s.g, unit: "P",
    check: s => s.rookie ? null : "not a rookie",
  },
  { key: "presidents", label: "Presidents' Trophy", kind: "team", value: t => -t.rank, unit: "" },
  { key: "value", label: "€ per point", kind: "skater", value: null, unit: "k€/P" },
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
  return entries;
}

// league.capHits maps a player ("Name", "Name (TEAM)" or id) to a cap hit in
// millions, or to "ELC" for entry-level contracts (not eligible for €/point).
function applyCapHits(league, stats) {
  const warnings = [];
  for (const [key, val] of Object.entries(league.capHits || {})) {
    const { item, warning } = resolve(key, stats.skaters, "skater");
    if (warning) warnings.push(`capHits: ${warning}`);
    if (!item) continue;
    if (String(val).toUpperCase() === "ELC") item.elc = true;
    else item.cap = Number(val);
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
