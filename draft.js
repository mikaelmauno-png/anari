// Next-season picker: each manager clicks their picks for the 8 categories and
// 8 + 8 playoff teams, then shares a summary that gets entered into league.json.
// Choices are remembered on this device only.

const STORE_KEY = "anari-draft";
const TEAM_ORDER = ["E", "W"];
let state = { manager: null, picks: {} };   // picks[manager][key] = string, picks[manager].playoffs = [abbrev]
let ctx = null;                             // { league, stats, nextSeason }

const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; } };
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ } };
const mine = () => (state.picks[state.manager] ||= { playoffs: [] });

// Which players each category can choose from (a hint list; typing any name works)
function poolFor(cat, stats) {
  if (cat.kind === "goalie") return stats.goalies.map(g => ({ label: `${g.name} (${g.team})`, line: `${g.gsax > 0 ? "+" : ""}${g.gsax.toFixed(1)} GSAx` }));
  let skaters = stats.skaters;
  if (cat.key === "finnish") skaters = skaters.filter(s => s.nat === "FIN");
  const line = s => cat.key === "goals" ? `${s.g} G` : cat.key === "pim" ? `${s.pim} PIM` : `${s.p} P`;
  return skaters.slice().sort((a, b) => b.p - a.p).map(s => ({ label: `${s.name} (${s.team})`, line: `${line(s)} this season` }));
}

function render() {
  const { league, stats, nextSeason } = ctx;
  document.getElementById("meta").textContent = `Picks for the ${seasonLabel(nextSeason)} season`;
  document.getElementById("managers").innerHTML = league.managers.map(m =>
    `<button type="button" class="mgr-btn" aria-pressed="${m === state.manager}" data-m="${esc(m)}">
      <span class="swatch" style="background:${managerColor(league, m)}"></span>${esc(m)}</button>`).join("");

  const form = document.getElementById("form");
  if (!state.manager) { form.innerHTML = `<p class="muted">Choose who you are to start picking.</p>`; renderSummary(); return; }
  const p = mine();
  const playerCats = CATEGORIES.filter(c => c.kind !== "team");
  form.innerHTML = `
    <section class="card">
      <h3>Players</h3>
      ${playerCats.map(c => `
        <label class="field">
          <span class="lbl">${esc(c.label)}${c.key === "rookies" ? ` <small>next season's rookie, type any name</small>` : ""}${c.key === "value" ? ` <small>no entry-level contracts</small>` : ""}</span>
          <input type="text" list="list-${c.key}" data-key="${c.key}" value="${esc(p[c.key] || "")}" placeholder="Search players" autocomplete="off">
          <small class="hint-line" id="hint-${c.key}"></small>
        </label>
        <datalist id="list-${c.key}">${(c.key === "rookies" ? [] : poolFor(c, stats)).map(o => `<option value="${esc(o.label)}">${esc(o.line)}</option>`).join("")}</datalist>`).join("")}
    </section>
    <section class="card">
      <h3>Presidents' Trophy</h3>
      <div class="teams-pick" data-group="presidents">${teamButtons(stats.teams, t => p.presidents === t.abbrev)}</div>
    </section>
    <section class="card">
      <h3>Playoff teams <small class="muted" id="po-count"></small></h3>
      ${TEAM_ORDER.map(conf => `
        <h4>${conf === "E" ? "East" : "West"}</h4>
        <div class="teams-pick" data-group="playoffs">${teamButtons(stats.teams.filter(t => t.conf === conf), t => p.playoffs.includes(t.abbrev))}</div>`).join("")}
    </section>`;
  for (const c of playerCats) updateHint(c.key);
  updatePlayoffCount();
  renderSummary();
}

function teamButtons(teams, selected) {
  return teams.slice().sort((a, b) => a.name.localeCompare(b.name)).map(t =>
    `<button type="button" class="team-btn" aria-pressed="${selected(t)}" data-team="${t.abbrev}" title="${esc(t.name)}">${t.abbrev}</button>`).join("");
}

function updateHint(key) {
  const cat = CATEGORIES.find(c => c.key === key);
  const val = mine()[key] || "";
  const el = document.getElementById(`hint-${key}`);
  if (!el) return;
  if (!val) { el.textContent = ""; return; }
  const pool = cat.kind === "goalie" ? ctx.stats.goalies : ctx.stats.skaters;
  const { item } = resolve(val, pool, cat.kind, cat.check);
  const bad = item && cat.check && cat.check(item);
  el.className = "hint-line" + (bad ? " warn" : "");
  el.textContent = !item ? "Not an NHL player this season, that's fine for prospects"
    : bad ? `⚠ ${bad}`
    : cat.kind === "goalie" ? `${item.team} · ${item.gsax.toFixed(1)} GSAx this season`
    : `${item.team} · ${item.g} G, ${item.p} P, ${item.pim} PIM this season${item.cap ? ` · ${item.cap} M cap hit` : ""}`;
}

