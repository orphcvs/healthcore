// Local-first document store: every change lands in IndexedDB first, then syncs with api/sync.
// Pure merge rules at the top are tested in node; browser APIs are only touched inside functions.

// Static hosting (GitHub Pages) has no api/sync: its build adds <meta name="hc-storage" content="local">,
// then nothing is ever sent and all data stays in this browser's IndexedDB.
export const localOnly = () => globalThis.document?.querySelector('meta[name="hc-storage"]')?.content === "local";

export function lww(local, remote) {
  return !local || remote.updated_at > local.updated_at ? remote : local;
}

// Remote docs to write locally: new ones and those newer than ours. A newer local edit stays (and stays dirty).
export function mergeIncoming(local, incoming) {
  return incoming.filter(r => lww(local.get(r.id), r) === r);
}

// Strictly increasing per document, so two edits within one millisecond keep their order on the server.
export function nextStamp(prev, now = Date.now()) {
  return prev ? Math.max(now, prev.updated_at + 1) : now;
}

// One sync request with a time limit. Never throws: answers the body, "offline" or "auth".
export async function post(url, body, { timeout = 10000, fetchFn = fetch } = {}) {
  const ctrl = new AbortController();
  let timer = 0;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => { ctrl.abort(); reject(new Error("timeout")); }, timeout); });
  const work = (async () => {
    const res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    if (res.status === 401) return "auth";
    if (!res.ok) return "offline";
    return await res.json();
  })();
  work.catch(() => {});
  try {
    return await Promise.race([work, limit]);
  } catch {
    return "offline";
  } finally {
    clearTimeout(timer);
  }
}

// Runs one sync at a time. A request made meanwhile gets its own round afterwards; "offline" retries with backoff.
export function makeSyncer(run, { delay = 800, retry = [30000, 60000, 120000, 300000] } = {}) {
  let running = null;
  let again = false;
  let timer = 0;
  let fails = 0;
  const schedule = (ms = delay) => { clearTimeout(timer); timer = setTimeout(now, ms); };
  function now() {
    if (running) { again = true; return running; }
    clearTimeout(timer);
    running = Promise.resolve().then(run).catch(() => "offline").then(result => {
      fails = result === "offline" ? fails + 1 : 0;
      return result;
    }).finally(() => {
      running = null;
      if (again) { again = false; schedule(0); } else if (fails) schedule(retry[Math.min(fails, retry.length) - 1]);
    });
    return running;
  }
  return {
    now,
    schedule,
    async fresh() {   // after a login: whatever is in flight was sent without the new cookie
      if (running) await running;
      clearTimeout(timer);
      again = false;
      return now();
    },
    idle: () => running ?? Promise.resolve(),
    stop() { clearTimeout(timer); again = false; fails = 0; },
  };
}

let db = null;
let since = 0;
let state = "ok";
let pending = 0;
let pulled = 0;
let generation = 0;   // bumped by clearAll, so a sync that started before a logout never writes afterwards
const listeners = new Set();

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = t => new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = t.onabort = () => reject(t.error); });
const docs = (mode = "readonly") => db.transaction("docs", mode).objectStore("docs");
const view = d => ({ id: d.id, ...d.data, updated_at: d.updated_at });
const wire = d => ({ id: d.id, kind: d.kind, data: d.data, updated_at: d.updated_at, deleted: d.deleted });

function changed() {
  for (const cb of listeners) cb();
}

const syncer = makeSyncer(runSync);
const schedule = () => syncer.schedule();

export async function openStore() {
  db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("healthcore", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("docs", { keyPath: "id" }); r.result.createObjectStore("meta"); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  since = (await req(db.transaction("meta").objectStore("meta").get("since"))) || 0;
  pending = (await req(docs().getAll())).filter(d => d.dirty).length;
  addEventListener("online", () => sync());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
}

export async function isEmpty() {
  return (await req(docs().count())) === 0;
}

export async function get(id) {
  const d = await req(docs().get(id));
  return d && !d.deleted ? view(d) : null;
}

export async function list(kind) {
  return (await req(docs().getAll())).filter(d => d.kind === kind && !d.deleted).map(view);
}

async function write(id, kind, data, deleted) {
  const s = docs("readwrite");
  const prev = await req(s.get(id));
  const doc = { id, kind, data, updated_at: nextStamp(prev), deleted, dirty: 1 };
  await req(s.put(doc));
  if (!prev?.dirty) pending++;
  changed();
  schedule();
  return doc;
}

export function put(kind, data, id = crypto.randomUUID()) {
  return write(id, kind, data, 0);
}

export async function remove(id) {
  const prev = await req(docs().get(id));
  if (prev) await write(id, prev.kind, prev.data, 1);
}

function setState(next, count) {
  state = next;
  pending = count;
  changed();
  return next;
}

async function runSync() {
  if (!db) return state;
  if (localOnly()) return setState("ok", 0);
  const epoch = generation;
  const dirty = (await req(docs().getAll())).filter(d => d.dirty);
  const body = await post("api/sync", { since, changes: dirty.map(wire) });
  if (body === "offline" || body === "auth") return setState(body, dirty.length);   // nothing is dropped, it waits
  if (epoch !== generation) return state;   // logged out meanwhile: drop the answer
  const t = db.transaction(["docs", "meta"], "readwrite");
  const s = t.objectStore("docs");
  const current = new Map((await req(s.getAll())).map(d => [d.id, d]));
  for (const d of dirty) {
    const c = current.get(d.id);
    if (c && c.updated_at === d.updated_at) { c.dirty = 0; s.put(c); }   // unchanged since we sent it
  }
  const incoming = mergeIncoming(current, body.changes);
  for (const r of incoming) s.put({ ...r, dirty: 0 });
  t.objectStore("meta").put(body.rev, "since");
  await done(t);
  since = body.rev;
  pulled = incoming.length;
  const left = (await req(docs().getAll())).filter(d => d.dirty).length;
  return setState("ok", left);
}

export function sync() {
  return syncer.now();
}

// After a login: wait for a request still in flight (sent without the cookie), then sync again.
export function syncFresh() {
  return syncer.fresh();
}

export function status() {
  return { state, pending, pulled };
}

export function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function clearAll() {
  syncer.stop();
  generation++;
  await syncer.idle();
  const t = db.transaction(["docs", "meta"], "readwrite");
  t.objectStore("docs").clear();
  t.objectStore("meta").clear();
  await done(t);
  since = 0;
  setState("ok", 0);
}
