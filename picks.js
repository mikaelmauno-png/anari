// Picks page: game-by-game stats of any pick (player or team), chosen from a
// menu grouped by manager. Data: data/gamelogs.json from the stats update.
//
// A "pick" here is one (player or team, manager, category) combination, written
// as the string "entryKey|manager|cat", e.g. "skater:8478402|Mauno|goals".
// The same player can be one manager's pick in two categories (McDavid for
// both goals and points), and each of those has its own chart.

const PICKS_KEY = "anari-picks-choice";
const COMPARE_KEY = "anari-picks-compare";  // the picks drawn on top of the chart
const CAT_NAMES = Object.fromEntries(CATEGORIES.map(c => [c.key, SHORT[c.key]]));
const CAT_ORDER = CATEGORIES.map(c => c.key);

const vsAt = g => `${g.home ? "vs" : "at"} ${g.opp}`;
const gameDay = d => fmtDay(d, { weekday: "short", day: "numeric", month: "short" });
const sum = (games, k) => games.reduce((s, g) => s + (g[k] || 0), 0);

// Pick string <-> its parts
const pickId = (key, manager, cat) => `${key}|${manager}|${cat}`;
const parsePick = id => { const [key, manager, cat] = (id || "").split("|"); return { key, manager, cat }; };

// What the chart builds up over the season for a category. Picks with the same
// `key` measure the same thing, so only those can share a chart: all the
// points categories (P, FIN, ROO, €/P) together, goals with goals, and so on.
function catStat(cat) {
  if (cat === "gsax") return { key: "gsax", label: "GSAx", fmt: v => `${v > 0 ? "+" : ""}${v.toFixed(2)}` };
  if (cat === "presidents") return { key: "pts", label: "standings points", fmt: v => `${v} pts` };
  if (cat === "pim") return { key: "pim", label: "PIM", fmt: v => `${v} PIM` };
  if (cat === "goals") return { key: "g", label: "goals", fmt: v => `${v} G` };
  return { key: "p", label: "points", fmt: v => `${v} P` };  // points, finnish, rookies, value
}

// Every pick in the league, in manager order and then category order
function allPicks(league, logs) {
  const out = [];
  for (const m of league.managers)
    for (const cat of CAT_ORDER)
      for (const [key, e] of Object.entries(logs))
        if (e.picks.some(p => p.manager === m && p.cat === cat)) out.push({ id: pickId(key, m, cat), key, manager: m, cat, entry: e });
  return out;
}

const pickName = e => e.name || teamName(e.abbrev);

function menu(league, picks, choice) {
  const groups = league.managers.map(m => `
    <optgroup label="${esc(m)}${m === me() ? " (you)" : ""}">${picks.filter(p => p.manager === m).map(p =>
      `<option value="${esc(p.id)}" ${choice === p.id ? "selected" : ""}>${esc(pickName(p.entry))} · ${CAT_NAMES[p.cat]}</option>`).join("")}
    </optgroup>`).join("");
  return `
    <label class="sel"><span class="sel-label">Pick</span>
      <span class="sel-box"><select id="pick-select">${groups}</select>
        <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span></label>`;
}

const missedText = a => `${a.status ? `${irText(a)}. ` : ""}${a.missed ? `${a.lastPlayed ? `Hasn't played since ${gameDay(a.lastPlayed)}` : "Hasn't played this season"}:
  ${esc(a.team)} has played ${a.missed} game${a.missed === 1 ? "" : "s"} without him.${a.status ? "" : ` Injury, healthy scratch or suspension${a.kind === "goalie" ? ", or the backup's starts" : ""}.`}` : ""}`;

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

