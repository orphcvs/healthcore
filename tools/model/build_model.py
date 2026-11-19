"""BodyParts3D STLs -> app/data/model.bin + model.json for the HealthCore body viewer.

weld -> solid head -> cut aponeurosis sheets -> meshoptimizer simplify (node, simplify.mjs) -> Taubin smooth
-> drop fragments -> quantize to int16.
Run: python -I tools/model/build_model.py [--cache tools/model/cache] app/data   (needs `npm ci` in tools/model)
"""
import argparse, json, re, struct, subprocess, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix, diags
from scipy.sparse.csgraph import connected_components
from scipy.spatial import ConvexHull

HERE = Path(__file__).parent
CACHE = HERE / "cache"              # set from --cache in main()
REPO = "Kevin-Mattheus-Moerman/BodyParts3D"
RAW = f"https://raw.githubusercontent.com/{REPO}/main/assets/BodyParts3D_data/"
BUDGET = {"muscle": 330_000, "bone": 90_000}   # triangles for the whole figure

# region id (labels live in app/regions.js), BodyParts3D name patterns ({s} = right/left). Hidden deep muscles are left out.
REGIONS = [
    ("brust_oben", ["clavicular part of {s} pectoralis major"]),
    ("brust", ["sternocostal part of {s} pectoralis major", "abdominal part of {s} pectoralis major"]),
    ("serratus", ["{s} serratus anterior"]),
    ("schulter_vorne", ["clavicular part of {s} deltoid"]),
    ("schulter_seite", ["acromial part of {s} deltoid"]),
    ("schulter_hinten", ["spinal part of {s} deltoid"]),
    ("rotatoren", ["{s} supraspinatus", "{s} infraspinatus muscle", "{s} teres minor"]),
    ("lat", ["{s} latissimus dorsi", "{s} teres major"]),
    ("trapez_oben", ["descending part of {s} trapezius"]),
    ("trapez_mitte", ["transverse part of {s} trapezius", "{s} rhomboid major", "{s} rhomboid minor"]),
    ("trapez_unten", ["ascending part of {s} trapezius"]),
    ("rueckenstrecker", ["{s} iliocostalis lumborum", "{s} iliocostalis thoracis", "{s} iliocostalis cervicis", "{s} longissimus thoracis", "{s} longissimus cervicis", "{s} longissimus capitis", "{s} spinalis thoracis", "{s} spinalis cervicis"]),
    ("bizeps", ["long head of {s} biceps brachii", "short head of {s} biceps brachii"]),
    ("brachialis", ["{s} brachialis"]),
    ("trizeps_lang", ["long head of {s} triceps brachii"]),
    ("trizeps_kurz", ["lateral head of {s} triceps brachii", "medial head of {s} triceps brachii"]),
    ("unterarm", ["{s} brachioradialis", "{s} flexor carpi radialis", "humeral head of {s} flexor carpi ulnaris", "ulnar head of {s} flexor carpi ulnaris", "{s} extensor carpi radialis longus", "{s} extensor carpi radialis brevis", "humeral head of {s} extensor carpi ulnaris", "ulnar head of {s} extensor carpi ulnaris", "{s} palmaris longus", "{s} extensor digitorum", "radial head of {s} flexor digitorum superficialis"]),
    ("bauch", ["{s} rectus abdominis"]),
    ("bauch_schraeg", ["{s} external oblique"]),
    ("gluteus_max", ["{s} gluteus maximus"]),
    ("gluteus_med", ["{s} gluteus medius", "{s} tensor fasciae latae"]),
    ("quadrizeps", ["{s} rectus femoris", "{s} vastus lateralis", "{s} vastus medialis"]),
    ("beinbizeps", ["long head of {s} biceps femoris", "short head of {s} biceps femoris", "{s} semitendinosus", "{s} semimembranosus"]),
    ("adduktoren", ["{s} adductor longus", "{s} adductor magnus", "{s} gracilis", "{s} pectineus"]),
    ("wade", ["medial head of {s} gastrocnemius", "lateral head of {s} gastrocnemius"]),
    ("soleus", ["{s} soleus"]),
    ("schienbein", ["{s} tibialis anterior"]),
]
# neutral, not selectable: fills the gaps so no bone shows through between the trained muscles
CONTEXT = ["{s} sternocleidomastoid", "{s} levator scapulae", "{s} splenius capitis", "{s} splenius cervicis",
           "{s} semispinalis capitis", "{s} semispinalis cervicis", "{s} semispinalis thoracis", "{s} multifidus", "{s} scalenus anterior", "{s} scalenus medius", "{s} scalenus posterior",
           "{s} omohyoid", "{s} sternohyoid", "{s} pectoralis minor", "{s} internal oblique", "{s} quadratus lumborum",
           "{s} sartorius", "{s} fibularis longus", "{s} fibularis brevis", "{s} fibularis tertius",
           "{s} extensor digitorum longus", "{s} extensor hallucis longus", "{s} plantaris", "{s} popliteus",
           "{s} tibialis posterior", "{s} flexor hallucis longus", "{s} flexor digitorum longus", "{s} calcaneal tendon",
           "{s} extensor digitorum brevis", "{s} abductor hallucis", "{s} flexor digitorum brevis",
           "{s} abductor pollicis longus", "{s} extensor pollicis brevis", "{s} extensor pollicis longus",
           "{s} extensor indicis", "{s} extensor digiti minimi", "{s} anconeus", "humeral head of {s} pronator teres",
           "{s} supinator", "{s} flexor digitorum profundus", "{s} flexor pollicis longus", "{s} pronator quadratus",
           "set of lumbricals of {s} hand", "set of dorsal interossei of {s} hand", "{s} abductor pollicis brevis",
           "{s} opponens pollicis", "abductor digiti minimi of {s} hand"]
