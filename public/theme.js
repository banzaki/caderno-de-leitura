// Runs in <head> before the page paints, so there is no flash of the wrong colors.
// The saved choice wins; with none, the computer's light or dark setting is used.
(function () {
  var saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) { /* storage blocked: use the system setting */ }
  var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
