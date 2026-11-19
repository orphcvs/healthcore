// App shell: routing, login, settings, sync status. Views live in their own modules and export mount(el, ctx).
import * as store from "./store.js";
import { REGIONS } from "./regions.js";
import { h } from "./dom.js";

const VIEWS = { muskeln: "./muscles.js", plaene: "./plans.js", training: "./training.js", verlauf: "./history.js", uebungen: "./exercises.js" };
const DEFAULTS = { experience: "einsteiger", level: 3, sound: true };
const LIGHT_KEY = "hc-light"; // light or dark belongs to the device, theme.js reads it before the first paint
const $ = sel => document.querySelector(sel);

let settings = { ...DEFAULTS };
let exercises = [];
let exById = new Map();
let handoff = null;
let cleanup = null;
let routeToken = 0;
let toastTimer = null;

function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

const ctx = {
  store,
  regions: REGIONS,
  get exercises() { return exercises; },
  get exById() { return exById; },
  navigate(hash, state = null) {
    handoff = state;
    if (location.hash === `#${hash}`) route();
    else location.hash = hash;
  },
  takeState() {
    const s = handoff;
    handoff = null;
    return s;
  },
  settings: () => settings,
  async saveSettings(patch) {
    settings = { ...settings, ...patch };
    await store.put("settings", settings, "settings");
  },
  toast,
};

async function route() {
  const name = location.hash.slice(1) in VIEWS ? location.hash.slice(1) : "muskeln";
  for (const a of document.querySelectorAll(".nav a")) {
    if (a.getAttribute("href") === `#${name}`) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const token = ++routeToken;
  cleanup?.();
  cleanup = null;
  const main = $("#main");
  main.className = "";
  main.replaceChildren();
  try {
    const mod = await import(VIEWS[name]);
    if (token !== routeToken) return;   // the user already went somewhere else
    cleanup = (await mod.mount(main, ctx)) || null;
  } catch (err) {
    console.error(err);
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Diese Ansicht konnte nicht geladen werden. Lade die Seite neu.";
    main.replaceChildren(p);
  }
}

function showStatus() {
  const { state, pending } = store.status();
  let text = "";
  if (state === "offline" && pending) {
    text = pending === 1 ? "Offline. 1 Änderung wird später gespeichert." : `Offline. ${pending} Änderungen werden später gespeichert.`;
  }
  if (state === "auth") text = "Bitte neu anmelden. Deine Einträge bleiben auf diesem Gerät.";
  const banner = $("#banner");
  banner.textContent = text;
  banner.hidden = !text;
  const needLogin = state === "auth";
  $("#login").hidden = !needLogin;
  $("#main").hidden = needLogin;
  $("#top").hidden = needLogin;
  if (needLogin) $("#login-pw").focus();
}

async function loadSettings() {
  const s = await store.get("settings");
  if (s) settings = { experience: s.experience ?? DEFAULTS.experience, level: s.level ?? DEFAULTS.level, sound: s.sound ?? DEFAULTS.sound };
}

function isLight() {
  try { return localStorage.getItem(LIGHT_KEY) === "1"; } catch { return false; }
}

function setLight(on) {
  try {
    if (on) localStorage.setItem(LIGHT_KEY, "1");
    else localStorage.removeItem(LIGHT_KEY);
  } catch { /* storage blocked: stays dark */ }
  applyTheme();
}

// dark by default, light only when this device chose it in the settings (bright gyms)
function applyTheme() {
  const root = document.documentElement, light = isLight();
  if (light) root.dataset.theme = "light";
  else delete root.dataset.theme;
  $('meta[name="theme-color"]').content = light ? "#ffffff" : "#000000";
  document.dispatchEvent(new Event("themechange")); // the 3D view repaints its selection colour
}

function setupLogin() {
  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("#login-error");
    err.hidden = true;
    let res;
    try {
      res = await fetch("api/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("#login-pw").value }) });
    } catch {
      err.textContent = "Keine Verbindung zum Server. Prüf dein Netz und versuch es noch einmal.";
      err.hidden = false;
      return;
    }
    if (res.status === 204) {
      $("#login-pw").value = "";
      await store.syncFresh();
      await loadSettings();
      showStatus();
      route();
      return;
    }
    err.textContent = res.status === 429 ? "Zu viele Versuche. Versuch es in 15 Minuten wieder." : "Das Passwort stimmt nicht.";
    err.hidden = false;
  });
}

