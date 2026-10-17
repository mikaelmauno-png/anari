// Trend page: each manager's total minus the league average, at the end of
// every week (Sunday snapshots in data/history).

const PAD = { top: 16, right: 70, bottom: 30, left: 36 };

function niceStep(max) {
  for (const s of [1, 2, 5, 10, 20]) if (max / s <= 4) return s;
  return 50;
}

function renderChart(league, weeks) {
  // Drawn at the card's real width so text stays readable on a phone
  const box = document.getElementById("chart");
  const W = Math.max(280, box.clientWidth - 32);
  const H = W < 500 ? 240 : 300;
  const series = league.managers.map(m => ({
    manager: m,
    color: managerColor(league, m),
    points: weeks.map(w => ({ date: w.date, diff: w.diff[m], total: w.total[m] })),
  }));

  const maxAbs = Math.max(1, ...weeks.flatMap(w => Object.values(w.diff).map(Math.abs)));
  const step = niceStep(maxAbs);
  const lim = Math.ceil(maxAbs / step) * step;
  const x = i => weeks.length === 1
    ? PAD.left + (W - PAD.left - PAD.right) / 2
    : PAD.left + i * (W - PAD.left - PAD.right) / (weeks.length - 1);
  const y = v => PAD.top + (lim - v) * (H - PAD.top - PAD.bottom) / (2 * lim);

  const grid = [];
  for (let v = -lim; v <= lim; v += step) {
    grid.push(`<line class="${v === 0 ? "zero" : "gridline"}" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${PAD.left - 8}" y="${y(v) + 4}" text-anchor="end">${v > 0 ? "+" : ""}${v}</text>`);
  }
  const xLabels = weeks.map((w, i) =>
    `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDay(w.date, { day: "numeric", month: "short" })}</text>`);

  // Direct labels at the line ends, nudged apart so they don't overlap
  const ends = series.map(s => ({ s, y: y(s.points[s.points.length - 1].diff) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
  const labels = ends.map(({ s, y: ly }) =>
    `<text class="endlabel" x="${W - PAD.right + 12}" y="${ly + 4}">${esc(s.manager)}</text>`);

  const lines = series.map(s => `
    <polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
      points="${s.points.map((p, i) => `${x(i)},${y(p.diff)}`).join(" ")}"/>
    ${s.points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.diff)}" r="4" fill="${s.color}" class="dot"/>`).join("")}`);

  document.getElementById("chart").innerHTML = `
    <div class="legend">${series.map(s =>
      `<span><span class="swatch" style="background:${s.color}"></span>${esc(s.manager)}</span>`).join("")}</div>
    <div class="plot">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fantasy points above or below the league average, by week">
        ${grid.join("")}
        <text class="axis avg" x="${W - PAD.right + 12}" y="${y(0) - 18}" ${ends.some(e => Math.abs(e.y - (y(0) - 22)) < 12) ? 'visibility="hidden"' : ""}>avg</text>
        ${xLabels.join("")}
        <line id="crosshair" class="crosshair" y1="${PAD.top}" y2="${H - PAD.bottom}" visibility="hidden"/>
        ${lines.join("")}
        ${labels.join("")}
        <rect id="hit" x="${PAD.left - 20}" y="0" width="${W - PAD.left - PAD.right + 40}" height="${H}" fill="transparent"/>
      </svg>
      <div id="tip" class="tip" hidden></div>
    </div>`;

  // Hover / touch: snap to the nearest week and list every manager
  const svg = document.querySelector("#chart svg");
  const tip = document.getElementById("tip");
  const cross = document.getElementById("crosshair");
  const show = evt => {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    let i = 0;
    weeks.forEach((_, j) => { if (Math.abs(x(j) - loc.x) < Math.abs(x(i) - loc.x)) i = j; });
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    const rows = series.map(s => s.points[i]).map((p, k) => ({ ...p, s: series[k] })).sort((a, b) => b.diff - a.diff);
    tip.innerHTML = `<b>Week to ${fmtDay(weeks[i].date, { day: "numeric", month: "short" })}</b>
      <span class="muted">avg ${weeks[i].avg.toFixed(1)}</span>
      ${rows.map(r => `<div><span class="swatch" style="background:${r.s.color}"></span>${esc(r.s.manager)}
        <span class="num">${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}</span> <span class="muted">(${r.total})</span></div>`).join("")}`;
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    const px = x(i) / W * box.width;
    tip.style.left = `${Math.min(Math.max(px - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  const hit = document.getElementById("hit");
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
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
    const [league, index] = await Promise.all([loadJSON("league.json"), loadJSON("data/history/index.json")]);
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
    let lastWidth = innerWidth;
    addEventListener("resize", () => {
      if (innerWidth !== lastWidth) { lastWidth = innerWidth; renderChart(league, weeks); }
    });
  } catch (err) {
    showError(err);
  }
}

main();
