// View "Muskeln": pick regions on the 3D body or in the list, then generate a unit or a week.
import { h, WEEKDAYS } from "./dom.js";
import { GROUPS } from "./regions.js";
import { generateUnit, generateWeek, LEVELS } from "./generator.js";
import { createBodyViewer } from "./model.js";
const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const reps = t => `${t.sets} Sätze, ${t.reps[0]} bis ${t.reps[1]} Wdh.`;

export function mount(el, ctx) {
  const target = ctx.takeState();
  const selected = new Set();
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  let query = "";
  let days = 3;
  let tipTimer = 0;
  el.className = "wide";

  // stage with the 3D body
  const tip = h("div", { class: "tip", hidden: true });
  const loading = h("p", { class: "loading" }, "Modell wird geladen");
  const view = h("div", { class: "view3d" });
  const viewer = createBodyViewer(view, { onHover: showTip, onToggle: toggle });
  const viewButtons = [["front", "Vorne"], ["back", "Hinten"], ["side", "Seite"]].map(([v, label], i) => {
    const b = h("button", { class: "btn small", "aria-pressed": String(i === 0) }, label);
    b.addEventListener("click", () => {
      viewer.setView(v);
      viewButtons.forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    });
    return b;
  });
  const stage = h("section", { class: "stage" },
    h("div", { class: "stage-head" },
      h("p", { class: "muted" }, canHover ? "Ziehen zum Drehen, Klick wählt einen Muskel aus" : "Wischen zum Drehen, Tippen wählt einen Muskel aus")),
    view, h("div", { class: "views", role: "group", "aria-label": "Ansicht" }, viewButtons), loading, tip);
  viewer.ready.then(() => loading.remove(), () => { loading.textContent = "Das Modell konnte nicht geladen werden. Lade die Seite neu."; });

  // side panel
  const search = h("input", { type: "search", id: "muscle-search", placeholder: "z. B. Schulter, Lat, Waden", autocomplete: "off" });
  search.addEventListener("input", () => { query = norm(search.value.trim()); renderList(); });
  const summary = h("div", { class: "stack" });
  const gen = h("div", { class: "stack" });
  const groups = h("div", { class: "groups" });
  const side = h("aside", { class: "side" },
    h("h1", null, "Muskeln"),
    h("div", { class: "field" }, h("label", { for: "muscle-search" }, "Suchen"), search),
    summary, gen, groups);
  el.append(h("div", { class: "muscles" }, stage, side));

  function showTip(id, x, y) {
    clearTimeout(tipTimer);
    for (const n of groups.querySelectorAll(".item.hot")) n.classList.remove("hot");
    if (!id) { if (x != null || canHover) tip.hidden = true; return; }
    const r = ctx.regions.find(x => x.id === id);
    groups.querySelector(`.item[data-id="${id}"]`)?.classList.add("hot");
    tip.replaceChildren(h("b", null, r.label), h("i", null, r.latin));
    tip.hidden = false;
    const s = stage.getBoundingClientRect();
    if (x == null) {   // touch: show at the top of the body view for a moment
      tip.style.left = "16px";
      tip.style.top = `${view.offsetTop + 8}px`;
      tipTimer = setTimeout(() => { tip.hidden = true; }, 2500);
    } else {
      tip.style.left = `${Math.min(x - s.left + 14, s.width - tip.offsetWidth - 8)}px`;
      tip.style.top = `${y - s.top + 16}px`;
    }
  }

  function toggle(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    update();
  }

  function update() {
    viewer.setSelected(selected);
    renderSummary();
    renderGen();
    renderList();
  }

  function renderSummary() {
    const chosen = ctx.regions.filter(r => selected.has(r.id));
    summary.replaceChildren(chosen.length
      ? h("div", { class: "stack tight" },
          h("p", null, h("b", null, `${chosen.length} ausgewählt`)),
          h("p", { class: "muted" }, chosen.map(r => r.label).join(", ")),
          h("button", { class: "linkbtn", onclick: () => { selected.clear(); update(); } }, "Auswahl leeren"))
      : h("p", { class: "empty" }, "Noch nichts ausgewählt. Tipp einen Muskel an oder such ihn hier."));
  }

  function renderGen() {
    const level = ctx.settings().level;
    const levelButtons = Object.entries(LEVELS).map(([n, label]) =>
      h("button", { class: "btn small", "aria-pressed": String(Number(n) === level),
        onclick: async () => { await ctx.saveSettings({ level: Number(n) }); renderGen(); } }, label));
    const daySelect = h("select", { id: "week-days", "aria-label": "Tage pro Woche" },
      [2, 3, 4, 5, 6].map(d => h("option", { value: d, selected: d === days }, `${d} Tage`)));
    daySelect.addEventListener("change", () => { days = Number(daySelect.value); });
    const none = !selected.size;
    gen.replaceChildren(
      h("div", { class: "field" }, h("span", { class: "label" }, "Equipment"), h("div", { class: "actions three" }, levelButtons)),
      h("div", { class: "actions one" },
        h("button", { class: "btn primary", disabled: none, onclick: makeUnit }, "Einheit erstellen"),
        h("span", { class: "actions nowrap" }, daySelect, h("button", { class: "btn", disabled: none, onclick: makeWeek }, "Woche erstellen"))),
      ...(target?.targetPlanId ? [h("p", { class: "muted" }, "Die neue Einheit kommt in deinen Plan.")] : []));
  }

  function renderList() {
    groups.replaceChildren();
    let shown = 0;
    for (const g of GROUPS) {
      const regs = ctx.regions.filter(r => r.group === g && (!query || norm(`${g} ${r.label} ${r.latin} ${r.aliases}`).includes(query)));
      if (!regs.length) continue;
      const all = regs.every(r => selected.has(r.id));
      const head = h("button", { class: "group-head", "aria-pressed": String(all), title: all ? "Gruppe abwählen" : "Ganze Gruppe auswählen" }, g);
      head.addEventListener("click", () => { regs.forEach(r => (all ? selected.delete(r.id) : selected.add(r.id))); update(); });
      const items = regs.map(r => {
        const cb = h("input", { type: "checkbox", checked: selected.has(r.id) });
        cb.addEventListener("change", () => toggle(r.id));
        const item = h("label", { class: "item", "data-id": r.id }, cb, h("span", null, h("span", null, r.label), h("i", null, r.latin)));
        if (canHover) {
          item.addEventListener("mouseenter", () => viewer.setHover(r.id));
          item.addEventListener("mouseleave", () => viewer.setHover(null));
        }
        return item;
      });
      groups.append(h("section", { class: "group" }, head, items));
      shown += regs.length;
    }
    if (!shown) groups.append(h("p", { class: "empty" }, "Kein Muskel passt zu dieser Suche."));
  }

  const common = () => ({ regions: [...selected], level: ctx.settings().level, experience: ctx.settings().experience, exercises: ctx.exercises });

  function unitName() {
    const names = GROUPS.filter(g => ctx.regions.some(r => r.group === g && selected.has(r.id)));
    return names.length > 3 ? "Ganzkörper" : names.join(" und ");
  }

  function makeUnit() {
    const unit = generateUnit({ ...common(), name: unitName() });
    preview({ units: [{ ...unit, weekday: null }], notes: [] });
  }

  function makeWeek() {
    preview(generateWeek({ ...common(), days }));
  }

  async function preview(result) {
    const plans = (await ctx.store.list("plan")).sort((a, b) => b.updated_at - a.updated_at);
    const nameInputs = [];
    const planSelect = h("select", { id: "save-plan" },
      plans.map(p => h("option", { value: p.id, selected: p.id === target?.targetPlanId }, p.name)),
      h("option", { value: "new", selected: !target?.targetPlanId || !plans.length }, "Neuer Plan"));
    const planName = h("input", { type: "text", id: "save-plan-name", value: "Meine Woche" });
    const nameField = h("div", { class: "field" }, h("label", { for: "save-plan-name" }, "Name des neuen Plans"), planName);
    const syncNameField = () => { nameField.hidden = planSelect.value !== "new"; };
    planSelect.addEventListener("change", syncNameField);
    syncNameField();

    const units = result.units.map((u, i) => {
      const input = h("input", { type: "text", value: u.name, "aria-label": "Name der Einheit" });
      nameInputs.push(input);
      return h("section", { class: "unit stack tight" },
        h("div", { class: "row between" }, input,
          h("span", { class: "muted tabular nowrap" }, `${u.weekday != null ? `${WEEKDAYS[u.weekday]}, ` : ""}ca. ${u.minutes} min`)),
        u.notes.map(n => h("p", { class: "note" }, n)),
        h("ol", { class: "list numbered" }, u.items.map(it => h("li", null,
          h("span", null, ctx.exById.get(it.exerciseId)?.name ?? it.exerciseId),
          h("span", { class: "muted" }, reps(it.target)),
          it.note ? h("span", { class: "note" }, it.note) : null))));
    });

    const dialog = h("dialog", { class: "dialog wide" });
    const save = h("button", { class: "btn primary", disabled: !result.units.length }, "Speichern");
    save.addEventListener("click", async () => {
      save.disabled = true;
      const fresh = result.units.map((u, i) => ({ id: crypto.randomUUID(), name: nameInputs[i].value.trim() || u.name, weekday: u.weekday ?? null, level: u.level, items: u.items }));
      let id = planSelect.value;
      if (id === "new") {
        id = (await ctx.store.put("plan", { name: planName.value.trim() || "Meine Woche", units: fresh, regions: [...selected] })).id;
      } else {
        const p = plans.find(x => x.id === id);
        const regions = [...new Set([...(p.regions || []), ...selected])];   // what the week is meant to train
        await ctx.store.put("plan", { name: p.name, units: [...p.units, ...fresh], regions }, id);
      }
      dialog.close();
      ctx.toast("Gespeichert");
      ctx.navigate("plaene", { openPlanId: id });
    });
    dialog.append(h("div", { class: "stack" },
      h("h2", null, result.units.length > 1 ? "Vorschlag für deine Woche" : "Vorschlag"),
      result.notes.map(n => h("p", { class: "note" }, n)),
      result.units.length ? units : h("p", { class: "empty" }, "Für diese Auswahl passt kein Trainingstag."),
      h("div", { class: "field" }, h("label", { for: "save-plan" }, "Speichern in"), planSelect),
      nameField,
      h("div", { class: "actions" }, save, h("button", { class: "btn", onclick: () => dialog.close() }, "Abbrechen"))));
    dialog.addEventListener("close", () => dialog.remove());
    el.append(dialog);
    dialog.showModal();
  }

  update();
  return () => { clearTimeout(tipTimer); viewer.dispose(); };
}
