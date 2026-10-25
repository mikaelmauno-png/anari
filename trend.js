// Trend page: each manager's total minus the league average, at the end of
// every week (Sunday snapshots in data/history).

// The main chart: each manager's total minus the league average, by week
function renderChart(league, weeks) {
  const maxAbs = Math.max(1, ...weeks.flatMap(w => Object.values(w.diff).map(Math.abs)));
  const step = niceStep(maxAbs);
  const lim = Math.ceil(maxAbs / step) * step;
  drawChart(document.getElementById("chart"), weeks.map(w => shortDay(w.date)),
    league.managers.map(m => ({
      name: m, color: managerColor(league, m),
      values: weeks.map(w => w.diff[m]),
      extra: weeks.map(w => `(${w.total[m]})`),
    })), {
      aria: "Fantasy points above or below the league average, by week",
      lim: [-lim, lim], step, zeroLabel: "avg",
      axisFmt: v => `${v > 0 ? "+" : ""}${v}`,
      fmt: v => `${v > 0 ? "+" : ""}${v.toFixed(1)}`,
      tipTitle: i => `Week to ${shortDay(weeks[i].date)} <span class="muted">avg ${weeks[i].avg.toFixed(1)}</span>`,
    });
}

// ---------- category trend ----------

const CAT_VIEW_KEY = "anari-trend-category";

function renderCategoryTrend(league, points) {
  const saved = readStore(CAT_VIEW_KEY, {});
  const catKey = CATEGORIES.some(c => c.key === saved.cat) ? saved.cat : CATEGORIES[0].key;
  const mode = saved.mode === "points" ? "points" : "stat";  // pick's stat is the default
  const cat = CATEGORIES.find(c => c.key === catKey);

  document.getElementById("cat-controls").innerHTML = `
    <label class="sel"><span class="sel-label">Category</span>
      <span class="sel-box"><select id="cat-select">${CATEGORIES.map(c =>
        `<option value="${c.key}" ${c.key === catKey ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
        <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span></label>
    <div class="seg" role="group" aria-label="What to show">
      <button type="button" data-mode="stat" aria-pressed="${mode === "stat"}">Pick's stat</button>
      <button type="button" data-mode="points" aria-pressed="${mode === "points"}">Manager points</button>
    </div>`;

  const xs = points.map(p => p.date ? shortDay(p.date) : "Now");
  const series = league.managers.map(m => {
    const es = points.map(p => p.byCat[catKey].find(e => e.manager === m));
    return {
      name: m, color: managerColor(league, m),
      values: es.map(e => mode === "points" ? (e ? e.points : null) : pickStat(cat, e)),
      extra: es.map(e => !e || !e.item ? "" : mode === "points"
        ? `${e.tied ? "T" : ""}${e.place}. · ${esc(e.item.name)}`
        : esc(e.item.name)),
    };
  });
  const tipTitle = i => points[i].date ? `Week to ${shortDay(points[i].date)}` : "Now";
  const el = document.getElementById("cat-chart");
  if (mode === "points") {
    drawChart(el, xs, series, {
      aria: `${cat.label}: category points per manager by week`,
      lim: [0, Math.max(...league.scoring)], step: 1,
      fmt: v => `${v} pts`, tipTitle,
    });
  } else {
    drawChart(el, xs, series, {
      aria: `${cat.label}: each manager's pick by week`,
      zeroLine: cat.key === "gsax",
      lowerIsBetter: cat.key === "value",
      fmt: statFmt(cat), tipTitle,
    });
  }
  document.getElementById("cat-note").textContent = mode === "points"
    ? `Category points (${league.scoring.join("/")}) each week in ${cat.label.toLowerCase()}.`
    : cat.key === "value" ? "Cap hit per point in thousands of euros: lower is better. No line before a pick's first point."
    : cat.kind === "team" ? "The picked team's standings points."
    : `Each manager's pick: ${{ G: "goals", P: "points", PIM: "penalty minutes" }[cat.unit] || cat.unit} so far this season.`;
}

function renderTable(league, weeks) {
  const head = league.managers.map(m =>
    `<th><span class="swatch" style="background:${managerColor(league, m)}"></span>${esc(m)}</th>`).join("");
  const rows = weeks.slice().reverse().map(w => `
    <tr>
      <th scope="row" class="mgr">${fmtDay(w.date, { day: "numeric", month: "short" })}</th>
      ${league.managers.map(m => `<td><span class="${w.diff[m] > 0 ? "up" : w.diff[m] < 0 ? "down" : ""}">${w.diff[m] > 0 ? "+" : ""}${w.diff[m].toFixed(1)}</span>
        <small>${w.total[m]}</small></td>`).join("")}
      <td class="muted">${w.avg.toFixed(1)}</td>
    </tr>`).join("");
  document.getElementById("table").innerHTML = `
    <div class="scroll"><table>
      <thead><tr><th class="mgr">Week to</th>${head}<th>Avg</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

async function main() {
  try {
    const [league, index] = await Promise.all([loadLeague(), loadJSON("data/history/index.json")]);
    if (!index.length) {
      document.getElementById("chart").innerHTML = `<p class="muted">No weekly snapshots yet.</p>`;
      return;
    }
    const snaps = await Promise.all(index.map(d => loadJSON(`data/history/${d}.json`)));
    const weeks = snaps.map((stats, i) => {
      const { table } = computeStandings(league, stats);
      const total = Object.fromEntries(table.map(r => [r.manager, r.total]));
      const avg = table.reduce((s, r) => s + r.total, 0) / table.length;
      const diff = Object.fromEntries(table.map(r => [r.manager, r.total - avg]));
      return { date: index[i], total, avg, diff };
    });
    document.getElementById("meta").textContent =
      `${seasonLabel(snaps[0].season)} regular season · updated weekly, after Sunday's games`;
    renderChart(league, weeks);
    renderTable(league, weeks);

    // Category trend: every Sunday snapshot plus the latest stats as "Now"
    const now = await loadJSON("data/stats.json");
    const points = [...snaps.map((st, i) => ({ date: index[i], st })), { date: null, st: now }].map(p => {
      const { results } = computeStandings(league, p.st);
      return { date: p.date, byCat: Object.fromEntries(results.map(r => [r.cat.key, r.entries])) };
    });
    renderCategoryTrend(league, points);
    document.getElementById("cat-controls").addEventListener("change", e => {
      if (e.target.id !== "cat-select") return;
      writeStore(CAT_VIEW_KEY, { ...readStore(CAT_VIEW_KEY, {}), cat: e.target.value });
      renderCategoryTrend(league, points);
    });
    document.getElementById("cat-controls").addEventListener("click", e => {
      const b = e.target.closest("[data-mode]");
      if (!b) return;
      writeStore(CAT_VIEW_KEY, { ...readStore(CAT_VIEW_KEY, {}), mode: b.dataset.mode });
      renderCategoryTrend(league, points);
    });

    let lastWidth = innerWidth;
    addEventListener("resize", () => {
      if (innerWidth !== lastWidth) { lastWidth = innerWidth; renderChart(league, weeks); renderCategoryTrend(league, points); }
    });
  } catch (err) {
    showError(err);
  }
}

main();
