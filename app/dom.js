// h("button", { class: "btn", onclick: fn }, "Text") builds DOM without HTML strings.
const PROPS = new Set(["value", "checked", "hidden", "disabled", "selected", "open"]);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  el.append(...children.flat(Infinity).filter(c => c != null && c !== false).map(c => (c instanceof Node ? c : String(c))));
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

// A Lucide icon from its path data (24x24 grid, stroked).
export function icon(...paths) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

// Destructive action that asks in place: a second click within 4 s confirms.
export function confirmButton(label, confirmLabel, onConfirm) {
  const btn = h("button", { class: "linkbtn danger" }, label);
  let armed = false;
  btn.addEventListener("click", () => {
    if (armed) return onConfirm();
    armed = true;
    btn.textContent = confirmLabel;
    setTimeout(() => { armed = false; btn.textContent = label; }, 4000);
  });
  return btn;
}

export function empty(text, action) {
  return h("div", { class: "stack" }, h("p", { class: "empty" }, text), action);
}

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function fmtRest(s) {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}:${String(r).padStart(2, "0")} min` : `${m} min`;
}

export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
