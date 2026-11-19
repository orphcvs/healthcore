import { test } from "node:test";
import assert from "node:assert/strict";
import { lww, mergeIncoming, nextStamp, post, makeSyncer } from "../app/store.js";

const wait = ms => new Promise(r => setTimeout(r, ms));

test("post gives up after the timeout instead of hanging", async () => {   // review C1
  const never = () => new Promise(() => {});
  const t0 = Date.now();
  assert.equal(await post("api/sync", {}, { timeout: 50, fetchFn: never }), "offline");
  assert.ok(Date.now() - t0 < 1000);
});

test("post treats a broken answer as offline", async () => {   // review C1: res.json() outside the try
  const broken = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("cut off"); } });
  assert.equal(await post("api/sync", {}, { fetchFn: broken }), "offline");
  const denied = async () => ({ ok: false, status: 401, json: async () => ({}) });
  assert.equal(await post("api/sync", {}, { fetchFn: denied }), "auth");
});

test("a sync requested while one runs gets its own round afterwards", async () => {   // review I1
  let runs = 0;
  const syncer = makeSyncer(async () => { runs++; await wait(40); return "ok"; }, { delay: 0 });
  const first = syncer.now();
  await wait(10);
  syncer.now();          // an edit arrives while the first request is in flight
  await first;
  await wait(80);
  assert.equal(runs, 2);
  syncer.stop();
});

test("a failed sync retries by itself", async () => {   // review I1
  const results = ["offline", "ok"];
  let runs = 0;
  const syncer = makeSyncer(async () => results[runs++], { delay: 0, retry: [30] });
  await syncer.now();
  await wait(80);
  assert.equal(runs, 2);
  syncer.stop();
});

test("fresh() waits for the running sync and then runs a new one", async () => {   // review I1: login
  let runs = 0;
  const syncer = makeSyncer(async () => { runs++; await wait(30); return runs === 1 ? "auth" : "ok"; }, { delay: 0 });
  syncer.now();
  assert.equal(await syncer.fresh(), "ok");
  assert.equal(runs, 2);
  syncer.stop();
});

test("lww", () => {
  assert.equal(lww({ updated_at: 100, v: "l" }, { updated_at: 200, v: "r" }).v, "r");
  assert.equal(lww({ updated_at: 300, v: "l" }, { updated_at: 200, v: "r" }).v, "l");
  assert.equal(lww({ updated_at: 200, v: "l" }, { updated_at: 200, v: "r" }).v, "l");
  assert.equal(lww(undefined, { updated_at: 1, v: "r" }).v, "r");
});

test("mergeIncoming keeps a newer local edit dirty", () => {   // Review Focus 2
  const local = new Map([["s1", { id: "s1", updated_at: 300, dirty: 1, data: { n: "handy" } }]]);
  assert.deepEqual(mergeIncoming(local, [{ id: "s1", updated_at: 200, data: { n: "pc" } }]), []);
});

test("mergeIncoming takes newer remote and new docs", () => {
  const local = new Map([["s1", { id: "s1", updated_at: 100, data: {} }]]);
  const incoming = [{ id: "s1", updated_at: 200, data: { n: 1 } }, { id: "s2", updated_at: 50, data: {} }];
  assert.deepEqual(mergeIncoming(local, incoming).map(d => d.id), ["s1", "s2"]);
});

test("nextStamp never repeats a timestamp", () => {
  // two edits in the same millisecond must still be ordered, or the server keeps the first
  assert.equal(nextStamp({ updated_at: 1000 }, 1000), 1001);
  assert.equal(nextStamp({ updated_at: 1000 }, 2000), 2000);
  assert.equal(nextStamp(undefined, 5), 5);
});
