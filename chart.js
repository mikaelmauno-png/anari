// Shared line charts (Trend and Picks pages): one line per series, drawn at
// the container's real width so text stays readable on a phone.

const CHART_PAD = { top: 16, right: 70, bottom: 30, left: 36 };

// The 1/2/5 x 10^n step that wastes the least space above and below the data,
// with 3–6 gridline gaps (fewer only when the data is tiny). `minStep` 1 keeps
// counts like goals on whole numbers.
function niceStep(range, lo = 0, hi = range, minStep = 0) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(range, 1e-9)));
  const cands = [0.1, 0.2, 0.5, 1, 2, 5, 10].map(m => m * mag).filter(st => st >= minStep - 1e-9);
  if (!cands.length) cands.push(minStep);
  let best = null;
  for (const step of cands) {
    const n = Math.round(Math.ceil(hi / step - 1e-9) - Math.floor(lo / step + 1e-9));
    if (n > 6) continue;
    const span = n * step, ok = n >= 3;
    if (!best || ok && !best.ok || ok === best.ok && (ok ? span < best.span : step < best.step)) best = { step, span, ok };
  }
  return best ? best.step : Math.max(minStep, range / 4);
}

// The y range for the data. Starts at 0 when the data is near it (or crosses
// it), otherwise fits the data so close lines don't run together. A lone
// outlier, like €/point after a pick's first point, goes off the scale
// instead of flattening every other line.
function autoRange(vals, opts) {
  if (!vals.length) return [0, 1];
  const sorted = [...vals].sort((a, b) => a - b);
  let lo = sorted[0], hi = sorted[sorted.length - 1];
  if (sorted.length >= 10) {
    const q85 = sorted[Math.round(0.85 * (sorted.length - 1))];
    if (q85 > 0 && hi > 2.5 * q85) hi = q85 * 1.3;
  }
  if (hi === lo) hi = lo + (opts.integer ? 1 : Math.abs(lo) * 0.1 || 1);
  if (opts.zeroLine || (lo <= 0 && hi >= 0)) return [Math.min(lo, 0), Math.max(hi, 0)];
  if (lo > 0 && lo < hi / 2) return [0, hi];
  if (hi < 0 && hi > lo / 2) return [lo, 0];
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
  return [lo - pad, hi + pad];
}

// A line chart with one line per manager, drawn at the container's real width
// so text stays readable on a phone. Hover/tap snaps to the nearest point and
// lists every manager.
//   xs: x labels; series: [{ name, color, values: [number|null], extra?: [string] }]
//   opts: { id, aria, lim?: [min, max], step?, integer?, log?, zeroLabel?, fmt(v), tipTitle(i) }
function drawChart(el, xs, series, opts) {
  const compact = !!opts.compact;  // small multiples: no legend or end labels
  const PAD = compact ? { ...CHART_PAD, right: 14, top: 10 } : CHART_PAD;
  const W = Math.max(compact ? 220 : 280, el.clientWidth - (compact ? 0 : 32));
  const H = compact ? 150 : W < 500 ? 240 : 300;
  const vals = series.flatMap(s => s.values).filter(v => v != null && isFinite(v));
  let lo, hi, ticks, decimals = 0, scale = v => v;
  if (opts.log) {
    // Log scale: equal ratios get equal heights, so 300 vs 400 stays readable
    // next to a 3000 from a pick's first week
    const pos = vals.filter(v => v > 0);
    const dlo = pos.length ? Math.min(...pos) : 1, dhi = pos.length ? Math.max(...pos) : 10;
    const all = [];
    for (let e = Math.floor(Math.log10(dlo)); e <= Math.ceil(Math.log10(dhi)); e++)
      for (const m of [1, 2, 5]) all.push(m * 10 ** e);
    lo = Math.max(...all.filter(t => t <= dlo + 1e-9));
    hi = Math.min(...all.filter(t => t >= dhi - 1e-9));
    if (hi <= lo) hi = all[all.indexOf(lo) + 1];
    ticks = all.filter(t => t >= lo && t <= hi);
    if (ticks.length > 6) ticks = ticks.filter(t => t === lo || t === hi || !/^2/.test(String(t)));
    scale = Math.log10;
  } else {
    [lo, hi] = opts.lim || autoRange(vals, opts);
    const step = opts.step || niceStep(hi - lo || Math.abs(hi) || 1, lo, hi, opts.integer ? 1 : 0);
    lo = Math.floor(lo / step + 1e-9) * step; hi = Math.ceil(hi / step - 1e-9) * step;
    if (hi <= lo) hi = lo + step;
    decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    ticks = [];
    for (let k = 0; lo + k * step <= hi + 1e-9; k++) ticks.push(+(lo + k * step).toFixed(decimals));  // no 0.30000000000000004 labels
  }
  const clip = v => Math.min(Math.max(v, lo), hi);
  const x = i => xs.length === 1
    ? PAD.left + (W - PAD.left - PAD.right) / 2
    : PAD.left + i * (W - PAD.left - PAD.right) / (xs.length - 1);
  const y = v => PAD.top + (scale(hi) - scale(clip(v))) * (H - PAD.top - PAD.bottom) / (scale(hi) - scale(lo));

  const grid = [];
  for (const v of ticks) {
    grid.push(`<line class="${v === 0 && (opts.zeroLabel || opts.zeroLine) ? "zero" : "gridline"}" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${PAD.left - 8}" y="${y(v) + 4}" text-anchor="end">${opts.axisFmt ? opts.axisFmt(v) : v.toFixed(decimals)}</text>`);
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
      s.values.map((v, k) => v == null || !isFinite(v) ? "" : v > hi || v < lo
        // Off the scale: a hollow dot on the edge (the tooltip has the real value)
        ? `<circle cx="${x(k)}" cy="${y(v)}" r="4" fill="var(--card)" stroke="${s.color}" stroke-width="2" class="dot off"/>`
        : `<circle cx="${x(k)}" cy="${y(v)}" r="4" fill="${s.color}" class="dot"/>`).join("");
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