BONE_RE = re.compile(r"\b(bone|vertebra|rib|sternum|manubrium|xiphoid|clavicle|scapula|humerus|radius|ulna|femur|patella|tibia|fibula|"
                     r"sacrum|coccyx|mandible|maxilla|phalanx|metacarpal|metatarsal|talus|calcaneus|cuboid|cuneiform|navicular|"
                     r"hamate|capitate|trapezium|trapezoid|lunate|pisiform|scaphoid|triquetral|atlas|axis|costal cartilage)\b")
BONE_SKIP = re.compile(r"ossicle|incus|malleus|stapes|sesamoid|hyoid|ethmoid|vomer|lacrimal|palatine|inferior nasal concha")

def resolve(rows):
    by_name = {name: fid for fid, name, _ in rows}
    parts, missing = [], []   # (fid, kind, group)
    for rid, pats in REGIONS:
        for p in pats:
            for s in ("right", "left"):
                fid = by_name.get(p.format(s=s))
                (parts.append((fid, "muscle", rid)) if fid else missing.append(p.format(s=s)))
    for p in CONTEXT:
        for s in ("right", "left"):
            fid = by_name.get(p.format(s=s))
            (parts.append((fid, "muscle", "ctx_muscle")) if fid else missing.append(p.format(s=s)))
    taken = {p[0] for p in parts}
    for fid, name, _ in rows:
        if fid not in taken and BONE_RE.search(name) and not BONE_SKIP.search(name) and "disk" not in name:
            parts.append((fid, "bone", "ctx_bone"))
    return parts, missing

def download(url, f):
    if not f.exists():
        f.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=120) as r:
            f.write_bytes(r.read())
    return f

def fetch(fid):
    download(RAW + f"stl/{fid}.stl", CACHE / "stl" / f"{fid}.stl")

