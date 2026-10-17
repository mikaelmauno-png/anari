// Next-season draft picker. Each manager ranks the categories where they'd most
// like the 1st pick, gives 4 ranked choices per category, and picks 8 + 8
// playoff teams, then shares a summary that gets entered into league.json
// (league.draft). Once submissions are in, the page runs the draft: in each
// category's pick order everyone gets their highest choice still available.
// Choices in progress are remembered on this device only.

const STORE_KEY = "anari-draft-v2";
const CONFS = ["E", "W"];
const ORDINAL = ["1st", "2nd", "3rd", "4th"];
let state = { manager: null, picks: {} };
let ctx = null; // { league, stats, nextSeason, reverse }

const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; } };
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ } };
const mine = () => (state.picks[state.manager] ||= { firstPicks: [], choices: {}, playoffs: [] });
const confOf = a => ctx.stats.teams.find(t => t.abbrev === a)?.conf;

function options(cat) {
  const { stats } = ctx;
  if (cat.kind === "team") return stats.teams.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(t => ({ value: t.abbrev, label: `${t.name} · ${t.pts} pts` }));
  if (cat.kind === "goalie") return stats.goalies.slice().sort((a, b) => b.gsax - a.gsax)
    .map(g => ({ value: `${g.name} (${g.team})`, label: `${g.gsax > 0 ? "+" : ""}${g.gsax.toFixed(1)} GSAx` }));
  if (cat.key === "rookies") return [];
  let skaters = stats.skaters;
  if (cat.key === "finnish") skaters = skaters.filter(s => s.nat === "FIN");
  const line = s => cat.key === "goals" ? `${s.g} G` : cat.key === "pim" ? `${s.pim} PIM` : `${s.p} P`;
  return skaters.slice().sort((a, b) => b.p - a.p).map(s => ({ value: `${s.name} (${s.team})`, label: `${line(s)} this season` }));
}

