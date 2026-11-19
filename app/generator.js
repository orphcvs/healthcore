// Plan generator: pure functions, no browser APIs (tested with node --test).
import { REGIONS, byId } from "./regions.js";

export const LEVELS = { 1: "Ohne Geräte", 2: "Wenig Equipment", 3: "Gym" };
export const MAX_ITEMS = 8;
export const TOO_MANY = "Die Auswahl braucht mehr als 8 Übungen. Teile sie besser auf zwei Einheiten auf.";
const LEVEL_PHRASE = { 1: "ohne Geräte", 2: "mit wenig Equipment" };
const ROLE_ORDER = { heavy: 0, compound: 1, isolation: 2 };
const OWN_ISOLATION = ["schulter_seite", "schulter_hinten"];   // pressing and pulling hit them too little
const BASE = {
  heavy: { warmup: [2, 3], sets: 3, reps: [6, 8], rpe: [7, 8], rest: 180 },
  compound: { warmup: [1, 2], sets: 3, reps: [8, 12], rpe: [7, 8], rest: 120 },
  isolation: { warmup: [0, 1], sets: 2, reps: [10, 15], rpe: [8, 9], rest: 90 },
};

// Weekly splits as in the Muscle Ladder programs: [name, unit type, weekday (0 = Monday)]
const SPLITS = {
  2: [["Ganzkörper A", "full", 0], ["Ganzkörper B", "full", 3]],
  3: [["Ganzkörper A", "full", 0], ["Ganzkörper B", "full", 2], ["Ganzkörper C", "full", 4]],
  4: [["Oberkörper A", "upper", 0], ["Unterkörper A", "lower", 1], ["Oberkörper B", "upper", 3], ["Unterkörper B", "lower", 4]],
  5: [["Oberkörper", "upper", 0], ["Unterkörper", "lower", 1], ["Push", "push", 2], ["Pull", "pull", 3], ["Beine", "lower", 4]],
  6: [["Push A", "push", 0], ["Pull A", "pull", 1], ["Beine A", "lower", 2], ["Push B", "push", 3], ["Pull B", "pull", 4], ["Beine B", "lower", 5]],
};
const UNIT_CATS = {
  full: ["push", "pull", "legs", "core"], upper: ["push", "pull"], lower: ["legs", "core"], push: ["push"], pull: ["pull"],
};

export function prescription(ex, experience) {
  const p = structuredClone(BASE[ex.role]);
  if (ex.bodyweight) p.reps = ex.role === "isolation" ? [12, 20] : [8, 15];
  if (experience === "fortgeschritten") {
    if (ex.role === "isolation") p.sets += 1;
    p.rpe[1] = Math.min(10, p.rpe[1] + 1);
  }
  return p;
}

export function estimateMinutes(items) {
  let seconds = 0;
  for (const { target } of items) seconds += target.sets * (target.rest + 45) + target.warmup[1] * 60;
  return Math.round(seconds / 60 + 5);
}

// Best first: callers give the ranking key as an array, compared left to right (bigger wins).
function best(candidates, key, exercises) {
  const index = new Map(exercises.map((e, i) => [e.id, i]));
  return [...candidates].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return index.get(a.id) - index.get(b.id);
  });
}

export function substitutes(ex, exercises, level, exclude) {
  const first = ex.primary[0];
  const overlap = e => e.primary.filter(r => ex.primary.includes(r)).length;
  const sameTarget = exercises.filter(e => e.id !== ex.id && !exclude.has(e.id) && e.level <= level && e.primary.includes(first));
  // same movement or role first; if that leaves fewer than two, any exercise for the same target fills up
  const strict = e => (e.pattern === ex.pattern || e.role === ex.role ? 1 : 0);
  return best(sameTarget, e => [strict(e), overlap(e), e.pattern === ex.pattern ? 1 : 0], exercises).slice(0, 2).map(e => e.id);
}