def load_rows():
    """(fma id, English name, size) for every part that has an STL in the mirror."""
    names = download(RAW + "parts_list_e.txt", CACHE / "parts_list_e.txt").read_text(encoding="utf-8").splitlines()[1:]
    listing = CACHE / "stl_files.json"
    if not listing.exists():
        tree = json.load(urllib.request.urlopen(f"https://api.github.com/repos/{REPO}/git/trees/HEAD?recursive=1", timeout=120))
        assert not tree["truncated"], "tree listing truncated"
        files = {t["path"].rsplit("/", 1)[1][:-4]: t["size"] for t in tree["tree"]
                 if t["path"].startswith("assets/BodyParts3D_data/stl/") and t["path"].endswith(".stl")}
        listing.write_text(json.dumps(files))
    files = json.loads(listing.read_text())
    rows = [l.split("\t") for l in names]
    return [(fid, name, files[fid]) for fid, name in rows if fid in files]

def read_welded(fid):
    b = (CACHE / "stl" / f"{fid}.stl").read_bytes()
    n = struct.unpack_from("<I", b, 80)[0]
    if 84 + 50 * n != len(b):
        raise ValueError(f"{fid}: not a binary STL")
    rec = np.frombuffer(b, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]), count=n, offset=84)
    v, inv = np.unique(rec["v"].reshape(-1, 3), axis=0, return_inverse=True)
    f = inv.reshape(-1, 3)
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    return v.astype(np.float64), f   # mm, Z up

def compact(v, f):
    used, f = np.unique(f, return_inverse=True)
    return v[used], f.reshape(-1, 3)

def adjacency(n, f):
    i = np.concatenate([f[:, 0], f[:, 1], f[:, 2], f[:, 1], f[:, 2], f[:, 0]])
    j = np.concatenate([f[:, 1], f[:, 2], f[:, 0], f[:, 0], f[:, 1], f[:, 2]])
    a = coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    a.data[:] = 1.0
    return a

def taubin(v, f, iters, lam=0.5, mu=-0.53):
    """Low-pass smoothing that removes facets without shrinking the muscle."""
    a = adjacency(len(v), f)
    deg = np.asarray(a.sum(1)).ravel(); deg[deg == 0] = 1
    w = diags(1.0 / deg) @ a
    for _ in range(iters):
        v = v + lam * (w @ v - v)
        v = v + mu * (w @ v - v)
    return v

def drop_fragments(v, f, keep_share):
    """Remove loose pieces smaller than keep_share of the largest piece."""
    if len(f) == 0:
        return v, f
    _, lab = connected_components(adjacency(len(v), f), directed=False)
    fl = lab[f[:, 0]]
    counts = np.bincount(fl)
    return compact(v, f[counts[fl] >= keep_share * counts.max()])

def footprint_cut(v, f, other, below=None, cell=3.0):
    """Drop faces whose centroid projects in the x/z plane onto the other mesh's footprint
    (and, if given, lies under the line below(x))."""
    occ = {tuple(k) for k in np.floor(other[:, [0, 2]] / cell).astype(np.int64)}
    occ = {(a + i, b + j) for a, b in occ for i in (-1, 0, 1) for j in (-1, 0, 1)}
    c = v[f].mean(1)
    k = np.floor(c[:, [0, 2]] / cell).astype(np.int64)
    hit = np.array([tuple(x) in occ for x in k])
    if below is not None:
        hit &= c[:, 2] < below(c[:, 0])
    return compact(v, f[~hit])

def clean(v, f):
    """Remove zero-area faces and back-to-back duplicate faces (their normals cancel and render black)."""
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    f = f[np.linalg.norm(fn, axis=1) > 1e-6]
    _, inv, cnt = np.unique(np.sort(f, 1), axis=0, return_inverse=True, return_counts=True)
    return compact(v, f[cnt[inv.ravel()] == 1])

