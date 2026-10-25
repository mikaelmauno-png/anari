// Picks page: game-by-game stats of any pick (player or team), chosen from a
// menu grouped by manager. Data: data/gamelogs.json from the stats update.

const PICKS_KEY = "anari-picks-choice";
const CAT_NAMES = Object.fromEntries(CATEGORIES.map(c => [c.key, SHORT[c.key]]));

const vsAt = g => `${g.home ? "vs" : "at"} ${g.opp}`;
const gameDay = d => fmtDay(d, { weekday: "short", day: "numeric", month: "short" });
const sum = (games, k) => games.reduce((s, g) => s + (g[k] || 0), 0);

// What the chart builds up over the season for this pick
function mainStat(entry) {
  if (entry.kind === "goalie") return { key: "gsax", label: "GSAx", fmt: v => `${v > 0 ? "+" : ""}${v.toFixed(2)}` };
  if (entry.kind === "team") return { key: "pts", label: "standings points", fmt: v => `${v} pts` };
  const cats = entry.picks.map(p => p.cat);
  if (cats.includes("pim") && cats.length === 1) return { key: "pim", label: "PIM", fmt: v => `${v} PIM` };
  if (cats.includes("goals") && cats.length === 1) return { key: "g", label: "goals", fmt: v => `${v} G` };
  return { key: "p", label: "points", fmt: v => `${v} P` };
}

function menu(league, logs, choice) {
  const groups = league.managers.map(m => {
    const mine = Object.entries(logs).filter(([, e]) => e.picks.some(p => p.manager === m));
    return `<optgroup label="${esc(m)}${m === me() ? " (you)" : ""}">${mine.map(([key, e]) => {
      const cats = e.picks.filter(p => p.manager === m).map(p => CAT_NAMES[p.cat]).join(", ");
      return `<option value="${esc(key)}|${esc(m)}" ${choice === `${key}|${m}` ? "selected" : ""}>${esc(e.name || teamName(e.abbrev))} · ${cats}</option>`;
    }).join("")}</optgroup>`;
  }).join("");
  return `
    <label class="sel"><span class="sel-label">Pick</span>
      <span class="sel-box"><select id="pick-select">${groups}</select>
        <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span></label>`;
}

let TEAM_NAMES = {};
const teamName = abbrev => TEAM_NAMES[abbrev] || abbrev;

function summary(entry) {
  const gs = entry.games, n = gs.length;
  if (entry.kind === "team") {
    const w = gs.filter(g => g.result === "W").length, otl = gs.filter(g => g.result === "OTL").length;
    return `${n} GP · ${w}–${n - w - otl}–${otl} · ${sum(gs, "pts")} pts · goals ${sum(gs, "gf")}–${sum(gs, "ga")}`;
  }
  if (entry.kind === "goalie") {
    const sa = sum(gs, "sa"), ga = sum(gs, "ga"), w = gs.filter(g => g.dec === "W").length;
    const gsax = gs.filter(g => g.gsax != null);
    return `${n} GP · ${w} W · ${sa ? ((sa - ga) / sa).toFixed(3).replace(/^0/, "") : "–"} SV% · ${ga} GA` +
      (gsax.length ? ` · ${(v => `${v > 0 ? "+" : ""}${v.toFixed(2)}`)(sum(gsax, "gsax"))} GSAx` : "");
  }
  return `${n} GP · ${sum(gs, "g")} G · ${sum(gs, "a")} A · ${sum(gs, "p")} P · ${sum(gs, "pim")} PIM · ${sum(gs, "shots")} shots`;
}

function table(entry) {
  const rows = entry.games.slice().reverse();
  if (entry.kind === "team") return `
    <thead><tr><th class="l">Date</th><th class="l">Opp</th><th>Score</th><th>Res</th><th>Pts</th></tr></thead>
    <tbody>${rows.map(g => `<tr><td class="l">${gameDay(g.date)}</td><td class="l">${vsAt(g)}</td>
      <td>${g.gf}–${g.ga}${g.ending !== "REG" ? ` <small>${g.ending}</small>` : ""}</td>
      <td class="${g.result === "W" ? "up" : g.result === "L" ? "down" : ""}">${g.result}</td><td>${g.pts}</td></tr>`).join("")}</tbody>`;
  if (entry.kind === "goalie") return `
    <thead><tr><th class="l">Date</th><th class="l">Opp</th><th>Dec</th><th>SV/SA</th><th>GA</th><th>SV%</th><th>GSAx</th></tr></thead>
    <tbody>${rows.map(g => `<tr><td class="l">${gameDay(g.date)}</td><td class="l">${vsAt(g)}</td>
      <td class="${g.dec === "W" ? "up" : g.dec ? "down" : "muted"}">${g.dec || "–"}</td>
      <td>${g.sa - g.ga}/${g.sa}</td><td>${g.ga}</td><td>${g.svp != null ? g.svp.toFixed(3).replace(/^0/, "") : "–"}</td>
      <td class="${g.gsax > 0 ? "up" : g.gsax < 0 ? "down" : "muted"}">${g.gsax == null ? "…" : `${g.gsax > 0 ? "+" : ""}${g.gsax.toFixed(2)}`}</td></tr>`).join("")}</tbody>`;
  return `
    <thead><tr><th class="l">Date</th><th class="l">Opp</th><th>G</th><th>A</th><th>P</th><th>PIM</th><th>TOI</th></tr></thead>
    <tbody>${rows.map(g => `<tr class="${g.p ? "" : "quiet"}"><td class="l">${gameDay(g.date)}</td><td class="l">${vsAt(g)}</td>
      <td>${g.g || "·"}</td><td>${g.a || "·"}</td><td class="b">${g.p || "·"}</td><td>${g.pim || "·"}</td><td class="muted">${g.toi || ""}</td></tr>`).join("")}</tbody>`;
}

