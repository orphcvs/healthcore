// View "Pläne": list of plans and the editor for one plan (a training week of units).
import { h, empty, confirmButton, fmtDate, fmtRest, WEEKDAYS } from "./dom.js";
import { REGIONS } from "./regions.js";
import { prescription, substitutes, estimateMinutes, weeklySets } from "./generator.js";
import { exerciseCard, pickExercise } from "./exercises.js";

const RESTS = [45, 60, 90, 120, 150, 180, 240];
const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);

export function mount(el, ctx) {
  const state = ctx.takeState();
  let alive = true;
  if (state?.openPlanId) showPlan(state.openPlanId);
  else showList();
  return () => { alive = false; };

  async function showList() {
    const plans = (await ctx.store.list("plan")).sort((a, b) => b.updated_at - a.updated_at);
    if (!alive) return;
    el.replaceChildren(h("div", { class: "view-head" }, h("h1", null, "Pläne")));
    if (!plans.length) {
      el.append(empty("Noch kein Plan. Wähle unter Muskeln aus, was du trainieren willst.",
        h("a", { class: "btn primary", href: "#muskeln" }, "Zur Muskelauswahl")));
      return;
    }
    el.append(h("ul", { class: "list" }, plans.map(p => h("li", null,
      h("button", { class: "pick", onclick: () => showPlan(p.id) },
        h("span", { class: "exrow" }, h("span", { class: "exname" }, p.name),
          h("span", { class: "muted" }, `${p.units.length} ${p.units.length === 1 ? "Einheit" : "Einheiten"}, geändert am ${fmtDate(p.updated_at)}`)))))));
  }

  async function showPlan(id) {
    let plan = await ctx.store.get(id);
    if (!alive) return;
    if (!plan) return showList();
    const save = async () => {
      await ctx.store.put("plan", { name: plan.name, units: plan.units, regions: plan.regions || [] }, id);
      render();
    };
    const makeItem = exId => {
      const ex = ctx.exById.get(exId);
      return { exerciseId: exId, target: prescription(ex, ctx.settings().experience), substitutes: [] };
    };
    const refreshSubs = unit => {
      const inUnit = new Set(unit.items.map(i => i.exerciseId));
      for (const it of unit.items) {
        const ex = ctx.exById.get(it.exerciseId);
        it.substitutes = substitutes(ex, ctx.exercises, Math.max(unit.level ?? ctx.settings().level, ex.level), inUnit);
      }
    };

    function itemRow(unit, it, idx) {
      const ex = ctx.exById.get(it.exerciseId);
      const t = it.target;
      const num = (value, min, max, onSet) => {
        const input = h("input", { type: "number", inputmode: "numeric", min, max, value, class: "num" });
        input.addEventListener("change", () => { onSet(clamp(Number(input.value), min, max, value)); save(); });
        return input;
      };
      const field = (label, control) => h("label", { class: "field" }, h("span", null, label), control);
      const rest = h("select", null, RESTS.map(s => h("option", { value: s, selected: s === t.rest }, fmtRest(s))));
      rest.addEventListener("change", () => { t.rest = Number(rest.value); save(); });
      const move = dir => () => {
        const j = idx + dir;
        [unit.items[idx], unit.items[j]] = [unit.items[j], unit.items[idx]];
        save();
      };
      const swapBox = h("div", { class: "actions one", hidden: true },
        it.substitutes.map(sid => h("button", { class: "btn small", onclick: () => swap(sid) }, ctx.exById.get(sid)?.name ?? sid)),
        h("button", { class: "btn small", onclick: async () => {
          const sid = await pickExercise(ctx, { region: ex.primary[0], level: unit.level ?? ctx.settings().level });
          if (sid) swap(sid);
        } }, "Andere Übung"));
      function swap(sid) {
        unit.items[idx] = { ...makeItem(sid) };
        refreshSubs(unit);
        save();
      }
      return h("li", { class: "planitem stack tight" },
        h("details", null, h("summary", null, h("span", { class: "exname" }, ex?.name ?? it.exerciseId)), ex ? exerciseCard(ex, { compact: true }) : null),
        it.note ? h("p", { class: "note" }, it.note) : null,
        h("div", { class: "targets" },
          field("Sätze", num(t.sets, 1, 10, v => { t.sets = v; })),
          field("Wdh. von", num(t.reps[0], 1, 50, v => { t.reps[0] = Math.min(v, t.reps[1]); })),
          field("Wdh. bis", num(t.reps[1], 1, 50, v => { t.reps[1] = Math.max(v, t.reps[0]); })),
          field("Pause", rest)),
        h("div", { class: "actions" },
          h("button", { class: "btn small", disabled: idx === 0, onclick: move(-1), "aria-label": "Nach oben" }, "Hoch"),
          h("button", { class: "btn small", disabled: idx === unit.items.length - 1, onclick: move(1), "aria-label": "Nach unten" }, "Runter"),
          h("button", { class: "btn small", onclick: () => { swapBox.hidden = !swapBox.hidden; } }, "Tauschen"),
          h("button", { class: "linkbtn danger", onclick: () => { unit.items.splice(idx, 1); refreshSubs(unit); save(); } }, "Entfernen")),
        swapBox);
    }

    function unitBlock(unit, ui) {
      const name = h("input", { type: "text", value: unit.name, "aria-label": "Name der Einheit" });
      name.addEventListener("change", () => { unit.name = name.value.trim() || unit.name; save(); });
      const day = h("select", { "aria-label": "Wochentag" }, h("option", { value: "" }, "Ohne Tag"),
        WEEKDAYS.map((d, i) => h("option", { value: i, selected: unit.weekday === i }, d)));
      day.addEventListener("change", () => { unit.weekday = day.value === "" ? null : Number(day.value); save(); });
      return h("section", { class: "unit stack" },
        h("div", { class: "row between" }, name, day,
          h("span", { class: "muted tabular nowrap" }, `ca. ${estimateMinutes(unit.items)} min`)),
        unit.items.length
          ? h("ol", { class: "list" }, unit.items.map((it, i) => itemRow(unit, it, i)))
          : h("p", { class: "empty" }, "Noch keine Übung in dieser Einheit."),
        h("div", { class: "actions" },
          h("button", { class: "btn small", onclick: async () => {
            const sid = await pickExercise(ctx, { level: unit.level ?? ctx.settings().level });
            if (sid) { unit.items.push(makeItem(sid)); refreshSubs(unit); save(); }
          } }, "Übung hinzufügen"),
          confirmButton("Einheit entfernen", "Wirklich entfernen?", () => { plan.units.splice(ui, 1); save(); })));
    }

    function weekBlock() {
      const sets = weeklySets(plan.units, ctx.exById);
      const wanted = new Set(plan.regions || []);
      const rows = REGIONS.filter(r => sets[r.id] || wanted.has(r.id));
      if (!rows.length) return null;
      return h("section", { class: "stack tight" },
        h("h2", null, "Sätze pro Woche"),
        h("p", { class: "muted" }, "Ziel zählt ganz, mitarbeitend halb."),
        h("table", { class: "sets tabular" }, h("tbody", null, rows.map(r => {
          const n = sets[r.id] || 0;
          return h("tr", { class: !n ? "missing" : null }, h("td", null, r.label),
            h("td", null, n ? String(n).replace(".", ",") : "0, kommt in keiner Einheit vor"));
        }))));
    }

    function render() {
      if (!alive) return;
      const title = h("input", { type: "text", class: "title-input", value: plan.name, "aria-label": "Name des Plans" });
      title.addEventListener("change", () => { plan.name = title.value.trim() || plan.name; save(); });
      el.replaceChildren(
        h("button", { class: "linkbtn back", onclick: showList }, "Alle Pläne"),
        h("div", { class: "view-head" }, title),
        h("div", { class: "stack" }, plan.units.map(unitBlock)),
        h("div", { class: "actions one addunit" },
          h("button", { class: "btn primary", onclick: () => ctx.navigate("muskeln", { targetPlanId: id }) }, "Einheit aus Muskelauswahl"),
          h("button", { class: "btn", onclick: () => {
            plan.units.push({ id: crypto.randomUUID(), name: "Neue Einheit", weekday: null, items: [] });
            save();
          } }, "Leere Einheit")),
        weekBlock(),
        h("div", { class: "actions one end" },
          confirmButton("Plan löschen", "Wirklich löschen?", async () => { await ctx.store.remove(id); ctx.toast("Plan gelöscht"); showList(); })));
    }
    plan.units.forEach(refreshSubs);   // the catalog or the rules may have changed since the plan was saved
    render();
  }
}
