// Past seasons page: the final standings and picks of every archived season.

// An archived season: its own league file (picks, cap hits) and final stats
async function loadSeason(season) {
  const dir = `data/seasons/${season}`;
  const [league, stats, caps] = await Promise.all([
    loadJSON(`${dir}/league.json`), loadJSON(`${dir}/stats.json`), loadJSON(`${dir}/caphits.json`).catch(() => null),
  ]);
  league.lookedUpCaps = caps;
  return { league, stats };
}

function render(league, stats, preview) {
  const { results, rows } = finalStandings(league, stats);
  document.getElementById("meta").textContent = `${seasonLabel(stats.season)} regular season · final standings${preview ? " · preview" : ""}`;
  const trophyNote = preview ? " · preview, the season isn't over yet" : "";
  const banner = document.getElementById("banner");
  banner.innerHTML = bannerHTML(league, stats.season, rows, trophyNote);
  const trophy = banner.querySelector(".trophy");
  trophy.addEventListener("click", () => celebrate(trophy));

  const head = CATEGORIES.map(c => `<th title="${esc(c.label)}">${SHORT[c.key]}</th>`).join("");
  document.getElementById("standings").innerHTML = `
    <div class="scroll"><table class="standings fixed tight">
      <thead><tr><th>#</th><th class="mgr">Manager</th><th class="tot">Total</th><th class="po" title="Playoff picks, 2 per team that made it">PO</th>${head}</tr></thead>
      <tbody>${rows.map(r => `
        <tr class="${meClass(r.manager)}"${mcStyle(league, r.manager)}>
          <td class="place">${r.place}</td>
          <th scope="row" class="mgr">${esc(r.manager)}</th>
          <td class="total">${r.total}</td>
          <td class="po">${r.po}</td>
          ${CATEGORIES.map(c => `<td class="${r.byCat[c.key] ? "" : "zero"}">${r.byCat[c.key]}</td>`).join("")}
        </tr>`).join("")}</tbody>
    </table></div>
    <p class="hint">${CATEGORIES.map(c => `<b>${SHORT[c.key]}</b> ${esc(c.label.replace(/^Most /, ""))}`).join(" · ")}</p>`;

  document.getElementById("categories").innerHTML = results.map(({ cat, entries }) => `
    <section class="card">
      <h3>${esc(cat.label)}</h3>
      <ol class="rank">
        ${entries.map(e => `
          <li class="${e.points ? "scored" : ""}${meClass(e.manager)}"${mcStyle(league, e.manager)}>
            <span class="pl">${e.tied ? "T" : ""}${e.place}</span>
            <span class="who"><b>${esc(e.manager)}</b><span class="pick">${pickLabel(cat, e)}</span></span>
            <span class="val">${fmtValue(cat, e)}</span>
            <span class="pts">${e.points ? "+" + e.points : "0"}</span>
          </li>`).join("")}
      </ol>
    </section>`).join("");
}

async function main() {
  try {
    const seasons = (await loadSeasonIndex()).map(season => ({ season, load: () => loadSeason(season) }));
    // ?final previews the page with the current season as if it had ended
    if (finalPreview()) {
      const stats = await loadJSON("data/stats.json");
      if (!seasons.some(s => s.season === stats.season)) {
        seasons.unshift({ season: stats.season, preview: true, load: async () => {
          const league = await loadLeague();
          AVAILABILITY = {};  // no missed-games badges on a finished season
          return { league, stats };
        } });
      }
    }
    document.title = "Änäri past seasons";
    if (!seasons.length) {
      document.getElementById("meta").textContent = "No finished seasons yet";
      document.getElementById("standings").innerHTML =
        `<p class="muted">The first season is saved here once every team has played 82 games.</p>`;
      document.querySelectorAll("h2").forEach(h => { h.hidden = true; });
      return;
    }
    const pick = document.getElementById("season-pick");
    const show = async season => {
      const s = seasons.find(x => x.season === season) || seasons[0];
      if (seasons.length > 1) {
        pick.innerHTML = `<div class="seg">${seasons.map(x =>
          `<button type="button" data-season="${x.season}" aria-pressed="${x === s}">${seasonLabel(x.season)}</button>`).join("")}</div>`;
      }
      const { league, stats } = await s.load();
      render(league, stats, s.preview);
    };
    pick.addEventListener("click", e => {
      const b = e.target.closest("button[data-season]");
      if (!b) return;
      const url = new URL(location.href);
      url.searchParams.set("season", b.dataset.season);
      history.replaceState(null, "", url);
      show(Number(b.dataset.season));
    });
    await show(Number(new URLSearchParams(location.search).get("season")));
  } catch (err) {
    showError(err);
  }
}

main();
