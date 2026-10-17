// Änäri fantasy league: reads league.json (rules + picks) and data/stats.json
// (fetched by scripts/fetch_stats.py) and computes the standings.

const CATEGORIES = [
  { key: "goals", label: "Most goals", kind: "skater", value: s => s.g, unit: "G" },
  { key: "points", label: "Most points", kind: "skater", value: s => s.p, unit: "P" },
  {
    key: "finnish", label: "Most points, Finnish player", kind: "skater", value: s => s.p, unit: "P",
    check: s => s.nat === "FIN" ? null : `not Finnish (${s.nat || "unknown"})`,
  },
  { key: "gsax", label: "GSAx", kind: "goalie", value: g => g.gsax, unit: "GSAx", decimals: 2, source: "MoneyPuck" },
  { key: "pim", label: "Penalty minutes", kind: "skater", value: s => s.pim, unit: "PIM" },
  {
    key: "rookies", label: "Most points, rookie", kind: "skater", value: s => s.p, unit: "P",
    check: s => s.rookie ? null : "not a rookie",
  },
  { key: "presidents", label: "Presidents' Trophy", kind: "team", value: t => -t.rank, unit: "" },
  { key: "value", label: "Points per €M", kind: "skater", value: null, unit: "P/€M", decimals: 2 },
];

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
          else { e.cap = cap; e.value = item.p / cap; }
        } else {
          e.value = cat.value(item);
        }
      } else if (cat.kind === "team") {
        e.value = -Infinity;
      }
      entries.push(e);
    }
  }
  // Competition ranking: tied entries share the higher place (and its points),
  // and the following place is skipped.
  entries.sort((a, b) => b.value - a.value);
  for (const e of entries) {
    e.place = 1 + entries.filter(o => o.value > e.value + 1e-9).length;
    e.tied = entries.some(o => o !== e && Math.abs(o.value - e.value) < 1e-9);
    e.points = league.scoring[e.place - 1] || 0;
  }
  return entries;
}

// league.capHits maps a player ("Name", "Name (TEAM)" or id) to a cap hit in
// millions, or to "ELC" for entry-level contracts (not eligible for points/€).
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
// points/€ pick if paid the league minimum. Fill these in until the list is empty.
function valueCandidates(league, stats, best, limit = 12) {
  const minCap = league.minCap || 0.85;
  const draftCutoff = Math.floor(stats.season / 10000) - 3;
  const all = stats.skaters
    .filter(s => s.cap === undefined && !s.elc && s.p > 0 && (!best || s.p / minCap > best.value))
    .sort((a, b) => b.p - a.p || a.gp - b.gp)
    .map(s => ({
      item: s,
      // Above this cap hit the player can't beat the current best
      maxCap: best ? s.p / best.value : null,
      likelyElc: s.rookie || (s.draft && s.draft >= draftCutoff),
    }));
  return { list: all.slice(0, limit), total: all.length };
}

