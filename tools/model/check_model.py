"""Check the built model: python -I tools/model/check_model.py app/data  (exit 1 on any problem)."""
import json, re, sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
MAX_BYTES = 6_000_000

def region_ids():
    src = (HERE / "build_model.py").read_text(encoding="utf-8")
    block = src[src.index("REGIONS = ["):src.index("\n]\n", src.index("REGIONS = ["))]
    return re.findall(r'^\s+\("([a-z_]+)",', block, re.M)

def problems(data_dir: Path):
    out = []
    man_f, bin_f = data_dir / "model.json", data_dir / "model.bin"
    if not man_f.exists() or not bin_f.exists():
        return [f"missing {man_f} or {bin_f}"]
    man, b = json.loads(man_f.read_text(encoding="utf-8")), bin_f.read_bytes()
    want = set(region_ids()) | {"ctx_muscle", "ctx_bone"}
    got = [p["id"] for p in man["parts"]]
    if len(got) != 29 or set(got) != want:
        out.append(f"parts: expected 29 ({sorted(want - set(got))} missing, {sorted(set(got) - want)} extra), got {len(got)}")
    if len(b) >= MAX_BYTES:
        out.append(f"model.bin is {len(b)} bytes, limit {MAX_BYTES}")
    for p in man["parts"]:
        v = np.frombuffer(b, np.int16, p["pos"][1] * 3, p["pos"][0]).reshape(-1, 3).astype(float)
        f = np.frombuffer(b, np.uint32 if p["idx"][2] == "u32" else np.uint16, p["idx"][1], p["idx"][0]).reshape(-1, 3).astype(int)
        fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
        vn = np.zeros_like(v)
        for k in range(3):
            np.add.at(vn, f[:, k], fn)
        used = np.zeros(len(v), bool); used[f.ravel()] = True
        zero = int(((np.linalg.norm(vn, axis=1) < 1e-6) & used).sum())
        _, cnt = np.unique(np.sort(f, 1), axis=0, return_counts=True)
        dup = int((cnt > 1).sum())
        if zero or dup:
            out.append(f'{p["id"]}: {zero} zero-normal vertices, {dup} duplicate faces')
    return out

if __name__ == "__main__":
    found = problems(Path(sys.argv[1]))
    for line in found:
        print(line)
    print("ok" if not found else f"{len(found)} problem(s)")
    sys.exit(1 if found else 0)
