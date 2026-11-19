"""Copy the two photos of every catalog exercise from free-exercise-db into app/img/<id>/.

python -I tools/exercises/fetch_images.py app/data/exercises.json app/img   (skips photos already there)
"""
import json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAW = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"


def fetch(job):
    url, dest = job
    if dest.exists():
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            dest.write_bytes(r.read())
    except OSError as err:
        return f"{url}: {err}"
    return None


def main():
    catalog, out = Path(sys.argv[1]), Path(sys.argv[2])
    jobs = [(f"{RAW}{e['source']}/{n}.jpg", out / e["id"] / f"{n}.jpg")
            for e in json.loads(catalog.read_text(encoding="utf-8")) for n in (0, 1)]
    with ThreadPoolExecutor(8) as ex:
        errors = [err for err in ex.map(fetch, jobs) if err]
    for err in errors:
        print(err)
    print(f"{len(jobs)} photos checked, {len(errors)} failed")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