function updatePlayoffCount() {
  const p = mine();
  const n = conf => p.playoffs.filter(a => ctx.stats.teams.find(t => t.abbrev === a)?.conf === conf).length;
  const el = document.getElementById("po-count");
  if (el) el.textContent = `· East ${n("E")}/8 · West ${n("W")}/8`;
}

// The text that gets sent: one line per category, easy to read and to enter.
function summaryText() {
  const p = mine();
  const lines = [`${ctx.league.name} ${seasonLabel(ctx.nextSeason)} picks: ${state.manager}`];
  for (const c of CATEGORIES) {
    if (c.kind === "team") lines.push(`${c.label}: ${p.presidents || "–"}`);
    else lines.push(`${c.label}: ${p[c.key] || "–"}`);
  }
  for (const conf of TEAM_ORDER) {
    const teams = p.playoffs.filter(a => ctx.stats.teams.find(t => t.abbrev === a)?.conf === conf).sort();
    lines.push(`Playoffs ${conf === "E" ? "East" : "West"}: ${teams.join(", ") || "–"}`);
  }
  return lines.join("\n");
}

function missing() {
  const p = mine();
  const out = CATEGORIES.filter(c => c.kind === "team" ? !p.presidents : !p[c.key]).map(c => c.label);
  for (const conf of TEAM_ORDER) {
    const n = p.playoffs.filter(a => ctx.stats.teams.find(t => t.abbrev === a)?.conf === conf).length;
    if (n !== 8) out.push(`${conf === "E" ? "East" : "West"} playoff teams (${n}/8)`);
  }
  return out;
}

function renderSummary() {
  const el = document.getElementById("summary");
  if (!state.manager) { el.innerHTML = ""; return; }
  const todo = missing();
  el.innerHTML = `
    <section class="card">
      <h3>Send your picks</h3>
      <pre class="summary">${esc(summaryText())}</pre>
      ${todo.length ? `<p class="warn">Still missing: ${todo.map(esc).join(", ")}</p>` : `<p class="up">All picks done ✓</p>`}
      <div class="actions">
        ${navigator.share ? `<button type="button" id="share">Share</button>` : ""}
        <button type="button" id="copy">Copy</button>
        <span class="muted" id="copied"></span>
      </div>
      <p class="hint">Send this to Mikael; the picks go into league.json when the new season starts. Your choices are saved on this device.</p>
    </section>`;
}

function onClick(e) {
  const m = e.target.closest(".mgr-btn");
  if (m) { state.manager = m.dataset.m; save(); render(); return; }
  const t = e.target.closest(".team-btn");
  if (t) {
    const p = mine(), group = t.parentElement.dataset.group, a = t.dataset.team;
    if (group === "presidents") p.presidents = p.presidents === a ? null : a;
    else p.playoffs = p.playoffs.includes(a) ? p.playoffs.filter(x => x !== a) : [...p.playoffs, a];
    save(); render(); return;
  }
  if (e.target.id === "copy") {
    const done = ok => { document.getElementById("copied").textContent = ok ? "Copied" : "Select the text above and copy it"; };
    navigator.clipboard?.writeText(summaryText()).then(() => done(true), () => done(false)) ?? done(false);
  }
  if (e.target.id === "share") navigator.share({ text: summaryText() }).catch(() => {});
}

function onInput(e) {
  const key = e.target.dataset.key;
  if (!key) return;
  mine()[key] = e.target.value.trim();
  save();
  updateHint(key);
  renderSummary();
}

async function main() {
  try {
    const [league, stats] = await Promise.all([loadLeague(), loadJSON("data/stats.json")]);
    applyCapHits(league, stats);
    const start = Math.floor(league.season / 10000) + 1;
    ctx = { league, stats, nextSeason: start * 10000 + start + 1 };
    const saved = load();
    if (saved && saved.picks) state = saved;
    if (state.manager && !league.managers.includes(state.manager)) state.manager = null;
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    render();
  } catch (err) {
    showError(err);
  }
}

main();
