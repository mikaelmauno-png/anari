// Standings page.

function render(league, stats) {
  const { results, table } = computeStandings(league, stats);
  document.title = `${league.name} standings`;
  document.getElementById("league-name").textContent = league.name;
  const updated = new Date(stats.updated);
  const season = String(stats.season);
  const over = seasonOver(stats);
  showDraftLinks(stats);
  document.getElementById("meta").textContent = over
    ? `${seasonLabel(stats.season)} regular season · final standings`
    : `${seasonLabel(stats.season)} regular season · stats updated ${updated.toLocaleString()}`;

  // At the end of the season the playoff picks count: 2 points per team that made it
  let rows = table;
  if (over) {
    rows = finalStandings(league, stats).rows;
    renderBanner(league, stats, rows);
  }
  const head = CATEGORIES.map(c => `<th title="${esc(c.label)}">${SHORT[c.key]}</th>`).join("");
  document.getElementById("standings").innerHTML = `
    <div class="scroll"><table class="standings fixed${over ? " tight" : ""}">
      <thead><tr><th>#</th><th class="mgr">Manager</th><th class="tot">Total</th>${over ? `<th class="po" title="Playoff picks, 2 per team that made it">PO</th>` : ""}${head}</tr></thead>
      <tbody>${rows.map(r => `
        <tr class="${meClass(r.manager)}${r.place === 1 ? " lead" : ""}"${mcStyle(league, r.manager)}>
          <td class="place">${r.place}</td>
          <th scope="row" class="mgr">${esc(r.manager)}</th>
          <td class="total">${r.total}</td>
          ${over ? `<td class="po">${r.po}</td>` : ""}
          ${CATEGORIES.map(c => `<td class="${r.byCat[c.key] ? "" : "zero"}">${r.byCat[c.key]}</td>`).join("")}
        </tr>`).join("")}</tbody>
    </table></div>
    <p class="hint">${CATEGORIES.map(c => `<b>${SHORT[c.key]}</b> ${esc(c.label.replace(/^Most /, ""))}`).join(" · ")}</p>`;

  document.getElementById("categories").innerHTML = results.map(({ cat, entries, best, candidates, capWarnings }) => `
    <section class="card">
      <h3>${esc(cat.label)}${cat.source ? ` <span class="src">${cat.source}</span>` : ""}</h3>
      <ol class="rank">
        ${entries.map(e => `
          <li class="${e.points ? "scored" : ""}${meClass(e.manager)}"${mcStyle(league, e.manager)}>
            <span class="pl">${e.tied ? "T" : ""}${e.place}</span>
            <span class="who"><b>${esc(e.manager)}</b><span class="pick">${pickLabel(cat, e)}</span>
              ${e.gap ? `<span class="gap">${e.gap}</span>` : ""}
              ${e.warnings.map(w => `<span class="warn">⚠ ${esc(w)}</span>`).join("")}</span>
            <span class="val">${fmtValue(cat, e)}</span>
            <span class="pts">${e.points ? "+" + e.points : "0"}</span>
          </li>`).join("")}
      </ol>
      ${renderBest(cat, best, candidates && candidates.total)}
      ${candidates ? renderCandidates(league, candidates, capWarnings, stats) : ""}
    </section>`).join("");

  if (over) document.querySelectorAll(".projection").forEach(el => { el.hidden = true; });
  else renderProjection(league, stats);
}

// The best possible pick overall, and under it a dropdown with each manager's
// best pick in pick order. With €/point cap hits still missing they're "known".
function renderBest(cat, best, unsure) {
  const title = `Best ${unsure ? "known" : "possible"} pick`;
  if (!best.some(b => b.item)) return `<p class="best">${title}: no data</p>`;
  const top = `${title}: <b>${pickLabel(cat, best[0])}</b> <span>${fmtValue(cat, best[0])}</span>`;
  if (!best[0].manager) return `<p class="best">${top}</p>`;
  return `
      <div class="best">${top}
        <details><summary>Each manager in pick order</summary>
          <ol>${best.map(b => `
            <li class="${meClass(b.manager)}"><span class="bslot">${b.slot}</span><b class="bmgr">${esc(b.manager)}</b>
              <span class="pick">${b.item ? pickLabel(cat, b) : "–"}</span><span class="bval">${fmtValue(cat, b)}</span></li>`).join("")}</ol>
        </details>
      </div>`;
}

// The first time a device sees the final standings of a season, confetti.
const CELEBRATED_KEY = "anari-celebrated"; // seasons this device has celebrated
function renderBanner(league, stats, rows) {
  const el = document.getElementById("banner");
  el.innerHTML = bannerHTML(league, stats.season, rows, finalPreview() ? " · preview, the season isn't over yet" : "");
  const trophy = el.querySelector(".trophy");
  trophy.addEventListener("click", () => celebrate(trophy));
  // The preview celebrates on every load without using up the real one
  if (!finalPreview()) {
    const seen = readStore(CELEBRATED_KEY, []);
    if (seen.includes(stats.season)) return;
    writeStore(CELEBRATED_KEY, [...seen, stats.season]);
  }
  setTimeout(() => celebrate(trophy), 400);
}

