// View "Übungen": the catalog with filters. exerciseCard() and pickExercise() are reused by plans and training.
import { h, empty } from "./dom.js";
import { REGIONS, GROUPS, byId } from "./regions.js";
import { LEVELS } from "./generator.js";

const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const labels = ids => ids.map(id => byId.get(id)?.label ?? id).join(", ");

function matches(ex, { text = "", region = "", level = 3 }) {
  if (ex.level > level) return false;
  if (region && !ex.primary.includes(region) && !ex.secondary.includes(region)) return false;
  if (!text) return true;
  const hay = norm([ex.name, ex.equipment, ...ex.primary.concat(ex.secondary).map(r => `${byId.get(r).label} ${byId.get(r).aliases}`)].join(" "));
  return norm(text).split(/\s+/).every(w => hay.includes(w));
}

function photo(ex, n) {
  const img = h("img", { src: `img/${ex.id}/${n}.jpg`, alt: `${ex.name}, ${n ? "Ende" : "Start"}`, loading: "lazy", width: 850, height: 567 });
  const btn = h("button", { class: "photo", "aria-label": `${ex.name}, ${n ? "Endposition" : "Startposition"} vergrößern` }, img);
  btn.addEventListener("click", () => btn.closest(".photos").classList.toggle("zoom"));
  return btn;
}

export function exerciseCard(ex, { compact = false } = {}) {
  const text = h("div", { class: "stack" },
    h("section", null, h("h4", null, "Ausgangsposition"), h("p", null, ex.setup)),
    h("section", null, h("h4", null, "Ausführung"), h("ol", null, ex.steps.map(s => h("li", null, s)))),
    h("section", null, h("h4", null, "Darauf achten"), h("ul", null, ex.cues.map(s => h("li", null, s)))),
    h("section", null, h("h4", null, "Häufige Fehler"), h("ul", null, ex.mistakes.map(s => h("li", null, s)))));
  return h("article", { class: "excard stack" },
    h("dl", { class: "facts" },
      h("div", null, h("dt", null, "Ziel"), h("dd", null, labels(ex.primary))),
      ex.secondary.length ? h("div", null, h("dt", null, "Arbeitet mit"), h("dd", null, labels(ex.secondary))) : null,
      h("div", null, h("dt", null, "Equipment"), h("dd", null, ex.equipment))),
    h("div", { class: "photos" }, photo(ex, 0), photo(ex, 1)),
    compact ? h("details", null, h("summary", null, "Ausführung anzeigen"), text) : text);
}

function filterBar(state, onChange, idPrefix) {
  const text = h("input", { type: "search", id: `${idPrefix}-q`, placeholder: "Name oder Muskel", value: state.text, autocomplete: "off" });
  const region = h("select", { id: `${idPrefix}-region` }, h("option", { value: "" }, "Alle Muskeln"),
    GROUPS.map(g => h("optgroup", { label: g }, REGIONS.filter(r => r.group === g).map(r => h("option", { value: r.id, selected: r.id === state.region }, r.label)))));
  const level = h("select", { id: `${idPrefix}-level` },
    Object.entries(LEVELS).map(([n, l]) => h("option", { value: n, selected: Number(n) === state.level }, l)));
  text.addEventListener("input", () => { state.text = text.value.trim(); onChange(); });
  region.addEventListener("change", () => { state.region = region.value; onChange(); });
  level.addEventListener("change", () => { state.level = Number(level.value); onChange(); });
  return h("div", { class: "filters" },
    h("div", { class: "field" }, h("label", { for: `${idPrefix}-q` }, "Suchen"), text),
    h("div", { class: "field" }, h("label", { for: `${idPrefix}-region` }, "Muskel"), region),
    h("div", { class: "field" }, h("label", { for: `${idPrefix}-level` }, "Machbar mit"), level));
}

function row(ex) {
  return h("span", { class: "exrow" }, h("span", { class: "exname" }, ex.name),
    h("span", { class: "muted" }, `${labels(ex.primary)}. ${ex.equipment}`));
}

export function mount(el, ctx) {
  const state = { text: "", region: "", level: 3 };
  const count = h("p", { class: "muted tabular" });
  const list = h("ul", { class: "list exlist" });
  function render() {
    const shown = ctx.exercises.filter(ex => matches(ex, state));
    count.textContent = `${shown.length} von ${ctx.exercises.length} Übungen`;
    list.replaceChildren(...shown.map(ex => {
      const d = h("details", null, h("summary", null, row(ex)));
      d.addEventListener("toggle", () => { if (d.open && d.children.length === 1) d.append(exerciseCard(ex)); }, { once: false });
      return h("li", null, d);
    }));
    if (!shown.length) list.replaceChildren(h("li", null, empty("Keine Übung passt zu diesem Filter.")));
  }
  el.append(h("div", { class: "view-head" }, h("h1", null, "Übungen"), count), filterBar(state, render, "ex"), list);
  render();
}

// Dialog to choose an exercise. Resolves with its id, or null when closed.
export function pickExercise(ctx, { region = "", level = 3, suggest = [] } = {}) {
  return new Promise(resolve => {
    const state = { text: "", region, level };
    let picked = null;
    const list = h("ul", { class: "list exlist" });
    const dialog = h("dialog", { class: "dialog wide" });
    const quick = suggest.length ? h("div", { class: "stack tight" }, h("span", { class: "label" }, "Vorschläge"),
      h("div", { class: "actions one" }, suggest.map(id => h("button", { class: "btn small", onclick: () => { picked = id; dialog.close(); } },
        ctx.exById?.get(id)?.name ?? id)))) : null;
    function render() {
      const shown = ctx.exercises.filter(ex => matches(ex, state));
      list.replaceChildren(...shown.map(ex => h("li", null,
        h("button", { class: "pick", onclick: () => { picked = ex.id; dialog.close(); } }, row(ex)))));
      if (!shown.length) list.replaceChildren(h("li", null, empty("Keine Übung passt zu diesem Filter.")));
    }
    dialog.append(h("div", { class: "stack" }, h("h2", null, "Übung wählen"), quick, filterBar(state, render, "pick"), list,
      h("button", { class: "btn", onclick: () => dialog.close() }, "Abbrechen")));
    dialog.addEventListener("close", () => { dialog.remove(); resolve(picked); });
    document.body.append(dialog);
    render();
    dialog.showModal();
  });
}