export function generateUnit({ regions, level, experience, exercises, avoid = new Set(), priority = new Set(), name = "Einheit" }) {
  const selected = REGIONS.map(r => r.id).filter(id => regions.includes(id));
  const open = new Set(selected);
  const chosen = [];   // {ex, note}
  const has = id => chosen.some(c => c.ex.id === id);
  const score = e => e.primary.reduce((s, r) => s + (open.has(r) ? (priority.has(r) ? 2 : 1) : 0), 0)
    + 0.5 * e.secondary.filter(r => open.has(r)).length;
  // avoided exercises (used in an earlier unit of the same kind) only when nothing else fits
  const fresh = list => (list.some(e => !avoid.has(e.id)) ? list.filter(e => !avoid.has(e.id)) : list);
  const take = (ex, note) => { chosen.push({ ex, note }); ex.primary.forEach(r => open.delete(r)); };

  // 1. compound lifts that hit several selected regions at once. In later units of a week, half the slots
  //    stay free for regions earlier units missed, so the week as a whole covers more.
  const reserved = Math.min(selected.filter(r => priority.has(r)).length, MAX_ITEMS / 2);
  while (open.size && chosen.length < MAX_ITEMS - reserved) {
    const cands = exercises.filter(e => e.role !== "isolation" && e.level <= level && !has(e.id)
      && e.primary.some(r => open.has(r)) && score(e) >= 1.5);
    if (!cands.length) break;
    take(best(fresh(cands), e => [score(e), -ROLE_ORDER[e.role], e.level], exercises)[0]);
  }

  // 2. one exercise per region still open, isolation preferred; side and rear delts always get their own
  const ownIsoMissing = r => OWN_ISOLATION.includes(r)
    && !chosen.some(c => c.ex.role === "isolation" && c.ex.primary.includes(r));
  const unmet = r => open.has(r) || ownIsoMissing(r);
  const order = [...selected.filter(r => priority.has(r)), ...selected.filter(r => !priority.has(r))];
  for (const r of order) {
    if (!unmet(r) || chosen.length >= MAX_ITEMS) continue;
    for (let L = level; L <= 3; L++) {
      const cands = exercises.filter(e => e.level <= L && !has(e.id) && e.primary.includes(r));
      if (!cands.length) continue;
      const ex = best(fresh(cands), e => [e.role === "isolation" ? 1 : 0, score(e), e.level], exercises)[0];
      const note = ex.level > level
        ? `Für ${byId.get(r).akk} gibt es ${LEVEL_PHRASE[level]} keine Übung mit Fotos. Vorgeschlagen ist eine Übung mit ${ex.equipment}.`
        : undefined;
      take(ex, note);
      break;
    }
  }

  const notes = selected.some(unmet) && chosen.length >= MAX_ITEMS ? [TOO_MANY] : [];
  chosen.sort((a, b) => ROLE_ORDER[a.ex.role] - ROLE_ORDER[b.ex.role]);
  const inUnit = new Set(chosen.map(c => c.ex.id));
  const items = chosen.map(({ ex, note }) => ({
    exerciseId: ex.id,
    target: prescription(ex, experience),
    substitutes: substitutes(ex, exercises, Math.max(level, ex.level), inUnit),
    ...(note ? { note } : {}),
  }));
  return { name, level, items, notes, minutes: estimateMinutes(items) };
}

export function generateWeek({ regions, level, experience, exercises, days }) {
  const exById = new Map(exercises.map(e => [e.id, e]));
  const units = [], notes = [], done = [];   // done: [unit type, unit]
  for (const [name, type, weekday] of SPLITS[days]) {
    const cats = UNIT_CATS[type];
    const own = regions.filter(id => cats.includes(byId.get(id)?.cat));
    if (!own.length) {
      notes.push(`${name} fällt weg, weil keiner der ausgewählten Muskeln dazu passt.`);
      continue;
    }
    // vary against earlier units that train the same muscles, and cover what is still missing first
    const avoid = new Set(done.filter(([t]) => UNIT_CATS[t].some(c => cats.includes(c)))
      .flatMap(([, u]) => u.items.map(i => i.exerciseId)));
    const coveredBefore = new Set(done.flatMap(([, u]) => u.items.flatMap(i => exById.get(i.exerciseId).primary)));
    const priority = new Set(own.filter(id => !coveredBefore.has(id)));
    const unit = { ...generateUnit({ regions: own, level, experience, exercises, avoid, priority, name }), weekday };
    units.push(unit);
    done.push([type, unit]);
  }
  return { units, notes };
}

export function weeklySets(units, exercisesById) {
  const sets = {};
  const add = (r, n) => { sets[r] = (sets[r] || 0) + n; };
  for (const u of units) for (const i of u.items) {
    const ex = exercisesById.get(i.exerciseId);
    if (!ex) continue;
    ex.primary.forEach(r => add(r, i.target.sets));
    ex.secondary.forEach(r => add(r, i.target.sets / 2));
  }
  return sets;
}
