"""Merge tools/exercises/src/*.py into app/data/exercises.json.

python -I tools/exercises/build_catalog.py app/data/exercises.json
Each source file defines X = [ex(...), ...]; order of files and entries is the catalog order.
"""
import json, sys
from pathlib import Path

SRC = Path(__file__).parent / "src"
ORDER = ["brust_schultern", "ruecken", "arme", "rumpf", "beine"]


def ex(id, name, source, pattern, role, level, equipment, bodyweight, step, primary, secondary, setup, steps, cues, mistakes):
    return {"id": id, "name": name, "pattern": pattern, "role": role, "level": level, "equipment": equipment,
            "bodyweight": bodyweight, "step": step, "primary": primary, "secondary": secondary, "source": source,
            "setup": setup, "steps": steps, "cues": cues, "mistakes": mistakes}


def main():
    catalog = []
    for name in ORDER:
        ns = {"ex": ex}
        exec((SRC / f"{name}.py").read_text(encoding="utf-8"), ns)
        catalog += ns["X"]
    out = Path(sys.argv[1])
    out.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(catalog)} exercises -> {out}")


if __name__ == "__main__":
    main()