def drop_black_spots(pos, f):
    """On the rounded int16 positions: remove zero-area faces and faces at vertices whose face normals cancel
    (folds). Both render black. Repeats because removing faces can expose new ones."""
    v = pos.astype(np.float64)
    for _ in range(6):
        fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
        keep = np.linalg.norm(fn, axis=1) > 0
        vn = np.zeros_like(v)
        for k in range(3):
            np.add.at(vn, f[keep, k], fn[keep])
        bad = np.linalg.norm(vn, axis=1) < 1e-6
        keep &= ~bad[f].any(1)
        if keep.all():
            break
        f = f[keep]
    used, f = np.unique(f, return_inverse=True)
    return pos[used], f.reshape(-1, 3)

def sphere(n=6000):
    """Evenly spread unit directions (Fibonacci) and their triangulation, wound outward."""
    i = np.arange(n) + 0.5
    phi, th = np.arccos(1 - 2 * i / n), np.pi * (1 + 5 ** 0.5) * i
    d = np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)
    f = ConvexHull(d).simplices
    inward = np.einsum("ij,ij->i", np.cross(d[f[:, 1]] - d[f[:, 0]], d[f[:, 2]] - d[f[:, 0]]), d[f].mean(1)) < 0
    f[inward] = f[inward][:, ::-1]
    return d, f

def solid_head(meshes, names, z_floor):
    """Skull bones -> one closed smooth head without eye sockets, nose or mouth:
    the skull's convex hull, sampled along evenly spread rays from its centre."""
    skull = [m for m in meshes if m[1] == "bone" and m[3][:, 2].mean() > z_floor
             and not re.search(r"vertebra|atlas|axis", names[m[0]])]
    pts = np.concatenate([m[3] for m in skull])
    hull = ConvexHull(pts)
    c = pts[hull.vertices].mean(0)
    n, off = hull.equations[:, :3], hull.equations[:, 3]
    d, f = sphere()
    nd = d @ n.T                                        # (rays, facets)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(nd > 1e-9, -(off + n @ c) / nd, np.inf)
    v = taubin(c + d * t.min(1)[:, None], f, 10)
    print("head: merged", len(skull), "skull bones into one closed shape")
    drop = {id(m) for m in skull}
    return [m for m in meshes if id(m) not in drop] + [("head", "bone", "ctx_bone", v, f)]

