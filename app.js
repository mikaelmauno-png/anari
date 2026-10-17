// Standings page.

function render(league, stats) {
  const { results, table } = computeStandings(league, stats);
  document.title = `${league.name} standings`;
  document.getElementById("league-name").textContent = league.name;
  const updated = new Date(stats.updated);
  const season = String(stats.season);
  document.getElementById("meta").textContent =
    `${season.slice(0, 4)}–${season.slice(6)} regular season · stats updated ${updated.toLocaleString()}`;

  const head = CATEGORIES.map(c => `<th title="${esc(c.label)}">${SHORT[c.key]}</th>`).join("");
  const rows = table.map(r => `
    <tr>
      <td class="place">${r.place}</td>
      <th scope="row" class="mgr">${esc(r.manager)}</th>
      <td class="total">${r.total}</td>
      ${CATEGORIES.map(c => `<td class="${r.byCat[c.key] ? "" : "zero"}">${r.byCat[c.key]}</td>`).join("")}
    </tr>`).join("");
  document.getElementById("standings").innerHTML = `
    <div class="scroll"><table class="standings">
      <thead><tr><th>#</th><th class="mgr">Manager</th><th>Total</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="hint">${CATEGORIES.map(c => `<b>${SHORT[c.key]}</b> ${esc(c.label.replace(/^Most /, ""))}`).join(" · ")}</p>`;

  document.getElementById("categories").innerHTML = results.map(({ cat, entries, best, candidates, capWarnings }) => `
    <section class="card">
      <h3>${esc(cat.label)}${cat.source ? ` <span class="src">${cat.source}</span>` : ""}</h3>
      <ol class="rank">
        ${entries.map(e => `
          <li class="${e.points ? "scored" : ""}">
            <span class="pl">${e.tied ? "T" : ""}${e.place}</span>
            <span class="who"><b>${esc(e.manager)}</b><span class="pick">${pickLabel(cat, e)}</span>
              ${e.warnings.map(w => `<span class="warn">⚠ ${esc(w)}</span>`).join("")}</span>
            <span class="val">${fmtValue(cat, e)}</span>
            <span class="pts">${e.points ? "+" + e.points : "0"}</span>
          </li>`).join("")}
      </ol>
      <p class="best">${best
        ? `${candidates && candidates.total ? "Best known pick" : "Best possible pick"}: <b>${pickLabel(cat, best)}</b> <span>${fmtValue(cat, best)}</span>`
        : "Best possible pick: no data"}</p>
      ${candidates ? renderCandidates(league, candidates, capWarnings) : ""}
    </section>`).join("");
}

function renderCandidates(league, { list, total }, capWarnings) {
  const warn = capWarnings.map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join("");
  if (!total) return `${warn}<p class="hint">All players who could beat it have a cap hit entered ✓</p>`;
  return `${warn}
    <details class="cands">
      <summary>${total} player${total === 1 ? "" : "s"} could still be better: check their cap hits</summary>
      <p class="hint">Look up each cap hit and add it to <code>capHits</code> in league.json in millions,
        e.g. <code>"Matt Boldy (MIN)": 7.0</code>, or <code>"ELC"</code> for entry-level contracts.
        A player only beats the best known pick if his cap hit is under the limit shown, so for
        obvious stars a rough number (e.g. <code>10</code>) is enough to clear them off the list.</p>
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
      ${total > list.length ? `<p class="hint">…and ${total - list.length} more. The list shrinks as you add cap hits.</p>` : ""}
    </details>`;
}

async function main() {
  try {
    const [league, stats] = await Promise.all([loadJSON("league.json"), loadJSON("data/stats.json")]);
    render(league, stats);
  } catch (err) {
    showError(err);
  }
}

main();
