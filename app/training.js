// View "Training": start a unit, log every set, rest timer, keep the screen on. Every change is saved at once.
import { h, icon, empty, confirmButton, fmtRest, WEEKDAYS } from "./dom.js";
import { lastPerformance, suggestNext, warmupSets, parseKg, fmtKg } from "./progress.js";
import { prescription, substitutes } from "./generator.js";
import { exerciseCard, pickExercise } from "./exercises.js";

const CHECK = "M20 6 9 17l-5-5";
const today = () => (new Date().getDay() + 6) % 7;   // 0 = Monday
const dayMonth = ms => new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
const clock = ms => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function lastText(last) {
  const sets = last.sets.filter(s => s.reps);
  if (!sets.length) return null;
  const same = sets.every(s => s.kg === sets[0].kg);
  const body = same
    ? `${sets.map(s => s.reps).join(", ")} Wdh. mit ${fmtKg(sets[0].kg)} kg`
    : sets.map(s => `${fmtKg(s.kg)} kg für ${s.reps}`).join(", ");
  return `Letztes Mal am ${dayMonth(last.date)}: ${body}`;
}

// Weights come from last time; bodyweight exercises start at 0 kg extra weight.
function newSets(target, last, ex) {
  return Array.from({ length: target.sets }, (_, i) => ({
    kg: last?.sets[i]?.kg ?? last?.sets.at(-1)?.kg ?? (ex?.bodyweight ? 0 : null), reps: null, rpe: null, done: false, at: null,
  }));
}

