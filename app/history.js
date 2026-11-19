// View "Verlauf": finished sessions (view, correct, delete), progress per exercise, sets per region in the last 7 days.
import { h, empty, confirmButton, fmtDate } from "./dom.js";
import { REGIONS } from "./regions.js";
import { e1rm, fmtKg, parseKg } from "./progress.js";

const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const doneSets = ex => ex.sets.filter(x => x.done && x.reps >= 1);
const minutes = x => Math.round((x.finishedAt - x.startedAt) / 60000);

// Best set per session: estimated 1RM, or most reps when the exercise is done with body weight only.
export function progressPoints(sessions, exerciseId) {
  const pts = [];
  for (const ses of sessions) {
    const sets = ses.exercises.filter(e => e.exerciseId === exerciseId).flatMap(doneSets);
    if (!sets.length) continue;
    const weighted = sets.filter(x => x.kg > 0);
    pts.push(weighted.length
      ? { t: ses.startedAt, v: Math.max(...weighted.map(x => e1rm(x.kg, x.reps))), best: weighted.reduce((a, b) => (e1rm(b.kg, b.reps) > e1rm(a.kg, a.reps) ? b : a)) }
      : { t: ses.startedAt, v: Math.max(...sets.map(x => x.reps)), best: sets.reduce((a, b) => (b.reps > a.reps ? b : a)), reps: true });
  }
  return pts.sort((a, b) => a.t - b.t);
}

