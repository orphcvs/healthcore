import { test } from "node:test";
import assert from "node:assert/strict";
import { progressPoints } from "../app/history.js";

const ses = (t, exerciseId, sets) => ({ startedAt: t, finishedAt: t + 1, exercises: [{ exerciseId, sets }] });
const set = (kg, reps, done = true) => ({ kg, reps, done });

test("progressPoints: best set by estimated 1RM, oldest first, undone sets ignored", () => {
  const pts = progressPoints([
    ses(200, "x", [set(60, 10), set(70, 5), set(100, 10, false)]),
    ses(100, "x", [set(50, 8)]),
    ses(300, "y", [set(80, 5)]),
  ], "x");
  assert.deepEqual(pts.map(p => p.t), [100, 200]);
  assert.deepEqual(pts[1].best, set(70, 5));           // 70 kg for 5 is 81.7 kg 1RM, 60 kg for 10 only 80
  assert.equal(pts[1].v.toFixed(1), "81.7");
});

test("progressPoints: body weight only counts reps", () => {
  const [p] = progressPoints([ses(1, "klimmzug", [set(0, 8), set(0, 11), set(0, 9)])], "klimmzug");
  assert.equal(p.reps, true);
  assert.equal(p.v, 11);
});
