// Shared line charts (Trend and Picks pages): one line per series, drawn at
// the container's real width so text stays readable on a phone.

const CHART_PAD = { top: 16, right: 70, bottom: 30, left: 36 };

// The smallest 1/2/5 x 10^n step that covers `range` in at most 4 steps
function niceStep(range) {
  const raw = Math.max(range, 1e-9) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (raw <= m * mag + 1e-9) return Math.max(m * mag, 1e-9);
  return 10 * mag;
}

// A line chart with one line per manager, drawn at the container's real width
// so text stays readable on a phone. Hover/tap snaps to the nearest point and
// lists every manager.
//   xs: x labels; series: [{ name, color, values: [number|null], extra?: [string] }]
//   opts: { id, aria, lim?: [min, max], step?, zeroLabel?, fmt(v), tipTitle(i) }
function drawChart(el, xs, series, opts) {
  const compact = !!opts.compact;  // small multiples: no legend or end labels
  const PAD = compact ? { ...CHART_PAD, right: 14, top: 10 } : CHART_PAD;
  const W = Math.max(compact ? 220 : 280, el.clientWidth - (compact ? 0 : 32));
  const H = compact ? 150 : W < 500 ? 240 : 300;
  const vals = series.flatMap(s => s.values).filter(v => v != null && isFinite(v));
  let [lo, hi] = opts.lim || [Math.min(0, ...vals), Math.max(1, ...vals)];
  const step = opts.step || niceStep(Math.max(1, hi - lo));
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const x = i => xs.length === 1
    ? PAD.left + (W - PAD.left - PAD.right) / 2
    : PAD.left + i * (W - PAD.left - PAD.right) / (xs.length - 1);
  const y = v => PAD.top + (hi - v) * (H - PAD.top - PAD.bottom) / (hi - lo);

  const grid = [];
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid.push(`<line class="${v === 0 && (opts.zeroLabel || opts.zeroLine) ? "zero" : "gridline"}" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${PAD.left - 8}" y="${y(v) + 4}" text-anchor="end">${opts.axisFmt ? opts.axisFmt(v) : v}</text>`);
  }
  const xLabels = xs.map((t, i) => `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(t)}</text>`);

  // Direct labels at the line ends, nudged apart so they don't overlap
  const lastVal = s => [...s.values].reverse().find(v => v != null && isFinite(v));
  const ends = series.filter(s => lastVal(s) != null).map(s => ({ s, y: y(lastVal(s)) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 14);
  const labels = compact ? [] : ends.map(({ s, y: ly }) => `<text class="endlabel" x="${W - PAD.right + 12}" y="${ly + 4}">${esc(s.name)}</text>`);

  // Lines break where a value is missing (e.g. no points yet for € per point)
  const lines = series.map(s => {
    const segs = [[]];
    s.values.forEach((v, k) => { if (v == null || !isFinite(v)) segs.push([]); else segs[segs.length - 1].push(`${x(k)},${y(v)}`); });
    return segs.filter(g => g.length).map(g => `<polyline fill="none" stroke="${s.color}" stroke-width="${s.name === me() ? 3.5 : 2}"
        stroke-linejoin="round" stroke-linecap="round" points="${g.join(" ")}"/>`).join("") +
      s.values.map((v, k) => v == null || !isFinite(v) ? "" : `<circle cx="${x(k)}" cy="${y(v)}" r="4" fill="${s.color}" class="dot"/>`).join("");
  });

  el.innerHTML = `
    ${compact ? "" : `<div class="legend">${series.map(s =>
      `<span><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</span>`).join("")}</div>`}
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

