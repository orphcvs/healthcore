import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../app/", import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [relative(APP, p).split(sep).join("/")];
  });
}

test("PRECACHE lists every app file except photos and the worker itself", () => {
  const src = readFileSync(join(APP, "sw.js"), "utf8");
  const block = src.match(/const PRECACHE = \[([\s\S]*?)\];/)[1];
  const listed = new Set([...block.matchAll(/"([^"]+)"/g)].map(m => m[1]));
  for (const f of walk(APP).filter(f => !f.startsWith("img/") && f !== "sw.js")) assert.ok(listed.has(f), `${f} missing in PRECACHE`);
  for (const f of listed) if (f !== "./") assert.ok(statSync(join(APP, f), { throwIfNoEntry: false }), `${f} listed but missing`);
});