function setupSettings() {
  const dialog = $("#settings");
  const form = $("#settings-form");
  const warning = $("#logout-warning");
  let armed = false;
  // without a server, logging out would only wipe this browser's data
  if (store.localOnly()) $("#logout").closest(".stack").hidden = true;
  $("#open-settings").addEventListener("click", () => {
    form.experience.value = settings.experience;
    form.level.value = String(settings.level);
    form.sound.checked = settings.sound;
    form.light.checked = isLight();
    warning.hidden = true;
    armed = false;
    $("#logout").textContent = "Abmelden";
    dialog.showModal();
  });
  form.addEventListener("change", e => {
    if (e.target === form.light) { setLight(form.light.checked); return; } // this device only, never synced
    ctx.saveSettings({ experience: form.experience.value, level: Number(form.level.value), sound: form.sound.checked });
  });
  $("#logout").addEventListener("click", async () => {
    const { pending } = store.status();
    if (pending && !armed) {   // logging out wipes this device, so unsent entries would be lost
      warning.textContent = pending === 1
        ? "1 Änderung ist noch nicht auf dem Server und geht beim Abmelden verloren."
        : `${pending} Änderungen sind noch nicht auf dem Server und gehen beim Abmelden verloren.`;
      warning.hidden = false;
      $("#logout").textContent = "Trotzdem abmelden";
      armed = true;
      return;
    }
    try { await fetch("api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch { /* offline: local wipe still happens */ }
    await store.clearAll();
    settings = { ...DEFAULTS };
    dialog.close();
    location.reload();
  });
}

// Photos of every exercise in a plan go into the offline cache, so the gym works without signal.
let photoTimer = 0;
function precachePlanPhotos() {
  clearTimeout(photoTimer);
  photoTimer = setTimeout(async () => {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.active) return;
    const plans = await store.list("plan");
    const ids = new Set(plans.flatMap(p => p.units.flatMap(u => u.items.map(i => i.exerciseId))));
    reg.active.postMessage({ type: "precache-images", urls: [...ids].flatMap(id => [`img/${id}/0.jpg`, `img/${id}/1.jpg`]) });
  }, 3000);
}

// Safari may drop site data of web apps that are not on the home screen, so say it once.
function iosHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  let seen = false;
  try { seen = localStorage.getItem("hc-ios-hint") === "1"; } catch { /* storage blocked, show it */ }
  if (!ios || seen) return;
  const hint = h("div", { class: "hint" },
    h("p", null, "Tipp: Füg HealthCore über Teilen und „Zum Home-Bildschirm“ hinzu. Dann behält das iPhone deine Einträge auch, wenn du länger offline bist."),
    h("button", { class: "btn small", onclick: () => { try { localStorage.setItem("hc-ios-hint", "1"); } catch { /* fine */ } hint.remove(); } }, "Verstanden"));
  $("#banner").after(hint);
}

async function start() {
  await store.openStore();
  exercises = await (await fetch("data/exercises.json")).json();
  exById = new Map(exercises.map(e => [e.id, e]));
  await loadSettings();
  setupLogin();
  setupSettings();
  store.onChange(() => { showStatus(); loadSettings(); precachePlanPhotos(); });
  navigator.serviceWorker?.register("sw.js").catch(err => console.warn("offline cache unavailable", err));
  iosHint();
  addEventListener("hashchange", route);
  // A device with data shows it at once and syncs in the background, so a weak signal in the gym never
  // hides a running training. A fresh device has nothing to show and waits for the first answer.
  if (await store.isEmpty()) {
    const state = await store.sync();
    showStatus();
    if (state !== "auth") route();
    return;
  }
  showStatus();
  route();
  const state = await store.sync();
  if (state === "ok" && store.status().pulled && document.activeElement === document.body) route();   // news from another device
}

start();