// Final standings if everyone keeps their current pace, playoff picks included.
function renderProjection(league, stats) {
  const proj = projectStats(stats);
  const { table } = computeStandings(league, proj);
  const po = playoffPoints(league, proj.teams);
  const rows = rankFinal(league, table.map(r => {
    const p = po[r.manager] || 0;
    return { ...r, po: p, total: r.total + p, final: r.total + p };
  }));
  const place = r => r.place;
  const head = CATEGORIES.map(c => `<th title="${esc(c.label)}">${SHORT[c.key]}</th>`).join("");
  document.getElementById("projection").innerHTML = `
    <div class="scroll"><table class="standings fixed tight">
      <thead><tr><th>#</th><th class="mgr">Manager</th><th class="tot">Total</th><th class="po" title="Playoff picks, 2 per team in">PO</th>${head}</tr></thead>
      <tbody>${rows.map(r => `
        <tr class="${meClass(r.manager)}"${mcStyle(league, r.manager)}>
          <td class="place">${place(r)}</td>
          <th scope="row" class="mgr">${esc(r.manager)}</th>
          <td class="total">${r.final}</td>
          <td class="po">${r.po}</td>
          ${CATEGORIES.map(c => `<td class="${r.byCat[c.key] ? "" : "zero"}">${r.byCat[c.key]}</td>`).join("")}
        </tr>`).join("")}</tbody>
    </table></div>
    <p class="hint">Every pick's stats at their current pace over ${SEASON_GAMES} games (team games played so far:
      ${Math.min(...stats.teams.map(t => t.gp))}–${Math.max(...stats.teams.map(t => t.gp))}).
      <b>PO</b> = playoff picks, 2 points per team in a playoff spot by projected points. Early in the season this moves a lot.</p>`;
}

function renderLookups(league, stats) {
  const caps = league.lookedUpCaps;
  if (!caps || !Object.keys(caps.players || {}).length) return "";
  const entries = Object.values(caps.players);
  const pasted = entries.filter(e => (e.via || "").startsWith("PuckPedia")).length;
  const inferred = entries.filter(e => e.via && !e.via.startsWith("PuckPedia")).length;
  const assumed = stats.skaters.filter(s => s.elcAssumed);
  return `<p class="hint">${entries.length - pasted - inferred} cap hits looked up on <a href="https://capfreeze.com/players.html">CapFreeze</a>
      (about 10 more each day, highest scorers first; last ${fmtDay(caps.checked, { day: "numeric", month: "short" })})${pasted
        ? `, ${pasted} from <a href="https://puckpedia.com">PuckPedia</a> lists` : ""}${inferred
        ? `, and ${inferred} scorers counted as entry-level because PuckPedia's complete non-ELC list doesn't have them` : ""}.</p>
    ${assumed.length ? `<p class="hint">Assumed entry-level contracts, so not eligible:
      ${assumed.map(s => `${esc(s.name)} <small>${esc(s.team)}, ${s.capIfNotElc} M</small>`).join(", ")}.
      If one isn't, add his cap hit to <code>capHits</code> in league.json.</p>` : ""}`;
}

function renderCandidates(league, { list, total }, capWarnings, stats) {
  const warn = capWarnings.map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join("") + renderLookups(league, stats);
  if (!total) return `${warn}<p class="hint">All players who could beat it have a cap hit entered ✓</p>`;
  return `${warn}
    <details class="cands">
      <summary>${total} player${total === 1 ? "" : "s"} could still be better: cap hit not known yet</summary>
      <p class="hint">These are looked up automatically, about 10 a day from the top of this list.
        A player only beats the best known pick if his cap hit is under the limit shown.
        To fill one in sooner, add it to <code>capHits</code> in league.json in millions,
        e.g. <code>"Matt Boldy (MIN)": 7.0</code>, or <code>"ELC"</code> for an entry-level contract.</p>
      <ol class="rank">
        ${list.map(c => `
          <li>
            <span class="pl">${c.item.p}</span>
            <span class="who"><b>${esc(c.item.name)} <small>${esc(c.item.team)}</small></b>
              <code class="key">"${esc(c.item.name)} (${esc(c.item.team)})":</code>
              ${c.likelyElc ? `<span class="warn">probably on an entry-level contract</span>` : ""}</span>
            <span class="val">${c.maxCap ? `< ${c.maxCap.toFixed(2)} M` : ""}</span>
            <span></span>
          </li>`).join("")}
      </ol>
      ${total > list.length ? `<p class="hint">…and ${total - list.length} more. The list shrinks as cap hits come in.</p>` : ""}
    </details>`;
}

async function main() {
  try {
    const [league, stats] = await Promise.all([loadLeague(), loadJSON("data/stats.json")]);
    render(league, stats);
    showPastSeasonsLink();
    spoilerGate(league, [document.getElementById("standings"), ...document.querySelectorAll(".projection"),
      document.getElementById("categories")]);
  } catch (err) {
    showError(err);
  }
}

main();
