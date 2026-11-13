// Color theme: loaded in every page's <head>, before anything is drawn, so the
// page never flashes in the wrong colors. Sets <html data-theme="light|dark|vaporwave">;
// style.css picks the palette from that attribute.
//
// The choice lives in the same per-device settings as the rest of Settings
// ("anari-settings" in localStorage, key "theme"). score.js isn't loaded yet
// at this point, so the setting is read here directly.

// Status bar / browser toolbar color for each theme (matches --bg in style.css)
const THEME_BARS = { light: "#f4f5f7", dark: "#0b1120", vaporwave: "#1a0b2e" };
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function savedTheme() {
  // localStorage can be unavailable (private mode), so fall back to "auto"
  try { return JSON.parse(localStorage.getItem("anari-settings") || "{}").theme || "auto"; }
  catch { return "auto"; }
}

// Apply a theme choice: "auto" follows the device's light/dark setting
function applyTheme(choice = savedTheme()) {
  const theme = choice === "auto" ? (darkQuery.matches ? "dark" : "light") : choice;
  document.documentElement.dataset.theme = theme;
  const bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.content = THEME_BARS[theme] || THEME_BARS.dark;
}

applyTheme();
// On "auto", follow the device when it switches between light and dark (e.g. at sunset)
darkQuery.addEventListener("change", () => applyTheme());
