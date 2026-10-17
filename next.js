// Next round page: who plays on the next game night (with opponents and local
// start times), and each manager's games over the next 7 days.

// Each manager's picks as one row per player/team, even if picked in several
// categories, with the NHL team whose games count for it.
function managerPicks(league, stats, manager) {
  const rows = new Map();
  for (const cat of CATEGORIES) {
    for (const pick of (league.picks[cat.key] || {})[manager] || []) {
      const pool = { skater: stats.skaters, goalie: stats.goalies, team: stats.teams }[cat.kind];
      const { item } = resolve(pick, pool, cat.kind, cat.check);
      if (!item) continue;
      const team = cat.kind === "team" ? item.abbrev : item.team;
      const key = `${cat.kind}:${item.id || item.abbrev}`;
      if (!rows.has(key)) rows.set(key, { name: item.name, team, kind: cat.kind, cats: [] });
      rows.get(key).cats.push(SHORT[cat.key]);
    }
  }
  return [...rows.values()];
}

const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function renderNextNight(league, stats, schedule) {
  const day = schedule.from;
  const games = schedule.games.filter(g => g.date === day);
  const gameOf = team => games.find(g => g.away === team || g.home === team);
  document.getElementById("night-title").textContent =
    `Next game night · ${fmtDay(day)} · first game ${fmtTime(games[0].start)}`;

  const cards = league.managers.map(m => {
    const picks = managerPicks(league, stats, m);
    const playing = picks.filter(p => gameOf(p.team)).sort((a, b) => gameOf(a.team).start.localeCompare(gameOf(b.team).start));
    const idle = picks.filter(p => !gameOf(p.team));
    return `
      <section class="card">
        <h3><span class="swatch" style="background:${managerColor(league, m)}"></span>${esc(m)}
          <span class="muted">· ${playing.length} of ${picks.length} playing</span></h3>
        ${playing.length ? `<ul class="lines">${playing.map(p => {
          const g = gameOf(p.team);
          const home = g.home === p.team;
          return `<li><span><b>${esc(p.name)}</b> ${p.kind !== "team" ? `<small>${esc(p.team)}</small>` : ""}
              <small class="cats">${p.cats.join(" · ")}</small></span>
            <span class="val">${home ? "vs" : "at"} ${esc(home ? g.away : g.home)}<br><small>${fmtTime(g.start)}</small></span></li>`;
        }).join("")}</ul>` : `<p class="muted">No picks playing.</p>`}
        ${idle.length ? `<p class="hint">Not playing: ${idle.map(p => esc(p.name)).join(", ")}</p>` : ""}
      </section>`;
  }).join("");

  // Every game that night, with who has a pick involved
  const pickedBy = team => league.managers.filter(m => managerPicks(league, stats, m).some(p => p.team === team));
  const dots = team => pickedBy(team).map(m =>
    `<span class="swatch" title="${esc(m)}" style="background:${managerColor(league, m)}"></span>`).join("");
  document.getElementById("night").innerHTML = `
    <div class="grid">${cards}</div>
    <h3 class="sub">Games</h3>
    <ul class="games card">${games.map(g => `
      <li><span class="time">${fmtTime(g.start)}</span>
        <span>${esc(g.away)} ${dots(g.away)}</span><span class="muted">at</span><span>${esc(g.home)} ${dots(g.home)}</span></li>`).join("")}</ul>`;
}

function renderWeekAhead(league, stats, schedule) {
  const games = {};
  for (const g of schedule.games) for (const t of [g.away, g.home]) games[t] = (games[t] || 0) + 1;
  const cards = league.managers.map(m => {
    const list = managerPicks(league, stats, m).map(p => ({ ...p, n: games[p.team] || 0 })).sort((a, b) => b.n - a.n);
    return { m, list, total: list.reduce((s, r) => s + r.n, 0) };
  });
  const most = Math.max(...cards.map(c => c.total));
  document.getElementById("ahead-title").textContent =
    `Next 7 days · ${fmtDay(schedule.from, { day: "numeric", month: "short" })}–${fmtDay(schedule.to, { day: "numeric", month: "short" })}`;
  document.getElementById("ahead").innerHTML = `<div class="grid">${cards.map(c => `
    <section class="card">
      <h3><span class="swatch" style="background:${managerColor(league, c.m)}"></span>${esc(c.m)}
        <span class="muted">· ${c.total} games${c.total === most ? " · most" : ""}</span></h3>
      <ul class="lines">${c.list.map(r => `
        <li><span><b>${esc(r.name)}</b> ${r.kind !== "team" ? `<small>${esc(r.team)}</small>` : ""}
          <small class="cats">${r.cats.join(" · ")}</small></span>
          <span class="val ${r.n >= 4 ? "up" : r.n <= 2 ? "muted" : ""}">${r.n} game${r.n === 1 ? "" : "s"}</span></li>`).join("")}</ul>
    </section>`).join("")}</div>
    <p class="hint">Games each pick's team plays; a goalie won't start all of them. Four-game weeks are highlighted.</p>`;
}

async function main() {
  try {
    const [league, stats, schedule] = await Promise.all([
      loadLeague(), loadJSON("data/stats.json"), loadJSON("data/schedule.json"),
    ]);
    document.getElementById("meta").textContent = `${seasonLabel(stats.season)} regular season · times in your time zone`;
    if (!schedule.from || !schedule.games.length) {
      document.getElementById("night").innerHTML = `<p class="muted">No regular-season games in the next 7 days.</p>`;
      return;
    }
    renderNextNight(league, stats, schedule);
    renderWeekAhead(league, stats, schedule);
  } catch (err) {
    showError(err);
  }
}

main();
