import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REGIONS } from "../app/regions.js";
import { prescription, generateUnit, generateWeek, weeklySets, substitutes, estimateMinutes } from "../app/generator.js";

const exercises = JSON.parse(readFileSync(new URL("./fixtures/exercises.json", import.meta.url), "utf8"));
const byEx = new Map(exercises.map(e => [e.id, e]));
const ROLE_ORDER = { heavy: 0, compound: 1, isolation: 2 };
const FIXTURE_REGIONS = [...new Set(exercises.flatMap(e => e.primary))];
const unit = (regions, level = 3, extra = {}) => generateUnit({ regions, level, experience: "einsteiger", exercises, ...extra });
const primaryOf = u => new Set(u.items.flatMap(i => byEx.get(i.exerciseId).primary));

test("prescription values", () => {
  assert.deepEqual(prescription({ role: "heavy", bodyweight: false }, "einsteiger"), { warmup: [2, 3], sets: 3, reps: [6, 8], rpe: [7, 8], rest: 180 });
  assert.deepEqual(prescription({ role: "isolation", bodyweight: false }, "fortgeschritten"), { warmup: [0, 1], sets: 3, reps: [10, 15], rpe: [8, 10], rest: 90 });
  assert.deepEqual(prescription({ role: "compound", bodyweight: true }, "einsteiger").reps, [8, 15]);
  assert.deepEqual(prescription({ role: "isolation", bodyweight: true }, "einsteiger").reps, [12, 20]);
});

test("every selected region is a primary target", () => {
  const sel = ["brust", "schulter_seite", "trizeps_lang"];
  const covered = primaryOf(unit(sel));
  for (const r of sel) assert.ok(covered.has(r), r);
});

test("level is respected", () => {
  const u = unit(["brust", "quadrizeps"], 1);
  for (const i of u.items) assert.ok(byEx.get(i.exerciseId).level <= 1 || i.note, i.exerciseId);
  assert.deepEqual(u.items.map(i => i.exerciseId).sort(), ["kniebeuge-koerpergewicht", "liegestuetz"]);
});

test("fallback note uses the exact wording", () => {
  const [item] = unit(["soleus"], 1).items;
  assert.equal(item.exerciseId, "kh-wadenheben-sitzend");
  assert.equal(item.note, "Für den Schollenmuskel gibt es ohne Geräte keine Übung mit Fotos. Vorgeschlagen ist eine Übung mit Kurzhanteln.");
});

test("side and rear delts get their own isolation", () => {
  const u = unit(["brust", "schulter_seite", "schulter_hinten"]);
  for (const r of ["schulter_seite", "schulter_hinten"])
    assert.ok(u.items.some(i => byEx.get(i.exerciseId).role === "isolation" && byEx.get(i.exerciseId).primary.includes(r)), r);
});

test("max 8 exercises with note", () => {
  const u = unit(FIXTURE_REGIONS);
  assert.equal(u.items.length, 8);
  assert.ok(u.notes.includes("Die Auswahl braucht mehr als 8 Übungen. Teile sie besser auf zwei Einheiten auf."));
});

test("no note when everything fits", () => {
  assert.deepEqual(unit(["brust", "bizeps"]).notes, []);
});

