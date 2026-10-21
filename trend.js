// Trend page: each manager's total minus the league average, at the end of
// every week (Sunday snapshots in data/history).

const PAD = { top: 16, right: 70, bottom: 30, left: 36 };

function niceStep(max) {
  for (const s of [1, 2, 5, 10, 20]) if (max / s <= 4) return s;
  return 50;
}

// A line chart with one line per manager, drawn at the container's real width
// so text stays readable on a phone. Hover/tap snaps to the nearest point and
// lists every manager.
//   xs: x labels; series: [{ name, color, values: [number|null], extra?: [string] }]
//   opts: { id, aria, lim?: [min, max], step?, zeroLabel?, fmt(v), tipTitle(i) }
function drawChart(el, xs, series, opts) {
  const W = Math.max(280, el.clientWidth - 32);
  const H = W < 500 ? 240 : 300;
  const vals = series.flatMap(s => s.values).filter(v => v != null && isFinite(v));
  let [lo, hi] = opts.lim || [Math.min(0, ...vals), Math.max(1, ...vals)];
  const step = opts.step || niceStep(Math.max(1, hi - lo) / 2);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const x = i => xs.length === 1
    ? PAD.left + (W - PAD.left - PAD.right) / 2
    : PAD.left + i * (W - PAD.left - PAD.right) / (xs.length - 1);
  const y = v => PAD.top + (hi - v) * (H - PAD.top - PAD.bottom) / (hi - lo);

  const grid = [];
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid.push(`<line class="${v === 0 && opts.zeroLabel ? "zero" : "gridline"}" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${PAD.left - 8}" y="${y(v) + 4}" text-anchor="end">${opts.axisFmt ? opts.axisFmt(v) : v}</text>`);
  }
  const xLabels = xs.map((t, i) => `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(t)}</text>`);

  // Direct labels at the line ends, nudged apart so they don't overlap
  const lastVal = s => [...s.values].reverse().find(v => v != null && isFinite(v));
  const ends = series.filter(s => lastVal(s) != null).map(s => ({ s, y: y(lastVal(s)) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 14);
  const labels = ends.map(({ s, y: ly }) => `<text class="endlabel" x="${W - PAD.right + 12}" y="${ly + 4}">${esc(s.name)}</text>`);

  // Lines break where a value is missing (e.g. no points yet for € per point)
  const lines = series.map(s => {
    const segs = [[]];
    s.values.forEach((v, k) => { if (v == null || !isFinite(v)) segs.push([]); else segs[segs.length - 1].push(`${x(k)},${y(v)}`); });
    return segs.filter(g => g.length).map(g => `<polyline fill="none" stroke="${s.color}" stroke-width="${s.name === me() ? 3.5 : 2}"
        stroke-linejoin="round" stroke-linecap="round" points="${g.join(" ")}"/>`).join("") +
      s.values.map((v, k) => v == null || !isFinite(v) ? "" : `<circle cx="${x(k)}" cy="${y(v)}" r="4" fill="${s.color}" class="dot"/>`).join("");
  });

  el.innerHTML = `
    <div class="legend">${series.map(s =>
      `<span><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</span>`).join("")}</div>
    <div class="plot">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria)}">
        ${grid.join("")}
        ${opts.zeroLabel && lo < 0 && hi > 0 ? `<text class="axis avg" x="${W - PAD.right + 12}" y="${y(0) - 18}" ${ends.some(e => Math.abs(e.y - (y(0) - 22)) < 12) ? 'visibility="hidden"' : ""}>${opts.zeroLabel}</text>` : ""}
        ${xLabels.join("")}
        <line class="crosshair" y1="${PAD.top}" y2="${H - PAD.bottom}" visibility="hidden"/>
        ${lines.join("")}
        ${labels.join("")}
        <rect class="hit" x="${PAD.left - 20}" y="0" width="${W - PAD.left - PAD.right + 40}" height="${H}" fill="transparent"/>
      </svg>
      <div class="tip" hidden></div>
    </div>`;

  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), cross = el.querySelector(".crosshair");
  const show = evt => {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    let i = 0;
    xs.forEach((_, j) => { if (Math.abs(x(j) - loc.x) < Math.abs(x(i) - loc.x)) i = j; });
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    const rows = series.map(s => ({ s, v: s.values[i], extra: (s.extra || [])[i] }))
      .sort((a, b) => (opts.lowerIsBetter ? 1 : -1) * ((a.v ?? -Infinity) - (b.v ?? -Infinity)) || 0);
    tip.innerHTML = `<b>${opts.tipTitle(i)}</b>
      ${rows.map(r => `<div><span class="swatch" style="background:${r.s.color}"></span>${esc(r.s.name)}
        <span class="num">${r.v == null || !isFinite(r.v) ? "–" : opts.fmt(r.v)}</span>${r.extra ? ` <span class="muted">${r.extra}</span>` : ""}</div>`).join("")}`;
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    const px = x(i) / W * box.width;
    tip.style.left = `${Math.min(Math.max(px - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  const hit = el.querySelector(".hit");
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
}

const shortDay = d => fmtDay(d, { day: "numeric", month: "short" });

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

// A pick's underlying number in one category, as shown to people
function pickStat(cat, e) {
  if (!e || !e.item) return null;
  if (cat.kind === "team") return e.item.pts;
  if (cat.key === "value") return e.cap && e.item.p > 0 ? e.cap / e.item.p * 1000 : null; // k€ per point
  return cat.value(e.item);
}

function statFmt(cat) {
  if (cat.key === "gsax") return v => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
  if (cat.key === "value") return v => `${Math.round(v)} k€/P`;
  if (cat.kind === "team") return v => `${Math.round(v)} pts`;
  return v => `${Math.round(v)} ${cat.unit}`;
}

function renderCategoryTrend(league, points) {
  const saved = readStore(CAT_VIEW_KEY, {});
  const catKey = CATEGORIES.some(c => c.key === saved.cat) ? saved.cat : CATEGORIES[0].key;
  const mode = saved.mode === "stat" ? "stat" : "points";
  const cat = CATEGORIES.find(c => c.key === catKey);

  document.getElementById("cat-controls").innerHTML = `
    <label class="sel"><span class="sr-only">Category</span>
      <select id="cat-select">${CATEGORIES.map(c =>
        `<option value="${c.key}" ${c.key === catKey ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
    <div class="seg" role="group" aria-label="What to show">
      <button type="button" data-mode="points" aria-pressed="${mode === "points"}">Manager points</button>
      <button type="button" data-mode="stat" aria-pressed="${mode === "stat"}">Pick's stat</button>
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
      zeroLabel: cat.key === "gsax" ? "0" : null,
      lowerIsBetter: cat.key === "value",
      fmt: statFmt(cat), tipTitle,
    });
  }
  document.getElementById("cat-note").textContent = mode === "points"
    ? `Category points (${league.scoring.join("/")}) each week in ${cat.label.toLowerCase()}.`
    : cat.key === "value" ? "Cap hit per point in thousands of euros: lower is better. No line before a pick's first point."
    : cat.kind === "team" ? "The picked team's standings points." : `Each manager's pick: ${cat.unit} so far this season.`;
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