def main():
    global CACHE
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--cache", type=Path, default=HERE / "cache")
    args = ap.parse_args()
    CACHE, OUT = args.cache.resolve(), args.out.resolve()   # node runs with cwd=HERE
    rows = load_rows()
    parts, missing = resolve(rows)
    print("missing:", missing)
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(fetch, [p[0] for p in parts]))
    by_name = {n: f for f, n, _ in rows}

    meshes = [(fid, kind, gid, *read_welded(fid)) for fid, kind, gid in parts]
    names = {fid: n for fid, n, _ in rows}
    meshes = solid_head(meshes, names, read_welded(by_name["fourth cervical vertebra"])[0][:, 2].mean())
    def group_verts(g): return np.concatenate([m[3] for m in meshes if m[2] == g])
    # lat aponeurosis ends on a diagonal from the iliac crest (lateral) up to T7 (midline)
    t7 = read_welded(by_name["seventh thoracic vertebra"])[0]
    x_mid, z_t7 = t7[:, 0].mean(), t7[:, 2].mean()
    z_crest = read_welded(by_name["right hip bone"])[0][:, 2].max()
    lat_line = lambda x: z_t7 - (z_t7 - z_crest) * np.minimum(np.abs(x - x_mid) / 110.0, 1.0)
    rectus, erector = group_verts("bauch"), group_verts("rueckenstrecker")
    names = {fid: n for fid, n, _ in rows}
    for i, (fid, kind, gid, v, f) in enumerate(meshes):
        n = names.get(fid, "")
        if "oblique" in n:
            v, f = footprint_cut(v, f, rectus)
        elif "latissimus" in n:
            v, f = footprint_cut(v, f, erector, lat_line)
        else:
            continue
        meshes[i] = (fid, kind, gid, *drop_fragments(v, f, 0.15))

    # simplify with meshoptimizer: one budget per kind, split by surface area (trained muscles count double)
    tmp = CACHE / "tmp"; tmp.mkdir(parents=True, exist_ok=True)
    def area(v, f): return 0.5 * np.linalg.norm(np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]]), axis=1).sum()
    weight = [area(m[3], m[4]) * (0.5 if m[2] == "ctx_muscle" else 1.0) for m in meshes]
    total = {k: sum(w for w, m in zip(weight, meshes) if m[1] == k) for k in BUDGET}
    jobs = []
    for i, (fid, kind, gid, v, f) in enumerate(meshes):
        src = tmp / f"{i}.in"; dst = tmp / f"{i}.out"
        src.write_bytes(struct.pack("<II", len(v), len(f)) + v.astype("<f4").tobytes() + f.astype("<u4").tobytes())
        jobs.append({"in": str(src), "out": str(dst), "target": max(120, int(BUDGET[kind] * weight[i] / total[kind])), "maxError": 0.02})
    (tmp / "jobs.json").write_text(json.dumps(jobs))
    subprocess.run(["node", str(HERE / "simplify.mjs"), str(tmp / "jobs.json")], check=True, cwd=HERE)

    groups = {}
    for i, (fid, kind, gid, _, _) in enumerate(meshes):
        b = (tmp / f"{i}.out").read_bytes()
        nv, nf = struct.unpack_from("<II", b)
        v = np.frombuffer(b, "<f4", nv * 3, 8).reshape(-1, 3).astype(np.float64)
        f = np.frombuffer(b, "<u4", nf * 3, 8 + nv * 12).reshape(-1, 3).astype(np.int64)
        v, f = compact(v, f)
        v, f = drop_fragments(v, f, 0.02)
        v = taubin(v, f, 12 if kind == "muscle" else 4)
        v, f = drop_fragments(*clean(v, f), 0.02)
        groups.setdefault(gid, []).append((v, f))

    # orientation: BodyParts3D is mm, Z up. Make front +Z and up +Y with a proper rotation.
    allv = np.concatenate([v for g in groups.values() for v, _ in g])
    center = (allv.max(0) + allv.min(0)) / 2
    def cen(name): return read_welded(by_name[name])[0].mean(0)
    front_is_neg_y = cen("body of sternum")[1] < cen("fifth thoracic vertebra")[1]
    def xform(v):
        v = v - center
        return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1) if front_is_neg_y else np.stack([-v[:, 0], v[:, 2], v[:, 1]], 1)
    print("right humerus x' =", round(xform(cen("right humerus")[None])[0, 0]), "(should be < 0)")

    bin_parts, manifest, off = [], [], 0
    for gid, ms in groups.items():
        vs, fs, base = [], [], 0
        for v, f in ms:
            vs.append(xform(v)); fs.append(f + base); base += len(v)
        v = np.concatenate(vs); f = np.concatenate(fs)
        pos, f = drop_black_spots(np.round(v * 10).astype(np.int16), f)   # 0.1 mm units
        v = pos
        idx = f.astype(np.uint16 if len(v) < 65536 else np.uint32)
        offs = []
        for arr in (pos, idx):
            pad = (-off) % 4
            bin_parts.append(b"\0" * pad); off += pad
            offs.append(off); bin_parts.append(arr.tobytes()); off += arr.nbytes
        manifest.append({"id": gid, "pos": [offs[0], len(v)], "idx": [offs[1], f.size, "u32" if idx.dtype == np.uint32 else "u16"]})
        print(f"{gid:16s} verts {len(v):7d} tris {len(f):7d}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "model.bin").write_bytes(b"".join(bin_parts))
    (OUT / "model.json").write_text(json.dumps({"unit": 0.0001, "parts": manifest}), encoding="utf-8")
    print("tris total", sum(m["idx"][1] // 3 for m in manifest), " bin MB", round(off / 1e6, 2))

if __name__ == "__main__":
    main()
