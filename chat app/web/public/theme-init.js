// Pre-paint: apply the saved appearance before the app bundle loads so dark mode never flashes light.
// Loaded as a blocking same-origin script (the CSP forbids inline scripts). Mirrors web/src/app/theme.ts:
// default light; "system" follows the OS.
(function () {
  try {
    var choice = localStorage.getItem("shopbridge.theme");
    var dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var theme = dark ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    // Storage blocked: theme.ts applies the default once the app loads.
  }
})();
