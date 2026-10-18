// Settings page: per-device preferences, saved in this browser only.

function render() {
  const s = getSettings();
  document.getElementById("cards").innerHTML = [
    ["hidden", "Hidden until I tap them", "Each game night starts face down. Cards you've turned stay turned until the next game night."],
    ["revealed", "Always revealed", "Show every manager's game night straight away."],
  ].map(([value, title, hint]) => `
    <label class="option">
      <input type="radio" name="cards" value="${value}" ${s.cards === value ? "checked" : ""}>
      <span><b>${title}</b><small>${hint}</small></span>
    </label>`).join("");
  const seen = readStore("anari-flipped", {});
  const n = (seen.managers || []).length;
  document.getElementById("reset").innerHTML = s.cards === "hidden" && n
    ? `<button type="button" id="hide-again">Turn ${n} card${n === 1 ? "" : "s"} face down again</button>`
    : "";
}

document.addEventListener("change", e => {
  if (e.target.name === "cards") { setSetting("cards", e.target.value); flash(); render(); }
});
document.addEventListener("click", e => {
  if (e.target.id === "hide-again") { writeStore("anari-flipped", {}); flash(); render(); }
});

function flash() {
  const el = document.getElementById("saved");
  el.textContent = "Saved";
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.textContent = ""; }, 1500);
}

render();