function chart(pts, unit) {
  const W = 600, H = 220, L = 44, R = 16, T = 12, B = 28;
  const vs = pts.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = Math.max((hi - lo) * 0.15, hi * 0.05, 1);
  lo = Math.max(0, Math.floor(lo - pad)); hi = Math.ceil(hi + pad);
  const t0 = pts[0].t, t1 = pts.at(-1).t;
  const x = t => (t1 === t0 ? (L + W - R) / 2 : L + ((t - t0) / (t1 - t0)) * (W - L - R));
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": `Verlauf, ${pts.length} Trainings` });
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    svg.append(s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }));
    const label = s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end", class: "axis" });
    label.textContent = fmtKg(Math.round(v));
    svg.append(label);
  }
  for (const [p, anchor] of [[pts[0], "start"], [pts.at(-1), "end"]]) {
    const label = s("text", { x: x(p.t), y: H - 8, "text-anchor": pts.length === 1 ? "middle" : anchor, class: "axis" });
    label.textContent = fmtDate(p.t);
    svg.append(label);
  }
  if (pts.length > 1) svg.append(s("polyline", { points: pts.map(p => `${x(p.t)},${y(p.v)}`).join(" "), class: "line" }));
  pts.forEach((p, i) => svg.append(s("circle", { cx: x(p.t), cy: y(p.v), r: i === pts.length - 1 ? 6 : 4, class: i === pts.length - 1 ? "dot end" : "dot" })));
  const cross = s("line", { y1: T, y2: H - B, class: "cross", visibility: "hidden" });
  svg.append(cross);
  const tip = h("div", { class: "tip charttip", hidden: true });
  const wrap = h("div", { class: "chartwrap" }, svg, tip);
  svg.addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const p = pts.reduce((a, b) => (Math.abs(x(b.t) - px) < Math.abs(x(a.t) - px) ? b : a));
    cross.setAttribute("x1", x(p.t)); cross.setAttribute("x2", x(p.t)); cross.setAttribute("visibility", "visible");
    tip.replaceChildren(h("b", null, fmtDate(p.t)),
      h("span", null, p.reps ? `${p.v} Wdh.` : `${fmtKg(Math.round(p.v))} ${unit}, bester Satz ${fmtKg(p.best.kg)} kg für ${p.best.reps}`));
    tip.hidden = false;
    const left = (x(p.t) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left - 90, 0), r.width - 190)}px`;
    tip.style.top = `${(y(p.v) / H) * r.height - 64}px`;
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  return wrap;
}

export function mount(el, ctx) {
  let alive = true;
  let chosen = null;
  load();
  return () => { alive = false; };

  async function load() {
    const sessions = (await ctx.store.list("session")).filter(x => x.finishedAt).sort((a, b) => b.startedAt - a.startedAt);
    if (!alive) return;
    el.replaceChildren(h("div", { class: "view-head" }, h("h1", null, "Verlauf")));
    if (!sessions.length) {
      el.append(empty("Noch kein Training gespeichert.", h("a", { class: "btn primary", href: "#training" }, "Zum Training")));
      return;
    }
    el.append(weekBlock(sessions), progressBlock(sessions), listBlock(sessions));
  }

  function weekBlock(sessions) {
    const since = Date.now() - 7 * 86400000;
    const sets = {};
    for (const ses of sessions.filter(x => x.startedAt >= since)) for (const ex of ses.exercises) {
      const meta = ctx.exById.get(ex.exerciseId);
      const n = doneSets(ex).length;
      if (!meta || !n) continue;
      meta.primary.forEach(r => { sets[r] = (sets[r] || 0) + n; });
      meta.secondary.forEach(r => { sets[r] = (sets[r] || 0) + n / 2; });
    }
    const rows = REGIONS.filter(r => sets[r.id]);
    return h("section", { class: "stack tight" }, h("h2", null, "Letzte 7 Tage"),
      rows.length
        ? h("table", { class: "sets tabular" }, h("tbody", null, rows.map(r => h("tr", null, h("td", null, r.label), h("td", null, String(sets[r.id]).replace(".", ","))))))
        : h("p", { class: "empty" }, "In den letzten 7 Tagen kein Training."),
      h("p", { class: "fine" }, "Sätze pro Muskel, Ziel zählt ganz, mitarbeitend halb."));
  }

  function progressBlock(sessions) {
    const ids = [...new Set(sessions.flatMap(x => x.exercises.filter(e => doneSets(e).length).map(e => e.exerciseId)))]
      .filter(id => ctx.exById.has(id)).sort((a, b) => ctx.exById.get(a).name.localeCompare(ctx.exById.get(b).name, "de"));
    if (!ids.length) return null;
    chosen = ids.includes(chosen) ? chosen : ids[0];
    const select = h("select", { id: "progress-ex" }, ids.map(id => h("option", { value: id, selected: id === chosen }, ctx.exById.get(id).name)));
    const body = h("div", { class: "stack" });
    const render = () => {
      const pts = progressPoints(sessions, chosen);
      const reps = pts.every(p => p.reps);
      body.replaceChildren(
        h("h3", null, reps ? "Beste Wiederholungen pro Training" : "Geschätztes 1RM pro Training (kg)"),
        chart(pts, "kg 1RM"),
        h("table", { class: "sets tabular" }, h("tbody", null, [...pts].reverse().map(p => h("tr", null,
          h("td", null, fmtDate(p.t)),
          h("td", null, p.reps ? `${p.v} Wdh.` : `${fmtKg(p.best.kg)} kg für ${p.best.reps}, 1RM ${fmtKg(Math.round(p.v))} kg`))))));
    };
    select.addEventListener("change", () => { chosen = select.value; render(); });
    render();
    return h("section", { class: "stack" }, h("h2", null, "Fortschritt"),
      h("div", { class: "field" }, h("label", { for: "progress-ex" }, "Übung"), select), body);
  }

  function listBlock(sessions) {
    return h("section", { class: "stack tight" }, h("h2", null, "Trainings"),
      h("ul", { class: "list" }, sessions.map(ses => h("li", null, h("button", { class: "pick", onclick: () => detail(ses) },
        h("span", { class: "exrow" }, h("span", { class: "exname" }, `${fmtDate(ses.startedAt)}, ${ses.unit}`),
          h("span", { class: "muted" }, `${minutes(ses)} min, ${ses.exercises.flatMap(doneSets).length} Sätze`)))))));
  }

  function detail(ses) {
    const { id, updated_at: _u, ...data } = ses;
    const save = () => ctx.store.put("session", data, id);
    el.replaceChildren(
      h("button", { class: "linkbtn back", onclick: load }, "Zurück zum Verlauf"),
      h("div", { class: "view-head" }, h("h1", null, `${fmtDate(data.startedAt)}, ${data.unit}`)),
      h("p", { class: "muted" }, `${minutes(data)} min`),
      data.exercises.map(ex => h("section", { class: "exblock stack tight" },
        h("h2", null, ctx.exById.get(ex.exerciseId)?.name ?? ex.exerciseId),
        ex.sets.map((st, i) => {
          const kg = h("input", { type: "text", inputmode: "decimal", class: "num", value: st.kg == null ? "" : fmtKg(st.kg), "aria-label": `Satz ${i + 1} Gewicht in kg` });
          const reps = h("input", { type: "number", class: "num", min: 1, max: 100, value: st.reps ?? "", "aria-label": `Satz ${i + 1} Wiederholungen` });
          const done = h("input", { type: "checkbox", checked: st.done, "aria-label": `Satz ${i + 1} erledigt` });
          const allow = () => { done.disabled = !(st.kg != null && st.reps >= 1) && !st.done; };   // a tick needs weight and reps
          kg.addEventListener("change", () => { const v = parseKg(kg.value); kg.setAttribute("aria-invalid", String(v === null)); if (v !== null) { st.kg = v; save(); } allow(); });
          reps.addEventListener("change", () => { const v = Number(reps.value); if (Number.isInteger(v) && v >= 1) { st.reps = v; save(); } allow(); });
          allow();
          done.addEventListener("change", () => { st.done = done.checked; save(); });
          return h("div", { class: "row" }, h("span", { class: "muted tabular" }, i + 1), kg, h("span", { class: "kgunit" }, "kg"), reps, h("span", { class: "muted" }, "Wdh."), h("label", { class: "choice" }, done, "erledigt"));
        }))),
      data.note ? h("p", null, data.note) : null,
      h("div", { class: "actions one end" },
        confirmButton("Training löschen", "Wirklich löschen?", async () => { await ctx.store.remove(id); ctx.toast("Training gelöscht"); load(); })));
  }
}