function render(league, logs, choice) {
  const [key, manager] = choice.split("|");
  const entry = logs[key];
  document.getElementById("pick-controls").innerHTML = menu(league, logs, choice);
  const color = managerColor(league, manager);
  const cats = entry.picks.filter(p => p.manager === manager).map(p => CATEGORIES.find(c => c.key === p.cat)?.label).join(" · ");
  const others = [...new Set(entry.picks.filter(p => p.manager !== manager).map(p => p.manager))];
  document.getElementById("pick-head").innerHTML = `
    <h3><span class="swatch" style="background:${color}"></span>${esc(entry.name || teamName(entry.abbrev))}
      ${entry.team ? `<small>${esc(entry.team)}</small>` : ""}</h3>
    <p class="muted">${esc(manager)}'s pick · ${esc(cats)}${others.length ? ` · also picked by ${others.map(esc).join(", ")}` : ""}</p>
    <p class="sum">${summary(entry)}</p>`;

  // Season building up game by game
  const stat = mainStat(entry);
  let run = 0;
  const values = entry.games.map(g => (run += g[stat.key] || 0));
  const el = document.getElementById("pick-chart");
  if (entry.games.length > 1) {
    drawChart(el, entry.games.map(g => fmtDay(g.date, { day: "numeric", month: "numeric" })), [{
      name: entry.name || entry.abbrev, color, values,
      extra: entry.games.map(g => `${vsAt(g)}${entry.kind === "team" ? ` ${g.result}` : ""}`),
    }], {
      compact: true, aria: `${entry.name || entry.abbrev}: ${stat.label} through the season`,
      zeroLine: stat.key === "gsax", fmt: stat.fmt,
      tipTitle: i => `${gameDay(entry.games[i].date)} · game ${i + 1}`,
    });
    // Thin out the x labels: one per game is too many on a phone
    const labels = el.querySelectorAll("text.axis[text-anchor='middle']");
    const every = Math.ceil(labels.length / 6);
    labels.forEach((t, i) => { if (i % every && i !== labels.length - 1) t.remove(); });
  } else {
    el.innerHTML = "";
  }
  document.getElementById("chart-note").textContent = entry.games.length > 1 ? `Season total of ${stat.label}, game by game.` : "";
  document.getElementById("log").innerHTML = entry.games.length
    ? `<div class="scroll"><table class="log">${table(entry)}</table></div>`
    : `<p class="muted">No games yet.</p>`;
}

async function main() {
  try {
    const [league, data, stats] = await Promise.all([loadLeague(), loadJSON("data/gamelogs.json"), loadJSON("data/stats.json")]);
    TEAM_NAMES = Object.fromEntries(stats.teams.map(t => [t.abbrev, t.name]));
    const logs = data.logs;
    document.getElementById("meta").textContent =
      `${seasonLabel(stats.season)} regular season · game logs updated ${new Date(data.updated).toLocaleString()}`;
    const valid = c => { const [k, m] = (c || "").split("|"); return logs[k] && logs[k].picks.some(p => p.manager === m); };
    const firstOf = m => { const e = Object.entries(logs).find(([, x]) => x.picks.some(p => p.manager === m)); return e && `${e[0]}|${m}`; };
    let choice = [readStore(PICKS_KEY, null), firstOf(me()), firstOf(league.managers[0])].find(valid);
    render(league, logs, choice);
    document.getElementById("pick-controls").addEventListener("change", e => {
      if (e.target.id !== "pick-select") return;
      choice = e.target.value;
      writeStore(PICKS_KEY, choice);
      render(league, logs, choice);
    });
    let lastWidth = innerWidth;
    addEventListener("resize", () => {
      if (innerWidth !== lastWidth) { lastWidth = innerWidth; render(league, logs, choice); }
    });
    spoilerGate(league, [document.getElementById("content")]);
  } catch (err) {
    showError(err);
  }
}

main();
