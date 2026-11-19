"""HealthCore server: serves the app under /healthcore/, password login and sync (standard library only).

Run:           python3 server.py [--port 8031] [--data ~/healthcore-data]
Set password:  python3 server.py --set-password [--data ~/healthcore-data]
"""
import argparse, getpass, hashlib, hmac, http.cookies, json, mimetypes, os, secrets, sqlite3, sys, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent / "app"
PREFIX = "/healthcore/"
TYPES = {".webmanifest": "application/manifest+json", ".bin": "application/octet-stream", ".mjs": "text/javascript",
         ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".css": "text/css"}
MAX_BODY = 5 * 1024 * 1024
SESSION_DAYS = 180
SESSION_SECONDS = SESSION_DAYS * 86400
FAIL_LIMIT, FAIL_WINDOW = 5, 15 * 60
SCRYPT = {"n": 16384, "r": 8, "p": 1}
COOKIE = "hc_session"
COOKIE_ATTRS = f"HttpOnly; Secure; SameSite=Strict; Path={PREFIX}"
SCHEMA = """
CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, pw TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_fails (ip TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS docs_rev ON docs(rev);
"""
KINDS = {"plan", "session", "settings"}


def valid_doc(d) -> bool:
    return (isinstance(d, dict) and isinstance(d.get("id"), str) and 0 < len(d["id"]) <= 64
            and d.get("kind") in KINDS and isinstance(d.get("data"), dict)
            and isinstance(d.get("updated_at"), int) and d.get("deleted") in (0, 1))


def content_type(f: Path) -> str:
    t = TYPES.get(f.suffix) or mimetypes.guess_type(f.name)[0] or "application/octet-stream"
    return t + "; charset=utf-8" if t.startswith("text/") else t


def scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=32)


def set_password(data_dir: Path, password: str) -> None:
    salt = secrets.token_bytes(16)
    f = Path(data_dir) / "auth.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps({"salt": salt.hex(), "hash": scrypt(password, salt, **SCRYPT).hex(), **SCRYPT}))
    os.chmod(tmp, 0o600)
    os.replace(tmp, f)   # atomic: a login never reads half a file
    db_file = Path(data_dir) / "healthcore.db"
    if db_file.exists():   # tidy up; sessions are already dead because they carry the old salt
        with sqlite3.connect(db_file, timeout=10) as c:
            c.execute("DELETE FROM auth_sessions")


def read_auth(data_dir: Path):
    f = Path(data_dir) / "auth.json"
    return json.loads(f.read_text()) if f.exists() else None


def check_password(data_dir: Path, password: str):
    """Salt of the current password if it matches, else None. Sessions store this salt, so a
    password change invalidates every session, also one created by a login racing the change."""
    a = read_auth(data_dir)
    if not a:
        return None
    got = scrypt(password, bytes.fromhex(a["salt"]), a["n"], a["r"], a["p"])
    return a["salt"] if hmac.compare_digest(got, bytes.fromhex(a["hash"])) else None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def app_hash(app_dir: Path) -> str:
    """Hash over every app file; becomes the service worker's cache name, so a deploy invalidates old caches."""
    h = hashlib.sha256()
    for f in sorted(p for p in app_dir.rglob("*") if p.is_file()):
        h.update(f.relative_to(app_dir).as_posix().encode())
        h.update(f.read_bytes())
    return h.hexdigest()[:12]


