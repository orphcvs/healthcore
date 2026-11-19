// Runs in <head> before anything is drawn: light only when this device chose it in the settings.
// The choice belongs to the device (localStorage, see app.js), not to the synced settings.
try {
  if (localStorage.getItem("hc-light") === "1") {
    document.documentElement.dataset.theme = "light";
    document.querySelector('meta[name="theme-color"]').content = "#ffffff";
  }
} catch { /* storage blocked: dark */ }
