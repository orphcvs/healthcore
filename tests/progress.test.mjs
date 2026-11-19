import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKg, fmtKg, e1rm, warmupSets, lastPerformance, suggestNext } from "../app/progress.js";

test("parseKg", () => {   // Review Focus 3
  assert.equal(parseKg("26"), 26);
  assert.equal(parseKg("26,5"), 26.5);
  assert.equal(parseKg(" 26.5 "), 26.5);
  assert.equal(parseKg("0"), 0);
  for (const bad of ["", "abc", "-5", "1e3", "26,", ",5", "26,5,1", "  "]) assert.equal(parseKg(bad), null, bad);
});

test("fmtKg", () => {
  assert.equal(fmtKg(62.5), "62,5");
  assert.equal(fmtKg(60), "60");
  assert.equal(fmtKg(27.25), "27,25");
});

test("e1rm", () => {
  assert.equal(e1rm(100, 10).toFixed(2), "133.33");
});

test("warmupSets", () => {
  assert.deepEqual(warmupSets(100, 2), [50, 70]);
  assert.deepEqual(warmupSets(100, 3), [45, 65, 85]);
  assert.deepEqual(warmupSets(62, 3), [27.5, 40, 52.5]);
  assert.deepEqual(warmupSets(100, 1), [60]);
  assert.deepEqual(warmupSets(100, 4), [45, 60, 75, 85]);
  assert.deepEqual(warmupSets(0, 3), []);
  assert.deepEqual(warmupSets(100, 0), []);
});

test("lastPerformance skips unfinished and deleted", () => {
  const sets = (kg, reps, done = true) => ({ kg, reps, done });
  const sessions = [
    { id: "s1", startedAt: 900, finishedAt: 1000, exercises: [{ exerciseId: "x", sets: [sets(50, 10), sets(50, 8, false)] }] },
    { id: "s2", startedAt: 2000, finishedAt: null, exercises: [{ exerciseId: "x", sets: [sets(60, 10)] }] },
    { id: "s3", startedAt: 2900, finishedAt: 3000, deleted: 1, exercises: [{ exerciseId: "x", sets: [sets(70, 10)] }] },
    { id: "s4", startedAt: 1400, finishedAt: 1500, exercises: [{ exerciseId: "y", sets: [sets(80, 5)] }] },
    { id: "s5", startedAt: 1600, finishedAt: 1700, exercises: [{ exerciseId: "x", sets: [sets(55, 9, false)] }] },
  ];
  assert.deepEqual(lastPerformance(sessions, "x"), { date: 1000, sets: [{ kg: 50, reps: 10, rpe: null }] });
  assert.equal(lastPerformance(sessions, "z"), null);
});

test("lastPerformance ignores ticked sets without reps", () => {   // review I2
  const sessions = [{ id: "s", startedAt: 1, finishedAt: 2, exercises: [{ exerciseId: "x", sets: [{ kg: null, reps: null, done: true }] }] }];
  assert.equal(lastPerformance(sessions, "x"), null);
});

test("suggestNext", () => {
  const last = { sets: [{ kg: 60, reps: 12 }, { kg: 60, reps: 12 }, { kg: 60, reps: 13 }] };
  assert.deepEqual(suggestNext(last, { reps: [8, 12] }, { step: 2.5, bodyweight: false }), { kg: 62.5, text: "Heute 62,5 kg" });
  assert.equal(suggestNext({ sets: [{ kg: 60, reps: 12 }, { kg: 60, reps: 10 }] }, { reps: [8, 12] }, { step: 2.5 }), null);
  assert.deepEqual(suggestNext({ sets: [{ kg: 0, reps: 15 }] }, { reps: [8, 15] }, { step: 0, bodyweight: true }),
    { text: "Heute 1 bis 2 Wiederholungen mehr" });
  assert.equal(suggestNext(null, { reps: [8, 12] }, { step: 2.5 }), null);
});