test("order heavy, compound, isolation", () => {
  const order = unit(FIXTURE_REGIONS).items.map(i => ROLE_ORDER[byEx.get(i.exerciseId).role]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("substitutes are valid", () => {
  const u = unit(FIXTURE_REGIONS, 2);
  const inUnit = new Set(u.items.map(i => i.exerciseId));
  for (const i of u.items) {
    const ex = byEx.get(i.exerciseId);
    assert.ok(i.substitutes.length <= 2);
    for (const s of i.substitutes) {
      const sub = byEx.get(s);
      assert.ok(!inUnit.has(s), `${s} already in unit`);
      assert.ok(sub.primary.includes(ex.primary[0]), `${s} for ${ex.id}`);
      assert.ok(sub.level <= Math.max(2, ex.level), `${s} level`);
    }
  }
  assert.deepEqual(substitutes(byEx.get("lh-bankdruecken"), exercises, 3, new Set(["lh-bankdruecken"])).sort(), ["kh-bodendruecken", "liegestuetz"]);
});

test("substitutes fill up with the same target when the strict rule finds too few", () => {
  const mk = (id, pattern, role, level = 1) => ({ id, pattern, role, level, primary: ["trizeps_kurz"], secondary: [] });
  const list = [mk("dips", "push_h", "compound"), mk("kickback", "isolation", "isolation"), mk("liegestuetz-eng", "push_h", "compound"), mk("maschine", "isolation", "isolation", 3)];
  // strict match (same pattern or role) first, then the same-target exercise, never above the level
  assert.deepEqual(substitutes(list[0], list, 1, new Set()), ["liegestuetz-eng", "kickback"]);
});

test("avoid picks a different exercise when possible", () => {
  const [item] = unit(["brust"], 3, { avoid: new Set(["lh-bankdruecken"]) }).items;
  assert.ok(["liegestuetz", "kh-bodendruecken"].includes(item.exerciseId), item.exerciseId);
});

test("units remember the equipment level they were made for", () => {   // review I3
  assert.equal(unit(["brust"], 1).level, 1);
  assert.deepEqual(generateWeek({ regions: ["brust", "quadrizeps"], level: 2, experience: "einsteiger", exercises, days: 2 }).units.map(u => u.level), [2, 2]);
});

test("unknown region ids are ignored", () => {
  assert.deepEqual(unit(["gibtsnicht"]).items, []);
});

const week = (regions, days) => generateWeek({ regions, level: 3, experience: "einsteiger", exercises, days });

test("split names and weekdays", () => {
  const expected = {
    2: [["Ganzkörper A", 0], ["Ganzkörper B", 3]],
    3: [["Ganzkörper A", 0], ["Ganzkörper B", 2], ["Ganzkörper C", 4]],
    4: [["Oberkörper A", 0], ["Unterkörper A", 1], ["Oberkörper B", 3], ["Unterkörper B", 4]],
    5: [["Oberkörper", 0], ["Unterkörper", 1], ["Push", 2], ["Pull", 3], ["Beine", 4]],
    6: [["Push A", 0], ["Pull A", 1], ["Beine A", 2], ["Push B", 3], ["Pull B", 4], ["Beine B", 5]],
  };
  for (const [days, want] of Object.entries(expected))
    assert.deepEqual(week(FIXTURE_REGIONS, +days).units.map(u => [u.name, u.weekday]), want, `days ${days}`);
});

test("every selected region appears as primary in the week", () => {
  const sel = ["brust", "quadrizeps", "lat", "bizeps", "schulter_seite"];
  for (let days = 2; days <= 6; days++) {
    const covered = new Set(week(sel, days).units.flatMap(u => [...primaryOf(u)]));
    for (const r of sel) assert.ok(covered.has(r), `${r} with ${days} days`);
  }
});

test("A and B differ", () => {
  const units = week(FIXTURE_REGIONS, 4).units;
  const ids = name => units.find(u => u.name === name).items.map(i => i.exerciseId).sort();
  assert.notDeepEqual(ids("Oberkörper A"), ids("Oberkörper B"));
});

test("empty day is dropped with note", () => {
  const w = week(["brust", "schulter_seite", "trizeps_lang"], 4);
  assert.deepEqual(w.units.map(u => u.name), ["Oberkörper A", "Oberkörper B"]);
  assert.ok(w.notes.includes("Unterkörper A fällt weg, weil keiner der ausgewählten Muskeln dazu passt."));
});

test("weeklySets", () => {
  const units = [{ items: [{ exerciseId: "lh-bankdruecken", target: { sets: 3 } }] }];
  assert.deepEqual(weeklySets(units, byEx), { brust: 3, schulter_vorne: 1.5, trizeps_kurz: 1.5 });
});

test("estimateMinutes", () => {
  assert.equal(estimateMinutes([{ target: { sets: 3, rest: 180, warmup: [2, 3] } }]), 19);
});

test("real catalog: every region at every level yields a primary exercise or a fallback note", () => {
  const catalog = JSON.parse(readFileSync(new URL("../app/data/exercises.json", import.meta.url), "utf8"));
  const byId = new Map(catalog.map(e => [e.id, e]));
  for (const r of REGIONS) for (const level of [1, 2, 3]) {
    const u = generateUnit({ regions: [r.id], level, experience: "einsteiger", exercises: catalog });
    const item = u.items.find(i => byId.get(i.exerciseId).primary.includes(r.id));
    assert.ok(item, `${r.id} level ${level}`);
    if (byId.get(item.exerciseId).level > level) assert.ok(item.note, `${r.id} level ${level} needs a note`);
  }
});

test("real catalog: a full gym week covers every region", () => {
  const catalog = JSON.parse(readFileSync(new URL("../app/data/exercises.json", import.meta.url), "utf8"));
  const byId = new Map(catalog.map(e => [e.id, e]));
  const w = generateWeek({ regions: REGIONS.map(r => r.id), level: 3, experience: "einsteiger", exercises: catalog, days: 6 });
  const covered = new Set(w.units.flatMap(u => u.items.flatMap(i => byId.get(i.exerciseId).primary)));
  assert.deepEqual(REGIONS.map(r => r.id).filter(id => !covered.has(id)), []);
});

test("real catalog: later full-body days cover what earlier days missed", () => {
  const catalog = JSON.parse(readFileSync(new URL("../app/data/exercises.json", import.meta.url), "utf8"));
  const byId = new Map(catalog.map(e => [e.id, e]));
  const missing = days => {
    const w = generateWeek({ regions: REGIONS.map(r => r.id), level: 3, experience: "einsteiger", exercises: catalog, days });
    const covered = new Set(w.units.flatMap(u => u.items.flatMap(i => byId.get(i.exerciseId).primary)));
    return REGIONS.filter(r => !covered.has(r.id)).length;
  };
  assert.ok(missing(3) <= 4, `3 days miss ${missing(3)} regions`);
  assert.ok(missing(3) < missing(2), "a third day must add coverage");
});

test("regions match the model parts", () => {
  const parts = JSON.parse(readFileSync(new URL("../app/data/model.json", import.meta.url), "utf8")).parts
    .map(p => p.id).filter(id => !id.startsWith("ctx_"));
  assert.deepEqual(parts.sort(), REGIONS.map(r => r.id).sort());
});
