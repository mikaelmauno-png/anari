// Settings page: per-device preferences, saved in this browser only.

let league = null;

function render() {
  const s = getSettings();
  document.getElementById("me").innerHTML = [["", "Just watching", "No manager highlighted."],
    ...league.managers.map(m => [m, m, "Your rows and picks are highlighted and your cards come first."])]
    .map(([value, title, hint]) => `
    <label class="option">
      <input type="radio" name="me" value="${esc(value)}" ${s.me === value ? "checked" : ""}>
      <span><b>${value ? `<span class="swatch" style="background:${managerColor(league, value)}"></span>` : ""}${esc(title)}</b><small>${hint}</small></span>
    </label>`).join("");

  document.getElementById("cards").innerHTML = [
    ["hidden", "Hidden until I tap them", "Each game night starts face down. Cards you've turned stay turned until the next game night."],
    ["revealed", "Always revealed", "Show every manager's game night straight away."],
  ].map(([value, title, hint]) => `
    <label class="option">
      <input type="radio" name="cards" value="${value}" ${s.cards === value ? "checked" : ""}>
      <span><b>${title}</b><small>${hint}</small></span>
    </label>`).join("");
  const seen = readStore(FLIPPED_KEY, {});
  const n = (seen.managers || []).length;
  document.getElementById("reset").innerHTML = s.cards === "hidden" && n
    ? `<button type="button" id="hide-again">Turn ${n} card${n === 1 ? "" : "s"} face down again</button>`
    : "";

  document.getElementById("spoilers").innerHTML = `
    <label class="option">
      <input type="checkbox" name="spoilerFree" ${s.spoilerFree ? "checked" : ""} ${s.cards === "revealed" ? "disabled" : ""}>
      <span><b>Hide last night's results until I've turned ${s.me ? "my card" : "the cards"}</b>
        <small>${s.cards === "revealed"
          ? "Needs the cards to start hidden (above)."
          : `Covers the standings, category cards, weekly changes, scores and playoff picture until you turn ${s.me ? `${esc(s.me)}'s card` : "every card"} on Last round, or tap “Show anyway”.`}</small></span>
    </label>`;
}

document.addEventListener("change", e => {
  if (e.target.name === "me") setSetting("me", e.target.value);
  else if (e.target.name === "cards") setSetting("cards", e.target.value);
  else if (e.target.name === "spoilerFree") setSetting("spoilerFree", e.target.checked);
  else return;
  flash(); render();
});
document.addEventListener("click", e => {
  if (e.target.id === "hide-again") { writeStore(FLIPPED_KEY, {}); writeStore(SPOILER_OK_KEY, null); flash(); render(); }
});

function flash() {
  const el = document.getElementById("saved");
  el.textContent = "Saved";
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.textContent = ""; }, 1500);
}

loadLeague().then(l => { league = l; render(); }).catch(showError);
