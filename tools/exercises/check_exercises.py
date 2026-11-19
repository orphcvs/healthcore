"""Validate the exercise catalog: python -I tools/exercises/check_exercises.py app   (exit 1 on any problem)."""
import json, re, sys
from pathlib import Path

PATTERNS = {"squat", "hinge", "push_h", "push_v", "pull_h", "pull_v", "isolation"}
ROLES = {"heavy", "compound", "isolation"}
ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
FORBIDDEN = ["—", "–", "·", "•", " - "]   # em dash, en dash, middot, bullet, spaced hyphen
COUNTS = {"steps": (3, 5), "cues": (2, 3), "mistakes": (1, 3)}


def check(app: Path):
    regions = re.findall(r'id: "([a-z_]+)"', (app / "regions.js").read_text(encoding="utf-8"))
    exercises = json.loads((app / "data" / "exercises.json").read_text(encoding="utf-8"))
    problems, seen = [], set()
    for e in exercises:
        eid = e.get("id", "?")
        bad = lambda msg: problems.append(f"{eid}: {msg}")
        if not ID.match(eid): bad("id must be lowercase ascii with hyphens")
        if eid in seen: bad("duplicate id")
        seen.add(eid)
        for key, typ in [("name", str), ("equipment", str), ("source", str), ("setup", str), ("bodyweight", bool)]:
            if not isinstance(e.get(key), typ) or e.get(key) == "": bad(f"{key} missing or wrong type")
        if e.get("pattern") not in PATTERNS: bad(f"pattern {e.get('pattern')!r}")
        if e.get("role") not in ROLES: bad(f"role {e.get('role')!r}")
        if e.get("level") not in (1, 2, 3): bad(f"level {e.get('level')!r}")
        if not isinstance(e.get("step"), (int, float)) or e["step"] < 0: bad("step must be a number >= 0")
        prim, sec = e.get("primary", []), e.get("secondary", [])
        if not prim: bad("no primary region")
        for r in prim + sec:
            if r not in regions: bad(f"unknown region {r}")
        if set(prim) & set(sec): bad("region both primary and secondary")
        for key, (lo, hi) in COUNTS.items():
            n = len(e.get(key, []))
            if not lo <= n <= hi: bad(f"{key}: {n} entries, want {lo} to {hi}")
        texts = [e.get("name", ""), e.get("equipment", ""), e.get("setup", "")] + sum((e.get(k, []) for k in COUNTS), [])
        for t in texts:
            for ch in FORBIDDEN:
                if ch in t: bad(f"forbidden character {ch!r} in {t[:40]!r}")
        for n in (0, 1):
            if not (app / "img" / eid / f"{n}.jpg").is_file(): bad(f"photo {n}.jpg missing")
    table = {r: [sum(1 for e in exercises if r in e.get("primary", []) and e.get("level", 9) <= L) for L in (1, 2, 3)] for r in regions}
    for r, (l1, l2, l3) in table.items():
        if not l3: problems.append(f"{r}: no exercise targets it at all")
    return problems, table


if __name__ == "__main__":
    problems, table = check(Path(sys.argv[1]))
    print(f"{'region':16s} {'L1':>3s} {'L2':>3s} {'L3':>3s}")
    for r, counts in table.items():
        gaps = ", fallback" if not counts[0] or not counts[1] else ""
        print(f"{r:16s} {counts[0]:3d} {counts[1]:3d} {counts[2]:3d}{gaps}")
    for p in problems:
        print(p)
    print("ok" if not problems else f"{len(problems)} problem(s)")
    sys.exit(1 if problems else 0)