// Picks that can be drawn on top of `main`: the same stat (so one y axis fits
// them all), not the same player or team (that line would be identical), and
// one per player per manager (a player in both P and FIN is still one line).
function compareCandidates(picks, main) {
  const stat = catStat(main.cat).key, seen = new Set([main.key]);
  return picks.filter(p => {
    if (catStat(p.cat).key !== stat) return false;
    const k = `${p.key}|${p.manager}`;
    if (seen.has(p.key) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Lines of one manager share the manager's color; the 2nd, 3rd… get dashes
const DASHES = [null, "7 4", "2 4", "10 4 2 4"];

// The running season total of `statKey`, one value per game played
function runningTotal(entry, statKey) {
  let run = 0;
  return entry.games.map(g => (run += g[statKey] || 0));
}

function render(league, logs, picks, choice, compare) {
  const main = picks.find(p => p.id === choice);
  const { entry, manager } = main;
  document.getElementById("pick-controls").innerHTML = menu(league, picks, choice);
  const color = managerColor(league, manager);
  const catLabel = id => CATEGORIES.find(c => c.key === id)?.label;
  // Other categories where this manager picked the same player (each has its own menu item)
  const sameManagerCats = entry.picks.filter(p => p.manager === manager && p.cat !== main.cat).map(p => catLabel(p.cat));
  const others = [...new Set(entry.picks.filter(p => p.manager !== manager).map(p => p.manager))];
  document.getElementById("pick-head").innerHTML = `
    <h3><span class="swatch" style="background:${color}"></span>${esc(pickName(entry))}
      ${entry.team ? `<small>${esc(entry.team)}</small>` : ""}${entry.id ? outBadge(entry.id) : ""}</h3>
    <p class="muted">${esc(manager)}'s pick · ${esc(catLabel(main.cat))}${sameManagerCats.length ? ` · also ${esc(manager)}'s pick in ${sameManagerCats.map(esc).join(", ")}` : ""}${others.length ? ` · also picked by ${others.map(esc).join(", ")}` : ""}</p>
    <p class="sum">${summary(entry)}</p>
    ${entry.id && missedGames(entry.id) ? `<p class="hint">${missedText(missedGames(entry.id))}</p>` : ""}`;

  // The lines on the chart: the chosen pick first, then the comparisons that
  // still fit it (switching from points to goals drops the points comparisons)
  const stat = catStat(main.cat);
  const candidates = compareCandidates(picks, main);
  const shown = compare.map(id => candidates.find(p => p.id === id)).filter(Boolean);
  const perManager = {};  // how many lines each manager already has, for the dash pattern
  const lines = [main, ...shown].map((p, i) => {
    const n = perManager[p.manager] = (perManager[p.manager] || 0) + 1;
    return { p, main: i === 0, color: managerColor(league, p.manager), dash: DASHES[(n - 1) % DASHES.length] };
  });

  const el = document.getElementById("pick-chart");
  const longest = Math.max(...lines.map(l => l.p.entry.games.length));
  if (!shown.length && entry.games.length > 1) {
    // Just this pick: the x axis is the calendar, as before
    drawChart(el, entry.games.map(g => fmtDay(g.date, { day: "numeric", month: "numeric" })), [{
      name: pickName(entry), color, values: runningTotal(entry, stat.key),
      extra: entry.games.map(g => `${vsAt(g)}${entry.kind === "team" ? ` ${g.result}` : ""}`),
    }], {
      compact: true, aria: `${pickName(entry)}: ${stat.label} through the season`,
      zeroLine: stat.key === "gsax", integer: stat.key !== "gsax", fmt: stat.fmt,
      tipTitle: i => `${gameDay(entry.games[i].date)} · game ${i + 1}`,
    });
  } else if (shown.length && longest > 1) {
    // Several picks: the x axis is the game number (each pick's 1st game, 2nd
    // game, …), as players have played on different days. Shorter seasons
    // are padded with empty values so the line just stops.
    const pad = (arr, fill) => [...arr, ...Array(longest - arr.length).fill(fill)];
    drawChart(el, Array.from({ length: longest }, (_, i) => String(i + 1)), lines.map(l => ({
      name: `${pickName(l.p.entry)} (${l.p.manager})`, color: l.color, dash: l.dash,
      width: l.main ? 3.5 : 2, dot: l.main ? 4 : 2.5,
      values: pad(runningTotal(l.p.entry, stat.key), null),
      extra: pad(l.p.entry.games.map(g => `${fmtDay(g.date, { day: "numeric", month: "numeric" })} ${vsAt(g)}`), ""),
    })), {
      compact: true, aria: `${stat.label} through the season, game by game: ${lines.map(l => pickName(l.p.entry)).join(", ")}`,
      zeroLine: stat.key === "gsax", integer: stat.key !== "gsax", fmt: stat.fmt,
      tipTitle: i => `Game ${i + 1}`,
    });
  } else {
    el.innerHTML = "";
  }
  document.getElementById("chart-note").textContent = longest <= 1 ? ""
    : shown.length ? `Season total of ${stat.label} by game number, not by date: games a player missed don't show as falling behind.`
    : `Season total of ${stat.label}, game by game.`;

  renderCompare(lines, candidates, compare);
  document.getElementById("log").innerHTML = entry.games.length
    ? `<div class="scroll"><table class="log">${table(entry)}</table></div>`
    : `<p class="muted">No games yet.</p>`;
}

// Under the chart: a chip per line (with × to remove the comparisons) and a
// menu of the picks that can still be added
function renderCompare(lines, candidates, compare) {
  const el = document.getElementById("pick-compare");
  const addable = candidates.filter(p => !compare.includes(p.id));
  // A short line sample in the chip, dashed like the line on the chart
  const sample = l => `<svg class="line-key" width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5"
    stroke="${l.color}" stroke-width="${l.main ? 3.5 : 2.5}" stroke-linecap="round" ${l.dash ? `stroke-dasharray="${l.dash}"` : ""}/></svg>`;
  const chips = lines.length > 1 ? lines.map(l => `
    <span class="chip">${sample(l)}${esc(pickName(l.p.entry))} <small>${esc(l.p.manager)} · ${CAT_NAMES[l.p.cat]}</small>
      ${l.main ? "" : `<button type="button" data-remove="${esc(l.p.id)}" aria-label="Remove ${esc(pickName(l.p.entry))} from the chart">×</button>`}</span>`).join("") : "";
  // Menu options grouped by category, e.g. "Most points", "Most points, rookie"
  const groups = CATEGORIES.map(c => [c, addable.filter(p => p.cat === c.key)]).filter(([, ps]) => ps.length)
    .map(([c, ps]) => `<optgroup label="${esc(c.label)}">${ps.map(p =>
      `<option value="${esc(p.id)}">${esc(pickName(p.entry))} · ${esc(p.manager)}</option>`).join("")}</optgroup>`).join("");
  el.innerHTML = `
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    ${addable.length ? `<div class="controls compare-add">
      <label class="sel"><span class="sel-label">Compare on the chart</span>
        <span class="sel-box"><select id="compare-select"><option value="">+ Add a pick…</option>${groups}</select>
          <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span></label>
      ${lines.length > 1 ? `<button type="button" class="clear" data-clear>Clear</button>` : ""}
    </div>` : ""}`;
}

async function main() {
  try {
    const [league, data, stats] = await Promise.all([loadLeague(), loadJSON("data/gamelogs.json"), loadJSON("data/stats.json")]);
    TEAM_NAMES = Object.fromEntries(stats.teams.map(t => [t.abbrev, t.name]));
    const logs = data.logs;
    const picks = allPicks(league, logs);
    document.getElementById("meta").textContent =
      `${seasonLabel(stats.season)} regular season · game logs updated ${new Date(data.updated).toLocaleString()}`;
    const valid = id => picks.some(p => p.id === id);
    // An older saved choice was "entryKey|manager" (no category): take that
    // manager's first category for the player
    const upgrade = id => {
      const { key, manager, cat } = parsePick(id);
      return cat ? id : picks.find(p => p.key === key && p.manager === manager)?.id;
    };
    const firstOf = m => picks.find(p => p.manager === m)?.id;
    let choice = [upgrade(readStore(PICKS_KEY, null)), firstOf(me()), firstOf(league.managers[0])].find(valid);
    // The comparisons are kept even when they don't fit the current pick, so
    // they come back when you switch back to a pick they fit
    let compare = (readStore(COMPARE_KEY, []) || []).filter(valid);
    const update = () => render(league, logs, picks, choice, compare);
    const saveCompare = () => writeStore(COMPARE_KEY, compare);
    update();

    document.getElementById("pick-controls").addEventListener("change", e => {
      if (e.target.id !== "pick-select") return;
      choice = e.target.value;
      writeStore(PICKS_KEY, choice);
      update();
    });
    const box = document.getElementById("pick-compare");
    box.addEventListener("change", e => {
      if (e.target.id !== "compare-select" || !e.target.value) return;
      compare = [...compare.filter(id => id !== e.target.value), e.target.value];
      saveCompare();
      update();
    });
    box.addEventListener("click", e => {
      const remove = e.target.closest("[data-remove]"), clear = e.target.closest("[data-clear]");
      if (!remove && !clear) return;
      // "Clear" removes only the lines on this chart, not comparisons saved for other stats
      const onChart = new Set(compareCandidates(picks, picks.find(p => p.id === choice)).map(p => p.id));
      compare = remove ? compare.filter(id => id !== remove.dataset.remove) : compare.filter(id => !onChart.has(id));
      saveCompare();
      update();
    });

    let lastWidth = innerWidth;
    addEventListener("resize", () => {
      if (innerWidth !== lastWidth) { lastWidth = innerWidth; update(); }
    });
    spoilerGate(league, [document.getElementById("content")]);
  } catch (err) {
    showError(err);
  }
}

main();