// The best pick anyone could have made: the leader among all eligible players.
// For points/€ only players with a known cap hit count.
function bestPick(cat, stats) {
  const pool = { skater: stats.skaters, goalie: stats.goalies, team: stats.teams }[cat.kind];
  let candidates;
  if (cat.key === "value") {
    candidates = pool.filter(s => s.cap && !s.elc).map(s => ({ item: s, cap: s.cap, value: s.p / s.cap }));
    if (!candidates.length) return null;
  } else {
    candidates = pool.filter(x => !cat.check || !cat.check(x)).map(x => ({ item: x, value: cat.value(x) }));
  }
  candidates.sort((a, b) => b.value - a.value);
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
const SHORT = { goals: "G", points: "P", finnish: "FIN", gsax: "GSAx", pim: "PIM", rookies: "ROO", presidents: "PRES", value: "P/€" };

function fmtValue(cat, e) {
  if (!e.item) return "–";
  if (cat.kind === "team") return `${e.item.pts} pts · ${e.item.gp} GP`;
  if (cat.key === "value") return e.cap ? `${e.value.toFixed(2)} <small>(${e.item.p} P / ${e.cap} M)</small>` : "–";
  const v = cat.value(e.item);
  const shown = cat.decimals ? v.toFixed(cat.decimals) : v;
  return `${cat.decimals && v > 0 ? "+" : ""}${shown} <small>${cat.unit} · ${e.item.gp} GP</small>`;
}

function pickLabel(cat, e) {
  if (e.item) return cat.kind === "team" ? esc(e.item.name) : `${esc(e.item.name)} <small>${esc(e.item.team)}</small>`;
  return esc(typeof e.pick === "object" ? e.pick.player : e.pick);
}

function render(league, stats) {
  const { results, table } = computeStandings(league, stats);
  document.title = `${league.name} standings`;
  document.getElementById("league-name").textContent = league.name;
  const updated = new Date(stats.updated);
  const season = String(stats.season);
  document.getElementById("meta").textContent =
    `${season.slice(0, 4)}–${season.slice(6)} regular season · stats updated ${updated.toLocaleString()}`;

  const head = CATEGORIES.map(c => `<th title="${esc(c.label)}">${SHORT[c.key]}</th>`).join("");
  const rows = table.map(r => `
    <tr>
      <td class="place">${r.place}</td>
      <th scope="row" class="mgr">${esc(r.manager)}</th>
      <td class="total">${r.total}</td>
      ${CATEGORIES.map(c => `<td class="${r.byCat[c.key] ? "" : "zero"}">${r.byCat[c.key]}</td>`).join("")}
    </tr>`).join("");
  document.getElementById("standings").innerHTML = `
    <div class="scroll"><table>
      <thead><tr><th>#</th><th class="mgr">Manager</th><th>Total</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

  document.getElementById("categories").innerHTML = results.map(({ cat, entries, best, candidates, capWarnings }) => `
    <section class="card${candidates ? " wide" : ""}">
      <h3>${esc(cat.label)}${cat.source ? ` <span class="src">${cat.source}</span>` : ""}</h3>
      <ol class="rank">
        ${entries.map(e => `
          <li class="${e.points ? "scored" : ""}">
            <span class="pl">${e.tied ? "T" : ""}${e.place}</span>
            <span class="who"><b>${esc(e.manager)}</b><span class="pick">${pickLabel(cat, e)}</span>
              ${e.warnings.map(w => `<span class="warn">⚠ ${esc(w)}</span>`).join("")}</span>
            <span class="val">${fmtValue(cat, e)}</span>
            <span class="pts">${e.points ? "+" + e.points : "0"}</span>
          </li>`).join("")}
      </ol>
      <p class="best">${best
        ? `${candidates && candidates.total ? "Best known pick" : "Best possible pick"}: <b>${pickLabel(cat, best)}</b> <span>${fmtValue(cat, best)}</span>`
        : "Best possible pick: no data"}</p>
      ${candidates ? renderCandidates(league, candidates, capWarnings) : ""}
    </section>`).join("");
}

function renderCandidates(league, { list, total }, capWarnings) {
  const warn = capWarnings.map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join("");
  if (!total) return `${warn}<p class="hint">All players who could beat it have a cap hit entered ✓</p>`;
  return `${warn}
    <details class="cands">
      <summary>${total} player${total === 1 ? "" : "s"} could still be better: check their cap hits</summary>
      <p class="hint">Look up each cap hit and add it to <code>capHits</code> in league.json in millions,
        e.g. <code>"Matt Boldy (MIN)": 7.0</code>, or <code>"ELC"</code> for entry-level contracts.
        A player only beats the best known pick if his cap hit is under the limit shown, so for
        obvious stars a rough number (e.g. <code>10</code>) is enough to clear them off the list.</p>
      <ol class="rank">
        ${list.map(c => `
          <li>
            <span class="pl">${c.item.p}</span>
            <span class="who"><b>${esc(c.item.name)} <small>${esc(c.item.team)}</small></b>
              <code class="key">"${esc(c.item.name)} (${esc(c.item.team)})":</code>
              ${c.likelyElc ? `<span class="warn">probably on an entry-level contract</span>` : ""}</span>
            <span class="val">${c.maxCap ? `< ${c.maxCap.toFixed(2)} M` : ""}</span>
            <span></span>
          </li>`).join("")}
      </ol>
      ${total > list.length ? `<p class="hint">…and ${total - list.length} more. The list shrinks as you add cap hits.</p>` : ""}
    </details>`;
}

async function main() {
  try {
    const bust = `?t=${Date.now()}`;
    const [league, stats] = await Promise.all([
      fetch("league.json" + bust).then(r => r.json()),
      fetch("data/stats.json" + bust).then(r => r.json()),
    ]);
    render(league, stats);
  } catch (err) {
    document.getElementById("standings").innerHTML = `<p class="warn">Could not load data: ${esc(err.message)}</p>`;
    console.error(err);
  }
}

main();