def make_server(addr, data_dir: Path, app_dir: Path = APP_DIR) -> ThreadingHTTPServer:
    app_dir = Path(app_dir).resolve()
    sw_version = f'const VERSION = "hc-{app_hash(app_dir)}";'.encode()
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    db_file = data_dir / "healthcore.db"
    with sqlite3.connect(db_file) as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)

    def db():
        return sqlite3.connect(db_file, timeout=10)

    class Handler(BaseHTTPRequestHandler):
        server_version = "HealthCore"
        refresh_token = None

        def log_message(self, fmt, *args):  # ponytail: quiet, PM2 keeps stderr for real errors
            pass

        # -- responses
        def reply(self, status, obj=None, cookie=None):
            body = b"" if obj is None else json.dumps(obj).encode()
            self.send_response(status)
            if obj is not None:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if cookie is None and self.refresh_token:
                cookie = f"{COOKIE}={self.refresh_token}; Max-Age={SESSION_SECONDS}; {COOKIE_ATTRS}"
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(body)

        def client_ip(self):
            ip = self.client_address[0]
            forwarded = self.headers.get("X-Forwarded-For")
            if ip == "127.0.0.1" and forwarded:   # only nginx on this machine may tell us the real address
                ip = forwarded.split(",")[-1].strip()
            return ip

        def read_json(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                if length <= 4 * MAX_BODY:     # drain so the client sees the status instead of a reset
                    self.rfile.read(length)
                self.reply(413)
                return None
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                body = None
            if not isinstance(body, dict):
                self.reply(400)
                return None
            return body

        def session_token(self):
            raw = http.cookies.SimpleCookie(self.headers.get("Cookie", "")).get(COOKIE)
            return raw.value if raw else None

        def session_ok(self):
            token = self.session_token()
            if not token:
                return False
            now, auth = int(time.time()), read_auth(data_dir)
            if not auth:
                return False
            with db() as c:
                cur = c.execute("UPDATE auth_sessions SET expires = ? WHERE token_hash = ? AND expires > ? AND pw = ?",
                                (now + SESSION_SECONDS, token_hash(token), now, auth["salt"]))
            if cur.rowcount:
                self.refresh_token = token
            return bool(cur.rowcount)

        # -- routes
        def login(self, body):
            ip, now = self.client_ip(), int(time.time())
            with db() as c:
                c.execute("DELETE FROM login_fails WHERE at < ?", (now - FAIL_WINDOW,))
                fails = c.execute("SELECT COUNT(*) FROM login_fails WHERE ip = ?", (ip,)).fetchone()[0]
                if fails >= FAIL_LIMIT:
                    return self.reply(429)
                salt = check_password(data_dir, str(body.get("password", "")))
                if not salt:
                    c.execute("INSERT INTO login_fails VALUES (?, ?)", (ip, now))
                    return self.reply(401)
                token = secrets.token_urlsafe(32)
                c.execute("INSERT INTO auth_sessions VALUES (?, ?, ?)", (token_hash(token), now + SESSION_SECONDS, salt))
            self.reply(204, cookie=f"{COOKIE}={token}; Max-Age={SESSION_SECONDS}; {COOKIE_ATTRS}")

        def logout(self):
            token = self.session_token()
            if token:
                with db() as c:
                    c.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash(token),))
            self.reply(204, cookie=f"{COOKIE}=; Max-Age=0; {COOKIE_ATTRS}")

        def sync(self, body):
            since, changes = body.get("since", 0), body.get("changes", [])
            if not isinstance(since, int) or not isinstance(changes, list) or not all(map(valid_doc, changes)):
                return self.reply(400)
            with db() as c:
                c.execute("BEGIN IMMEDIATE")   # rev numbers must not collide between threads
                rev = c.execute("SELECT COALESCE(MAX(rev), 0) FROM docs").fetchone()[0]
                if since > rev:   # the database was restored from an older backup: the device starts over
                    since = 0
                for d in changes:
                    row = c.execute("SELECT updated_at FROM docs WHERE id = ?", (d["id"],)).fetchone()
                    if row and d["updated_at"] <= row[0]:   # newer change wins, ties keep what is stored
                        continue
                    rev += 1
                    c.execute("INSERT INTO docs VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind,"
                              " data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, rev = excluded.rev",
                              (d["id"], d["kind"], json.dumps(d["data"]), d["updated_at"], d["deleted"], rev))
                rows = c.execute("SELECT id, kind, data, updated_at, deleted FROM docs WHERE rev > ? ORDER BY rev", (since,)).fetchall()
            out = [{"id": i, "kind": k, "data": json.loads(data), "updated_at": u, "deleted": dl} for i, k, data, u, dl in rows]
            self.reply(200, {"rev": rev, "changes": out})

        def do_POST(self):
            path = urllib.parse.urlsplit(self.path).path
            if not path.startswith(PREFIX + "api/"):
                return self.send_error(404)
            if self.headers.get_content_type() != "application/json":
                return self.reply(415)
            body = self.read_json()
            if body is None:
                return
            route = path[len(PREFIX + "api/"):]
            if route == "login":
                return self.login(body)
            if route == "logout":
                return self.logout()
            if not self.session_ok():
                return self.reply(401)
            if route == "sync":
                return self.sync(body)
            return self.reply(404)

        def do_GET(self):
            path = urllib.parse.urlsplit(self.path).path
            if path == PREFIX.rstrip("/"):
                self.send_response(301)
                self.send_header("Location", PREFIX)
                self.send_header("Content-Length", "0")
                return self.end_headers()
            if not path.startswith(PREFIX):
                return self.send_error(404)
            rel = urllib.parse.unquote(path[len(PREFIX):]) or "index.html"
            try:
                f = (app_dir / rel).resolve()
            except (ValueError, OSError):
                return self.send_error(404)
            if not f.is_relative_to(app_dir) or not f.is_file():
                return self.send_error(404)
            body = f.read_bytes()
            if f == app_dir / "sw.js":
                body = body.replace(b'const VERSION = "hc-dev";', sw_version)
            self.send_response(200)
            self.send_header("Content-Type", content_type(f))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

    return ThreadingHTTPServer(addr, Handler)


def read_new_password() -> str:
    if not sys.stdin.isatty():
        return sys.stdin.readline().rstrip("\r\n")
    first = getpass.getpass("Neues Passwort: ")
    if first != getpass.getpass("Noch einmal: "):
        sys.exit("Die Eingaben stimmen nicht überein.")
    return first


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8031)
    ap.add_argument("--data", type=Path, default=Path.home() / "healthcore-data")
    ap.add_argument("--set-password", action="store_true")
    args = ap.parse_args()
    data = args.data.expanduser()
    if args.set_password:
        password = read_new_password()
        if not password:
            sys.exit("Leeres Passwort, nichts geändert.")
        set_password(data, password)
        return print("Passwort gespeichert.")
    if not (data / "auth.json").exists():
        print("Warnung: kein Passwort gesetzt, Login ist unmöglich. Erst --set-password ausführen.", file=sys.stderr)
    httpd = make_server(("127.0.0.1", args.port), data)
    print(f"HealthCore on http://127.0.0.1:{args.port}{PREFIX}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
