// node simplify.mjs jobs.json : simplify each mesh file in place of out path.
// file format: u32 nv, u32 nf, f32 pos[nv*3], u32 idx[nf*3]
import { readFileSync, writeFileSync } from "node:fs";
import { MeshoptSimplifier as S } from "meshoptimizer";

await S.ready;
const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const j of jobs) {
  const b = readFileSync(j.in);
  const nv = b.readUInt32LE(0), nf = b.readUInt32LE(4);
  const pos = new Float32Array(b.buffer.slice(b.byteOffset + 8, b.byteOffset + 8 + nv * 12));
  const idx = new Uint32Array(b.buffer.slice(b.byteOffset + 8 + nv * 12, b.byteOffset + 8 + nv * 12 + nf * 12));
  const [out, err] = S.simplify(idx, pos, 3, j.target * 3, j.maxError, ["Prune", "Regularize"]);
  const head = Buffer.alloc(8);
  head.writeUInt32LE(nv, 0); head.writeUInt32LE(out.length / 3, 4);
  writeFileSync(j.out, Buffer.concat([head, Buffer.from(pos.buffer), Buffer.from(out.buffer, out.byteOffset, out.byteLength)]));
  j.err = err; j.got = out.length / 3;
}
const worst = jobs.reduce((a, j) => (j.err > a.err ? j : a), jobs[0]);
console.log(`simplified ${jobs.length} meshes, worst rel. error ${worst.err.toFixed(4)} (${worst.in})`);
