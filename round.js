// Last round page: the last game night (how everyone's picks did, plus all
// scores) and the change in fantasy scores this week and last week.

// What each category cares about in a single game's stat line.
function nightLine(cat, line) {
  switch (cat.key) {
    case "goals": return `${line.g} G`;
    case "pim": return `${line.pim} PIM`;
    case "gsax": {
      const gsax = line.gsax === null ? "GSAx pending" : `${line.gsax > 0 ? "+" : ""}${line.gsax.toFixed(2)} GSAx`;
      return `${line.sv}/${line.sa} saves · ${gsax}`;
    }
    default: return `${line.g} G ${line.a} A · ${line.p} P`;
  }
}

function teamResult(abbrev, games) {
  for (const g of games) {
    const us = g.away.abbrev === abbrev ? g.away : g.home.abbrev === abbrev ? g.home : null;
    if (!us) continue;
    const them = us === g.away ? g.home : g.away;
    const won = us.score > them.score;
    const extra = g.ending === "OT" || g.ending === "SO";
    const pts = won ? 2 : extra ? 1 : 0;
    return `${won ? "W" : extra ? g.ending + "L" : "L"} ${us.score}–${them.score} ${us === g.away ? "at" : "vs"} ${them.abbrev} · +${pts} pts`;
  }
  return null;
}

// Each manager's picks that played on the night, one row per player even if
// he was picked in several categories.
function nightForManager(league, stats, night, manager) {
  const skaterLines = new Map(night.skaters.map(s => [s.id, s]));
  const goalieLines = new Map(night.goalies.map(g => [g.id, g]));
  const rows = new Map();
  const idle = new Set();
  for (const cat of CATEGORIES) {
    for (const pick of (league.picks[cat.key] || {})[manager] || []) {
      const pool = { skater: stats.skaters, goalie: stats.goalies, team: stats.teams }[cat.kind];
      const { item } = resolve(pick, pool, cat.kind, cat.check);
      if (!item) continue;
      let text;
      if (cat.kind === "team") text = teamResult(item.abbrev, night.games);
      else {
        const line = (cat.kind === "goalie" ? goalieLines : skaterLines).get(item.id);
        text = line && nightLine(cat, line);
      }
      const key = `${cat.kind}:${item.id || item.abbrev}`;
      if (!text) { idle.add(item.name); continue; }
      if (!rows.has(key)) rows.set(key, { name: item.name, team: item.team, cats: [], lines: [] });
      const row = rows.get(key);
      row.cats.push(SHORT[cat.key]);
      if (!row.lines.includes(text)) row.lines.push(text);
    }
  }
  for (const r of rows.values()) idle.delete(r.name);
  return { rows: [...rows.values()], idle: [...idle] };
}

function renderNight(league, stats, night) {
  const managers = league.managers.map(m => {
    const { rows, idle } = nightForManager(league, stats, night, m);
    return `
      <section class="card">
        <h3><span class="swatch" style="background:${managerColor(league, m)}"></span>${esc(m)}</h3>
        ${rows.length ? `<ul class="lines">${rows.map(r => `
          <li><span><b>${esc(r.name)}</b> ${r.team ? `<small>${esc(r.team)}</small>` : ""}
            <small class="cats">${r.cats.join(" · ")}</small></span>
            <span class="val">${r.lines.map(esc).join("<br>")}</span></li>`).join("")}</ul>`
          : `<p class="muted">No picks played.</p>`}
        ${idle.length ? `<p class="hint">Didn't play: ${idle.map(esc).join(", ")}</p>` : ""}
      </section>`;
  }).join("");

  const games = night.games.map(g => {
    const awayWon = g.away.score > g.home.score;
    return `<li>
      <span class="${awayWon ? "win" : ""}">${esc(g.away.abbrev)} ${g.away.score}</span>
      <span class="muted">–</span>
      <span class="${awayWon ? "" : "win"}">${g.home.score} ${esc(g.home.abbrev)}</span>
      ${g.ending !== "REG" ? `<small>${esc(g.ending)}</small>` : ""}</li>`;
  }).join("");

  document.getElementById("night-title").textContent = `Last game night · ${fmtDay(night.date)}`;
  document.getElementById("night").innerHTML = `
    <div class="grid">${managers}</div>
    <h3 class="sub">Scores</h3>
    <ul class="scores card">${games}</ul>`;
}

// Fantasy score change between two moments. `from` may be null (season start).
function renderChange(el, league, from, to) {
  const before = from ? computeStandings(league, from).table : null;
  const after = computeStandings(league, to).table;
  const rows = after.map(r => {
    const b = before && before.find(x => x.manager === r.manager);
    const start = b ? b.total : 0;
    const delta = r.total - start;
    const moves = CATEGORIES.map(c => {
      const d = r.byCat[c.key] - (b ? b.byCat[c.key] : 0);
      return d && b ? `<span class="chip ${d > 0 ? "up" : "down"}">${SHORT[c.key]} ${d > 0 ? "+" : "−"}${Math.abs(d)}</span>` : "";
    }).join("");
    return `
      <tr class="${b ? "has-moves" : ""}">
        <td class="place">${r.place}</td>
        <th scope="row" class="mgr"><span class="swatch" style="background:${managerColor(league, r.manager)}"></span>${esc(r.manager)}</th>
        <td>${b ? start : "–"}</td>
        <td class="total">${r.total}</td>
        <td class="${delta > 0 ? "up" : delta < 0 ? "down" : "muted"}">${b ? (delta > 0 ? "+" : delta < 0 ? "−" : "±") + Math.abs(delta) : ""}</td>
      </tr>
      ${b ? `<tr class="moves"><td></td><td colspan="4">${moves || `<span class="muted">no change</span>`}</td></tr>` : ""}`;
  }).join("");
  el.innerHTML = `
    <div class="scroll"><table>
      <thead><tr><th>#</th><th class="mgr">Manager</th><th>Start</th><th>End</th><th>±</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

async function main() {
  try {
    const [league, stats, night, index] = await Promise.all([
      loadLeague(), loadJSON("data/stats.json"),
      loadJSON("data/lastnight.json"), loadJSON("data/history/index.json"),
    ]);
    document.getElementById("meta").textContent = `${seasonLabel(stats.season)} regular season`;
    renderNight(league, stats, night);

    const [prev, last] = [index[index.length - 2], index[index.length - 1]];
    const snaps = await Promise.all([prev, last].map(d => d ? loadJSON(`data/history/${d}.json`) : null));
    if (last) {
      document.getElementById("week-title").textContent = `This week so far · since ${fmtDay(last)}`;
      renderChange(document.getElementById("week"), league, snaps[1], stats);
      const start = prev ? new Date(prev + "T12:00:00") : null;
      if (start) start.setDate(start.getDate() + 1);
      document.getElementById("lastweek-title").textContent =
        `Last week · ${start ? fmtDay(start.toISOString().slice(0, 10), { day: "numeric", month: "short" }) + "–" : "to "}${fmtDay(last, { day: "numeric", month: "short" })}`;
      renderChange(document.getElementById("lastweek"), league, snaps[0], snaps[1]);
    }
  } catch (err) {
    showError(err);
  }
}

main();
