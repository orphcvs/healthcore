// Logbook maths: pure functions, no browser APIs (tested with node --test).

const KG = /^\d+([.,]\d+)?$/;
const WARMUP = { 1: [0.6], 2: [0.5, 0.7], 3: [0.45, 0.65, 0.85], 4: [0.45, 0.6, 0.75, 0.85] };

export function parseKg(s) {
  const t = String(s).trim();
  return KG.test(t) ? Number(t.replace(",", ".")) : null;
}

export function fmtKg(n) {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

export function e1rm(kg, reps) {
  return kg * (1 + reps / 30);   // Epley
}

export function warmupSets(workKg, count) {
  if (!(workKg > 0) || !WARMUP[count]) return [];
  return WARMUP[count].map(f => Math.round((workKg * f) / 2.5) * 2.5);
}

// Newest finished session with at least one ticked set of this exercise; only ticked sets.
export function lastPerformance(sessions, exerciseId) {
  let found = null;
  for (const s of sessions) {
    if (!s.finishedAt || s.deleted) continue;
    const done = (s.exercises || []).filter(e => e.exerciseId === exerciseId).flatMap(e => e.sets.filter(x => x.done && x.reps >= 1));
    if (done.length && (!found || s.finishedAt > found.date))
      found = { date: s.finishedAt, sets: done.map(x => ({ kg: x.kg, reps: x.reps, rpe: x.rpe ?? null })) };
  }
  return found;
}

// More weight once every working set reached the top of the rep range last time.
export function suggestNext(last, target, ex) {
  if (!last?.sets?.length || !last.sets.every(s => s.reps >= target.reps[1])) return null;
  if (ex.bodyweight || !ex.step) return { text: "Heute 1 bis 2 Wiederholungen mehr" };
  const kg = Math.max(...last.sets.map(s => s.kg)) + ex.step;
  return { kg, text: `Heute ${fmtKg(kg)} kg` };
}
