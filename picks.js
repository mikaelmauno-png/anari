// Picks page: one manager's season so far. Their total and place by week, and
// for every category how their pick's stat and place developed (Sunday
// snapshots plus the latest stats as "Now").

const PICKS_MANAGER_KEY = "anari-picks-manager";
const ordinal = n => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

function render(league, points, manager) {
  const xs = points.map(p => p.date ? shortDay(p.date) : "Now");
  const tipTitle = i => points[i].date ? `Week to ${shortDay(points[i].date)}` : "Now";
  const color = managerColor(league, manager);
  const now = points[points.length - 1];
  const row = now.table.find(r => r.manager === manager);

  document.getElementById("pick-controls").innerHTML = `
    <label class="sel"><span class="sel-label">Manager</span>
      <span class="sel-box"><select id="manager-select">${league.managers.map(m =>
        `<option value="${esc(m)}" ${m === manager ? "selected" : ""}>${esc(m)}${m === me() ? " (you)" : ""}</option>`).join("")}</select>
        <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span></label>`;

  // Total points and place by week
  document.getElementById("total-title").innerHTML =
    `<span class="swatch" style="background:${color}"></span>${esc(manager)} · ${ordinal(row.place)} · ${row.total} points`;
  drawChart(document.getElementById("total-chart"), xs, [{
    name: manager, color,
    values: points.map(p => p.table.find(r => r.manager === manager).total),
    extra: points.map(p => ordinal(p.table.find(r => r.manager === manager).place)),
  }], { compact: true, aria: `${manager}'s total points by week`, fmt: v => `${v} pts`, tipTitle });

  // One card per category
  const el = document.getElementById("cats");
  el.innerHTML = CATEGORIES.map(cat => {
    const es = points.map(p => p.byCat[cat.key].find(e => e.manager === manager));
    const cur = es[es.length - 1];
    const stat = pickStat(cat, cur);
    const pickName = cur && cur.item ? cur.item.name : "–";
    const team = cur && cur.item && cat.kind !== "team" ? cur.item.team : "";
    return `
      <section class="card cat-card">
        <div class="cat-head">
          <h3>${esc(cat.label)}</h3>
          <span class="pts ${cur && cur.points ? "up" : "muted"}">${cur ? `${cur.tied ? "T" : ""}${ordinal(cur.place)} · +${cur.points}` : ""}</span>
        </div>
        <p class="pick-line"><b>${esc(pickName)}</b> ${team ? `<small>${esc(team)}</small>` : ""}
          <span class="muted">· ${stat == null ? "no points yet" : statFmt(cat)(stat)}</span></p>
        <div class="mini" id="mini-${cat.key}"></div>
        <p class="places">${es.map((e, i) => `<span title="${esc(xs[i])}">${esc(xs[i])} <b>${e ? `${e.tied ? "T" : ""}${e.place}` : "–"}</b></span>`).join("")}</p>
      </section>`;
  }).join("");
  for (const cat of CATEGORIES) {
    const es = points.map(p => p.byCat[cat.key].find(e => e.manager === manager));
    drawChart(document.getElementById(`mini-${cat.key}`), xs, [{
      name: manager, color,
      values: es.map(e => pickStat(cat, e)),
      extra: es.map(e => e ? `${e.tied ? "T" : ""}${ordinal(e.place)} · +${e.points}` : ""),
    }], {
      compact: true, aria: `${manager}'s ${cat.label} pick by week`,
      zeroLine: cat.key === "gsax", lowerIsBetter: cat.key === "value",
      fmt: statFmt(cat), tipTitle,
    });
  }
}

async function main() {
  try {
    const [league, index, now] = await Promise.all([
      loadLeague(), loadJSON("data/history/index.json"), loadJSON("data/stats.json"),
    ]);
    const snaps = await Promise.all(index.map(d => loadJSON(`data/history/${d}.json`)));
    const points = [...snaps.map((st, i) => ({ date: index[i], st })), { date: null, st: now }].map(p => {
      const { results, table } = computeStandings(league, p.st);
      return { date: p.date, table, byCat: Object.fromEntries(results.map(r => [r.cat.key, r.entries])) };
    });
    document.getElementById("meta").textContent =
      `${seasonLabel(now.season)} regular season · each Sunday plus the latest stats`;

    const saved = readStore(PICKS_MANAGER_KEY, null);
    let manager = [saved, me(), league.managers[0]].find(m => league.managers.includes(m));
    render(league, points, manager);
    document.getElementById("pick-controls").addEventListener("change", e => {
      if (e.target.id !== "manager-select") return;
      manager = e.target.value;
      writeStore(PICKS_MANAGER_KEY, manager);
      render(league, points, manager);
    });
    let lastWidth = innerWidth;
    addEventListener("resize", () => {
      if (innerWidth !== lastWidth) { lastWidth = innerWidth; render(league, points, manager); }
    });
    spoilerGate(league, [document.getElementById("content")]);
  } catch (err) {
    showError(err);
  }
}

main();
