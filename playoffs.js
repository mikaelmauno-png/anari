// Playoffs page: how many of each manager's playoff picks (8 East + 8 West)
// are in a playoff spot right now. 2 points per correct team at season end;
// not included in the standings totals.

const POINTS_PER_TEAM = 2;
const CONFS = [["E", "East"], ["W", "West"]];
const DIVISIONS = { A: "Atlantic", M: "Metro", C: "Central", P: "Pacific" };

// Where a team stands: its playoff seed, or how far it is from the last spot.
function position(team, teams) {
  if (team.clinch === "e") return "eliminated";
  const clinched = team.clinch && team.clinch !== "e" ? " · clinched" : "";
  if (team.divRank <= 3) return `${DIVISIONS[team.div] || team.div} ${team.divRank}${clinched}`;
  if (team.wcRank >= 1 && team.wcRank <= 2) return `Wildcard ${team.wcRank}${clinched}`;
  const line = teams.find(t => t.conf === team.conf && t.wcRank === 2);
  const back = line ? line.pts - team.pts : null;
  return back === null ? "out" : back === 0 ? "out on tiebreak" : `${back} pt${back === 1 ? "" : "s"} back`;
}

function playoffScores(league, stats) {
  const byAbbrev = new Map(stats.teams.map(t => [t.abbrev, t]));
  return league.managers.map(manager => {
    const picks = (league.playoffs || {})[manager] || [];
    const warnings = [];
    const teams = [];
    for (const abbrev of picks) {
      const t = byAbbrev.get(String(abbrev).toUpperCase());
      if (t) teams.push(t);
      else warnings.push(`unknown team "${abbrev}"`);
    }
    for (const [conf, name] of CONFS) {
      const n = teams.filter(t => t.conf === conf).length;
      if (picks.length && n !== 8) warnings.push(`${n} ${name} teams picked, should be 8`);
    }
    const correct = teams.filter(t => t.inPlayoffs).length;
    return { manager, teams, correct, points: correct * POINTS_PER_TEAM, warnings };
  });
}

function render(league, stats) {
  const scores = playoffScores(league, stats);
  const anyPicks = scores.some(s => s.teams.length);
  document.getElementById("meta").textContent =
    `${seasonLabel(stats.season)} · if the season ended today · stats updated ${new Date(stats.updated).toLocaleString()}`;

  if (!anyPicks) {
    document.getElementById("summary").innerHTML = `<p class="muted">No playoff picks entered yet.</p>`;
    return;
  }

  const ranked = scores.slice().sort((a, b) => b.points - a.points);
  document.getElementById("summary").innerHTML = `
    <div class="scroll"><table class="standings">
      <thead><tr><th>#</th><th class="mgr">Manager</th><th>East</th><th>West</th><th>Correct</th><th>Points</th></tr></thead>
      <tbody>${ranked.map(s => `
        <tr>
          <td class="place">${1 + ranked.filter(o => o.points > s.points).length}</td>
          <th scope="row" class="mgr"><span class="swatch" style="background:${managerColor(league, s.manager)}"></span>${esc(s.manager)}</th>
          ${CONFS.map(([c]) => `<td>${s.teams.filter(t => t.conf === c && t.inPlayoffs).length}/${s.teams.filter(t => t.conf === c).length}</td>`).join("")}
          <td>${s.correct}/${s.teams.length}</td>
          <td class="total">${s.points}</td>
        </tr>`).join("")}</tbody>
    </table></div>`;

  document.getElementById("managers").innerHTML = scores.map(s => `
    <section class="card">
      <h3><span class="swatch" style="background:${managerColor(league, s.manager)}"></span>${esc(s.manager)}
        <span class="muted">· ${s.correct} correct · ${s.points} pts</span></h3>
      ${s.warnings.map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join("")}
      ${CONFS.map(([c, name]) => {
        const teams = s.teams.filter(t => t.conf === c).sort((a, b) => b.inPlayoffs - a.inPlayoffs || a.rank - b.rank);
        return teams.length ? `
          <h4>${name}</h4>
          <ul class="teams">${teams.map(t => `
            <li class="${t.inPlayoffs ? "in" : "out"}">
              <span class="mark" aria-label="${t.inPlayoffs ? "in" : "out"}">${t.inPlayoffs ? "✓" : "✕"}</span>
              <span class="name">${esc(t.name)}</span>
              <small>${esc(position(t, stats.teams))}</small>
            </li>`).join("")}</ul>` : "";
      }).join("")}
    </section>`).join("");

  // The current playoff picture, with who picked each team
  document.getElementById("picture").innerHTML = CONFS.map(([c, name]) => {
    const teams = stats.teams.filter(t => t.conf === c).sort((a, b) => b.inPlayoffs - a.inPlayoffs || a.rank - b.rank);
    return `
      <section class="card">
        <h3>${name}</h3>
        <ul class="teams">${teams.map((t, i) => `
          ${i === 8 ? `<li class="cutline"><small>playoff line</small></li>` : ""}
          <li class="${t.inPlayoffs ? "in" : "out"}">
            <span class="name">${esc(t.name)}</span>
            <small>${t.pts} pts · ${esc(position(t, stats.teams))}</small>
            <span class="by">${scores.filter(s => s.teams.includes(t)).map(s =>
              `<span class="swatch" title="${esc(s.manager)}" style="background:${managerColor(league, s.manager)}"></span>`).join("")}</span>
          </li>`).join("")}</ul>
      </section>`;
  }).join("");
  document.getElementById("legend").innerHTML = league.managers.map(m =>
    `<span><span class="swatch" style="background:${managerColor(league, m)}"></span>${esc(m)}</span>`).join("");
}

async function main() {
  try {
    const [league, stats] = await Promise.all([loadLeague(), loadJSON("data/stats.json")]);
    render(league, stats);
  } catch (err) {
    showError(err);
  }
}

main();