function render() {
  const { league, nextSeason, reverse } = ctx;
  document.getElementById("meta").textContent = `Draft for the ${seasonLabel(nextSeason)} season`;
  document.getElementById("order").innerHTML = `
    <p>Draft order is last season's final standings reversed:
      ${reverse.map((m, i) => `<b>${i + 1}.</b> <span class="swatch" style="background:${managerColor(league, m)}"></span>${esc(m)}`).join(" ")}</p>
    <p class="hint">Over two rounds in that order, each manager claims the 1st pick in their highest-ranked category still free.
      In each category the order then continues around this list, so everyone picks 1st, 2nd, 3rd and 4th twice.
      In each category's order, everyone gets their highest choice that nobody ahead of them took.</p>`;
  document.getElementById("managers").innerHTML = league.managers.map(m =>
    `<button type="button" class="mgr-btn" aria-pressed="${m === state.manager}" data-m="${esc(m)}">
      <span class="swatch" style="background:${managerColor(league, m)}"></span>${esc(m)}</button>`).join("");

  const form = document.getElementById("form");
  if (!state.manager) { form.innerHTML = `<p class="muted">Choose who you are to start.</p>`; renderSummary(); return; }
  const p = mine();
  form.innerHTML = `
    <section class="card">
      <h3>1. Where do you want the 1st pick?</h3>
      <p class="hint">Tap categories in order of preference; tap again to remove. You'll get the 1st pick in 2 of them.</p>
      <div class="cat-pick">${CATEGORIES.map(c => {
        const n = p.firstPicks.indexOf(c.key);
        return `<button type="button" class="cat-btn" data-cat="${c.key}" aria-pressed="${n >= 0}">
          ${n >= 0 ? `<b class="rankno">${n + 1}</b>` : ""}${esc(c.label)}</button>`;
      }).join("")}</div>
    </section>
    <section class="card">
      <h3>2. Your 4 choices per category</h3>
      <p class="hint">Best first. If someone ahead of you takes your 1st choice, you get your 2nd, and so on.</p>
      ${CATEGORIES.map(c => `
        <fieldset class="cat">
          <legend>${esc(c.label)}${c.key === "rookies" ? ` <small>next season's rookies, type any name</small>` : ""}${c.key === "value" ? ` <small>no entry-level contracts</small>` : ""}</legend>
          ${ORDINAL.map((o, i) => `
            <label class="choice"><span class="ord">${o}</span>
              <input type="text" list="list-${c.key}" data-key="${c.key}" data-i="${i}" value="${esc((p.choices[c.key] || [])[i] || "")}"
                placeholder="${c.kind === "team" ? "Team, e.g. COL" : "Search players"}" autocomplete="off">
            </label>
            <small class="hint-line" id="hint-${c.key}-${i}"></small>`).join("")}
        </fieldset>
        <datalist id="list-${c.key}">${options(c).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</datalist>`).join("")}
    </section>
    <section class="card">
      <h3>3. Playoff teams <small class="muted" id="po-count"></small></h3>
      <p class="hint">Not drafted: pick any 8 East and 8 West teams.</p>
      ${CONFS.map(conf => `
        <h4>${conf === "E" ? "East" : "West"}</h4>
        <div class="teams-pick">${ctx.stats.teams.filter(t => t.conf === conf).sort((a, b) => a.name.localeCompare(b.name)).map(t =>
          `<button type="button" class="team-btn" aria-pressed="${p.playoffs.includes(t.abbrev)}" data-team="${t.abbrev}" title="${esc(t.name)}">${t.abbrev}</button>`).join("")}</div>`).join("")}
    </section>`;
  for (const c of CATEGORIES) for (let i = 0; i < 4; i++) updateHint(c.key, i);
  updatePlayoffCount();
  renderSummary();
}

function updateHint(key, i) {
  const el = document.getElementById(`hint-${key}-${i}`);
  if (!el) return;
  const cat = CATEGORIES.find(c => c.key === key);
  const list = mine().choices[key] || [];
  const val = (list[i] || "").trim();
  if (!val) { el.textContent = ""; el.className = "hint-line"; return; }
  const pool = { skater: ctx.stats.skaters, goalie: ctx.stats.goalies, team: ctx.stats.teams }[cat.kind];
  const { item } = resolve(val, pool, cat.kind, cat.check);
  const dupe = list.slice(0, i).some(v => v && v.trim() && (resolve(v, pool, cat.kind, cat.check).item || v) === (item || val));
  const bad = item && cat.check && cat.check(item);
  el.className = "hint-line" + (dupe || bad ? " warn" : "");
  el.textContent = dupe ? "⚠ already one of your choices"
    : !item ? (cat.kind === "team" ? "⚠ unknown team" : "Not an NHL player this season, fine for prospects")
    : bad ? `⚠ ${bad}`
    : cat.kind === "team" ? `${item.name}`
    : cat.kind === "goalie" ? `${item.team} · ${item.gsax.toFixed(1)} GSAx this season`
    : `${item.team} · ${item.g} G, ${item.p} P, ${item.pim} PIM${item.cap ? ` · ${item.cap} M` : ""}`;
}

function updatePlayoffCount() {
  const p = mine();
  const el = document.getElementById("po-count");
  if (el) el.textContent = `· East ${p.playoffs.filter(a => confOf(a) === "E").length}/8 · West ${p.playoffs.filter(a => confOf(a) === "W").length}/8`;
}

function summaryText() {
  const p = mine();
  const lines = [`${ctx.league.name} ${seasonLabel(ctx.nextSeason)} draft: ${state.manager}`];
  lines.push(`1st-pick wishes: ${p.firstPicks.map(k => SHORT[k]).join(", ") || "–"}`);
  for (const c of CATEGORIES) {
    const list = (p.choices[c.key] || []).map((v, i) => v && v.trim() ? `${i + 1}. ${v.trim()}` : "").filter(Boolean);
    lines.push(`${c.label}: ${list.join(" · ") || "–"}`);
  }
  for (const conf of CONFS) {
    lines.push(`Playoffs ${conf === "E" ? "East" : "West"}: ${p.playoffs.filter(a => confOf(a) === conf).sort().join(", ") || "–"}`);
  }
  return lines.join("\n");
}

function missing() {
  const p = mine();
  const out = [];
  if (p.firstPicks.length < CATEGORIES.length) out.push(`1st-pick ranking (${p.firstPicks.length}/${CATEGORIES.length})`);
  for (const c of CATEGORIES) {
    const n = (p.choices[c.key] || []).filter(v => v && v.trim()).length;
    if (n < 4) out.push(`${c.label} (${n}/4)`);
  }
  for (const conf of CONFS) {
    const n = p.playoffs.filter(a => confOf(a) === conf).length;
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
      ${todo.length ? `<p class="warn">Still missing: ${todo.map(esc).join(", ")}</p>` : `<p class="up">All done ✓</p>`}
      <div class="actions">
        ${navigator.share ? `<button type="button" id="share">Share</button>` : ""}
        <button type="button" id="copy">Copy</button>
        <span class="muted" id="copied"></span>
      </div>
      <p class="hint">Send this to Mikael. Once everyone's picks are entered, the draft results appear below. Your choices are saved on this device.</p>
    </section>`;
}

// Draft results from the submissions entered in league.json
function renderResults() {
  const { league } = ctx;
  const draft = league.draft || {};
  const el = document.getElementById("results");
  const inn = league.managers.filter(m => draft[m]);
  if (!inn.length) { el.innerHTML = `<p class="muted">No submissions entered yet.</p>`; return; }
  const { orders, results } = runDraft(league, ctx.stats);
  const waiting = league.managers.filter(m => !draft[m]);
  el.innerHTML = `
    ${waiting.length ? `<p class="hint">Waiting for: ${waiting.map(esc).join(", ")}. Results below can still change.</p>` : ""}
    <div class="grid">${results.map(({ cat, picks }) => `
      <section class="card">
        <h3>${esc(cat.label)}</h3>
        <ol class="rank">${picks.map(r => `
          <li>
            <span class="pl">${r.slot}</span>
            <span class="who"><b><span class="swatch" style="background:${managerColor(league, r.manager)}"></span>${esc(r.manager)}</b>
              <span class="pick">${r.waiting ? "waiting" : r.pick ? esc(r.pick) : "⚠ all 4 choices taken"}</span></span>
            <span class="val muted">${r.choiceNo ? `${ORDINAL[r.choiceNo - 1]} choice` : ""}</span>
            <span></span>
          </li>`).join("")}</ol>
      </section>`).join("")}</div>`;
}

function onClick(e) {
  const m = e.target.closest(".mgr-btn");
  if (m) { state.manager = m.dataset.m; save(); render(); return; }
  const c = e.target.closest(".cat-btn");
  if (c) {
    const p = mine(), k = c.dataset.cat;
    p.firstPicks = p.firstPicks.includes(k) ? p.firstPicks.filter(x => x !== k) : [...p.firstPicks, k];
    save(); render(); return;
  }
  const t = e.target.closest(".team-btn");
  if (t) {
    const p = mine(), a = t.dataset.team;
    p.playoffs = p.playoffs.includes(a) ? p.playoffs.filter(x => x !== a) : [...p.playoffs, a];
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
  const p = mine();
  const list = (p.choices[key] ||= ["", "", "", ""]);
  list[Number(e.target.dataset.i)] = e.target.value;
  save();
  for (let i = 0; i < 4; i++) updateHint(key, i);
  renderSummary();
}

async function main() {
  try {
    const [league, stats] = await Promise.all([loadLeague(), loadJSON("data/stats.json")]);
    const start = Math.floor(league.season / 10000) + 1;
    ctx = { league, stats, nextSeason: start * 10000 + start + 1, reverse: draftOrder(league, stats) };
    const saved = load();
    if (saved && saved.picks) state = saved;
    if (state.manager && !league.managers.includes(state.manager)) state.manager = null;
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    render();
    renderResults();
  } catch (err) {
    showError(err);
  }
}

main();