export function mount(el, ctx) {
  let alive = true;
  let tick = 0;
  let wake = null;
  let audio = null;
  const stopWake = () => { wake?.release?.().catch(() => {}); wake = null; };
  const onVisible = () => { if (document.visibilityState === "visible" && el.querySelector(".session")) keepAwake(); };
  async function keepAwake() {
    try { wake = await navigator.wakeLock?.request("screen"); } catch { /* not allowed here, fine */ }
  }
  document.addEventListener("visibilitychange", onVisible);
  start();
  return () => { alive = false; clearInterval(tick); stopWake(); document.removeEventListener("visibilitychange", onVisible); };

  async function start() {
    const [sessions, plans] = await Promise.all([ctx.store.list("session"), ctx.store.list("plan")]);
    if (!alive) return;
    const running = sessions.find(s => !s.finishedAt);
    if (running) return showSession(running.id);
    showStart(sessions, plans);
  }

  function showStart(sessions, plans) {
    clearInterval(tick);
    stopWake();
    const lastTrained = new Map();
    for (const s of sessions) if (s.unitId) lastTrained.set(s.unitId, Math.max(lastTrained.get(s.unitId) || 0, s.startedAt));
    const units = plans.flatMap(p => p.units.map(u => ({ plan: p, unit: u })))
      .sort((a, b) => (lastTrained.get(b.unit.id) || 0) - (lastTrained.get(a.unit.id) || 0));
    const card = ({ plan, unit }) => h("li", null, h("button", { class: "pick", onclick: () => begin(plan, unit) },
      h("span", { class: "exrow" }, h("span", { class: "exname" }, unit.name),
        h("span", { class: "muted" }, [plan.name, unit.weekday != null ? WEEKDAYS[unit.weekday] : null,
          `${unit.items.length} Übungen`, lastTrained.has(unit.id) ? `zuletzt am ${dayMonth(lastTrained.get(unit.id))}` : null].filter(Boolean).join(", ")))));
    const todays = units.filter(x => x.unit.weekday === today());
    el.replaceChildren(h("div", { class: "view-head" }, h("h1", null, "Training"),
      h("button", { class: "btn", onclick: () => begin(null, null) }, "Freies Training")));
    if (!units.length) {
      el.append(empty("Noch keine Einheit. Leg unter Pläne eine an oder starte ein freies Training.",
        h("a", { class: "btn primary", href: "#muskeln" }, "Zur Muskelauswahl")));
      return;
    }
    if (todays.length) el.append(h("section", { class: "stack tight" }, h("h2", null, "Heute"), h("ul", { class: "list" }, todays.map(card))));
    el.append(h("section", { class: "stack tight" }, h("h2", null, "Alle Einheiten"), h("ul", { class: "list" }, units.map(card))));
  }

  async function begin(plan, unit) {
    const sessions = await ctx.store.list("session");
    const exercises = (unit?.items || []).map(it => {
      const target = structuredClone(it.target);
      return { exerciseId: it.exerciseId, target, sets: newSets(target, lastPerformance(sessions, it.exerciseId), ctx.exById.get(it.exerciseId)) };
    });
    const doc = await ctx.store.put("session", {
      planId: plan?.id ?? null, unitId: unit?.id ?? null, unit: unit?.name ?? "Freies Training",
      startedAt: Date.now(), finishedAt: null, note: "", restUntil: null, level: unit?.level ?? ctx.settings().level, exercises,
    });
    showSession(doc.id);
  }

  async function showSession(id) {
    const s = await ctx.store.get(id);
    if (!alive || !s) return;
    const history = (await ctx.store.list("session")).filter(x => x.id !== id);
    const { id: _id, updated_at: _u, ...data } = s;
    const session = data;
    keepAwake();
    const save = () => ctx.store.put("session", session, id);

    const restTime = h("b", { class: "tabular" });
    const restBar = h("div", { class: "restbar", hidden: true }, h("span", null, restTime, " Pause"),
      h("button", { class: "btn small", onclick: () => { session.restUntil = Math.max(session.restUntil, Date.now()) + 30000; save(); renderRest(); } }, "+30 s"),
      h("button", { class: "btn small", onclick: () => { session.restUntil = null; save(); renderRest(); } }, "Überspringen"));
    function renderRest() {
      const left = session.restUntil ? Math.round((session.restUntil - Date.now()) / 1000) : 0;
      if (left <= 0) {
        // Cleared only locally: saving here would let a forgotten second tab push its old copy of the session.
        if (session.restUntil && !restBar.hidden) {
          if (ctx.settings().sound) beep();
          navigator.vibrate?.(200);
        }
        session.restUntil = null;
        restBar.hidden = true;
        return;
      }
      restBar.hidden = false;
      restTime.textContent = mmss(left);
    }
    function beep() {
      if (!audio) return;
      try {
        audio.resume?.();
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.2, audio.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6);
        o.connect(g).connect(audio.destination);
        o.start();
        o.stop(audio.currentTime + 0.6);
      } catch { /* no audio, fine */ }
    }

    function setRow(exIdx, set, i) {
      const ex = session.exercises[exIdx];
      const kg = h("input", { type: "text", inputmode: "decimal", value: set.kg == null ? "" : fmtKg(set.kg), "aria-label": `Satz ${i + 1} Gewicht in kg`, class: "num" });
      const reps = h("input", { type: "number", inputmode: "numeric", min: 1, max: 100, value: set.reps ?? "",
        placeholder: "Wdh.", "aria-label": `Satz ${i + 1} Wiederholungen`, class: "num" });
      const rpe = h("select", { "aria-label": `Satz ${i + 1} RPE` }, h("option", { value: "" }, "RPE"),
        [6, 7, 8, 9, 10].map(n => h("option", { value: n, selected: set.rpe === n }, n)));
      const check = h("button", { class: "checkbtn", "aria-pressed": String(set.done), "aria-label": `Satz ${i + 1} erledigt` }, icon(CHECK));
      function validate() {
        const k = parseKg(kg.value), r = Number(reps.value);
        const kgOk = kg.value.trim() === "" ? false : k !== null;
        kg.setAttribute("aria-invalid", String(kg.value.trim() !== "" && k === null));
        check.disabled = !(kgOk && Number.isInteger(r) && r >= 1);
        return { k, r };
      }
      kg.addEventListener("input", validate);
      kg.addEventListener("change", () => { const { k } = validate(); if (k !== null) { set.kg = k; save(); } });
      reps.addEventListener("input", validate);
      reps.addEventListener("change", () => { const { r } = validate(); set.reps = Number.isInteger(r) && r >= 1 ? r : null; save(); });
      rpe.addEventListener("change", () => { set.rpe = rpe.value ? Number(rpe.value) : null; save(); });
      check.addEventListener("click", () => {
        const { k, r } = validate();
        if (check.disabled) return;
        set.kg = k; set.reps = r;
        set.done = !set.done;
        set.at = set.done ? Date.now() : null;
        check.setAttribute("aria-pressed", String(set.done));
        if (set.done) {
          try { audio ??= new AudioContext(); audio.resume?.(); } catch { /* no audio */ }   // created on a tap, or iOS keeps it mute
          session.restUntil = Date.now() + ex.target.rest * 1000;
          renderRest();
        }
        save();
      });
      validate();
      return h("div", { class: "setrow" }, h("span", { class: "muted tabular" }, i + 1), kg, h("span", { class: "kgunit" }, "kg"), reps, rpe, check);
    }

    function exBlock(ex, exIdx) {
      const meta = ctx.exById.get(ex.exerciseId);
      const last = lastPerformance(history, ex.exerciseId);
      const hint = suggestNext(last, ex.target, meta);
      const firstKg = ex.sets[0]?.kg;
      const warm = firstKg ? warmupSets(firstKg, ex.target.warmup[1]) : [];
      const swap = async () => {
        const level = Math.max(session.level ?? ctx.settings().level, meta.level);
        const subs = substitutes(meta, ctx.exercises, level, new Set(session.exercises.map(e => e.exerciseId)));
        const sid = await pickExercise(ctx, { region: meta.primary[0], level, suggest: subs });
        if (!sid) return;
        const target = prescription(ctx.exById.get(sid), ctx.settings().experience);
        session.exercises[exIdx] = { exerciseId: sid, target, sets: newSets(target, lastPerformance(history, sid), ctx.exById.get(sid)) };
        save();
        render();
      };
      return h("section", { class: "exblock stack tight" },
        h("h2", null, meta?.name ?? ex.exerciseId),
        h("p", { class: "muted" }, `${ex.target.sets} Sätze, ${ex.target.reps[0]} bis ${ex.target.reps[1]} Wdh., RPE ${ex.target.rpe[0]} bis ${ex.target.rpe[1]}, Pause ${fmtRest(ex.target.rest)}`),
        last && lastText(last) ? h("p", null, lastText(last)) : null,
        hint ? h("p", null, h("b", null, hint.text)) : null,
        warm.length ? h("p", { class: "muted" }, `Aufwärmen: ${warm.map(w => `${fmtKg(w)} kg`).join(", ")}`) : null,
        h("div", { class: "sets-grid" },
          h("div", { class: "setrow sethead", "aria-hidden": "true" }, ["", "kg", "Wdh.", "RPE", "Fertig"].map(t => h("span", null, t))),
          ex.sets.map((st, i) => setRow(exIdx, st, i))),
        h("div", { class: "actions" },
          h("button", { class: "btn small", onclick: () => { ex.sets.push({ ...ex.sets.at(-1), reps: null, rpe: null, done: false, at: null }); save(); render(); } }, "Satz hinzufügen"),
          h("button", { class: "btn small", onclick: swap }, "Übung tauschen")),
        meta ? h("details", null, h("summary", null, "Ausführung und Fotos"), exerciseCard(meta)) : null,
        h("button", { class: "linkbtn danger", onclick: () => { session.exercises.splice(exIdx, 1); save(); render(); } }, "Entfernen"));
    }

    const elapsed = h("span", { class: "muted tabular" });
    const updateElapsed = () => { elapsed.textContent = `seit ${clock(session.startedAt)}, ${Math.round((Date.now() - session.startedAt) / 60000)} min`; };

    function render() {
      if (!alive) return;
      const note = h("textarea", { id: "session-note", rows: 3, placeholder: "Wie lief es?" });
      note.value = session.note || "";
      note.addEventListener("change", () => { session.note = note.value; save(); });
      el.replaceChildren(h("div", { class: "session stack" },
        h("div", { class: "view-head" }, h("div", { class: "stack tight" }, h("h1", null, session.unit), elapsed),
          h("button", { class: "btn primary", onclick: finish }, "Training beenden")),
        session.exercises.length ? session.exercises.map(exBlock) : h("p", { class: "empty" }, "Noch keine Übung. Füg die erste hinzu."),
        h("div", { class: "actions one" }, h("button", { class: "btn", onclick: async () => {
          const sid = await pickExercise(ctx, { level: session.level ?? ctx.settings().level });
          if (!sid) return;
          const target = prescription(ctx.exById.get(sid), ctx.settings().experience);
          session.exercises.push({ exerciseId: sid, target, sets: newSets(target, lastPerformance(history, sid), ctx.exById.get(sid)) });
          save();
          render();
        } }, "Übung hinzufügen")),
        h("div", { class: "field" }, h("label", { for: "session-note" }, "Notiz"), note),
        confirmButton("Training verwerfen", "Wirklich verwerfen?", async () => { await ctx.store.remove(id); start(); }),
        restBar));
      updateElapsed();
      renderRest();
    }

    async function finish() {
      session.finishedAt = Date.now();
      session.restUntil = null;
      await save();
      clearInterval(tick);
      stopWake();
      const done = session.exercises.flatMap(e => e.sets.filter(x => x.done));
      const moved = done.reduce((sum, x) => sum + (x.kg || 0) * (x.reps || 0), 0);
      el.replaceChildren(h("div", { class: "stack" }, h("h1", null, "Training gespeichert"),
        h("dl", { class: "facts big" },
          h("div", null, h("dt", null, "Dauer"), h("dd", { class: "tabular" }, `${Math.round((session.finishedAt - session.startedAt) / 60000)} min`)),
          h("div", null, h("dt", null, "Sätze"), h("dd", { class: "tabular" }, String(done.length))),
          h("div", null, h("dt", null, "Bewegt"), h("dd", { class: "tabular" }, `${fmtKg(Math.round(moved))} kg`))),
        h("div", { class: "actions" }, h("a", { class: "btn primary", href: "#verlauf" }, "Zum Verlauf"),
          h("button", { class: "btn", onclick: start }, "Fertig"))));
    }

    clearInterval(tick);
    tick = setInterval(() => { updateElapsed(); renderRest(); }, 1000);
    render();
  }
}
