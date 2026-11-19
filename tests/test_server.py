import http.client, json, shutil, sqlite3, sys, tempfile, threading, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402


class ServerCase(unittest.TestCase):
    """Starts the real server on a free port with a throwaway data dir."""

    @classmethod
    def setUpClass(cls):
        cls.data_dir = Path(tempfile.mkdtemp(prefix="hc-test-"))
        server.set_password(cls.data_dir, "test-pw")
        cls.httpd = server.make_server(("127.0.0.1", 0), cls.data_dir)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        shutil.rmtree(cls.data_dir, ignore_errors=True)

    def request(self, method, path, body=None, headers={}, cookie=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = dict(headers)
        if cookie:
            h["Cookie"] = f"hc_session={cookie}"
        conn.request(method, path, body=body, headers=h)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, r.headers, data

    def get(self, path, headers={}):
        return self.request("GET", path, headers=headers)

    def post(self, path, body, headers={}, cookie=None):
        h = {"Content-Type": "application/json", **headers}
        if isinstance(body, dict):
            body = json.dumps(body).encode()
        return self.request("POST", path, body, h, cookie)

    def db(self, sql):
        with sqlite3.connect(self.data_dir / "healthcore.db") as c:
            c.execute(sql)

    def setUp(self):
        self.db("DELETE FROM login_fails")

    def login(self):
        s, h, _ = self.post("/healthcore/api/login", {"password": "test-pw"}, {"X-Forwarded-For": "10.9.9.9"})
        self.assertEqual(s, 204)
        return h["Set-Cookie"].split(";")[0].split("=", 1)[1]

    def expire_all_sessions(self):
        self.db("UPDATE auth_sessions SET expires = 0")


class StaticTests(ServerCase):
    def test_index(self):
        s, h, b = self.get("/healthcore/")
        self.assertEqual(s, 200)
        self.assertIn("text/html", h["Content-Type"])
        self.assertIn(b"<title>HealthCore", b)

    def test_redirect_without_slash(self):
        s, h, _ = self.get("/healthcore")
        self.assertEqual(s, 301)
        self.assertEqual(h["Location"], "/healthcore/")

    def test_traversal_blocked(self):
        for p in ["/healthcore/../server.py", "/healthcore/%2e%2e/server.py", "/healthcore/..%2fserver.py",
                  "/healthcore/data/../../server.py"]:
            self.assertEqual(self.get(p)[0], 404, p)

    def test_outside_prefix(self):
        self.assertEqual(self.get("/server.py")[0], 404)

    def test_sw_version_is_content_hash(self):
        # every deploy with changed files must give the service worker a new cache name
        s, h, b = self.get("/healthcore/sw.js")
        self.assertEqual(s, 200)
        self.assertNotIn(b'"hc-dev"', b)
        self.assertRegex(b.decode(), r'const VERSION = "hc-[0-9a-f]{12}";')
        self.assertEqual(h["Cache-Control"], "no-cache")

    def test_types(self):
        # manifest and binary model need explicit types
        self.assertEqual(self.get("/healthcore/manifest.webmanifest")[1]["Content-Type"], "application/manifest+json")
        self.assertEqual(self.get("/healthcore/data/model.bin")[1]["Content-Type"], "application/octet-stream")


class AuthTests(ServerCase):
    def test_wrong_password(self):
        self.assertEqual(self.post("/healthcore/api/login", {"password": "nope"}, {"X-Forwarded-For": "10.0.0.9"})[0], 401)

    def test_login_sets_cookie(self):
        s, h, _ = self.post("/healthcore/api/login", {"password": "test-pw"})
        self.assertEqual(s, 204)
        c = h["Set-Cookie"]
        for part in ["hc_session=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/healthcore/", "Max-Age=15552000"]:
            self.assertIn(part, c)

    def test_rate_limit_per_ip(self):
        bad = {"X-Forwarded-For": "10.0.0.1"}
        for _ in range(5):
            self.post("/healthcore/api/login", {"password": "x"}, bad)
        self.assertEqual(self.post("/healthcore/api/login", {"password": "test-pw"}, bad)[0], 429)
        self.assertEqual(self.post("/healthcore/api/login", {"password": "test-pw"}, {"X-Forwarded-For": "10.0.0.2"})[0], 204)

    def test_api_needs_session(self):
        self.assertEqual(self.post("/healthcore/api/sync", {"since": 0, "changes": []})[0], 401)

    def test_logout_invalidates(self):
        cookie = self.login()
        self.post("/healthcore/api/logout", {}, cookie=cookie)
        self.assertEqual(self.post("/healthcore/api/sync", {"since": 0, "changes": []}, cookie=cookie)[0], 401)

    def test_expired_session(self):  # Review Focus 5
        cookie = self.login()
        self.expire_all_sessions()
        self.assertEqual(self.post("/healthcore/api/sync", {"since": 0, "changes": []}, cookie=cookie)[0], 401)

    def test_json_only(self):
        s = self.post("/healthcore/api/login", b"password=x", {"Content-Type": "application/x-www-form-urlencoded"})[0]
        self.assertEqual(s, 415)

    def test_body_limit(self):
        self.assertEqual(self.post("/healthcore/api/login", b"{" + b" " * (5 * 1024 * 1024 + 1) + b"}")[0], 413)

    def test_new_password_revokes_sessions(self):
        cookie = self.login()
        server.set_password(self.data_dir, "test-pw")
        self.assertEqual(self.post("/healthcore/api/sync", {"since": 0, "changes": []}, cookie=cookie)[0], 401)

    def test_racing_login_with_old_password_is_rejected(self):
        # a login that verified the old password but stored its session after the change
        old_salt = json.loads((self.data_dir / "auth.json").read_text())["salt"]
        server.set_password(self.data_dir, "test-pw")
        self.db(f"INSERT INTO auth_sessions VALUES ('{server.token_hash('late')}', 9999999999, '{old_salt}')")
        self.assertEqual(self.post("/healthcore/api/sync", {"since": 0, "changes": []}, cookie="late")[0], 401)

    def test_no_plaintext_password(self):
        self.assertNotIn("test-pw", (self.data_dir / "auth.json").read_text())


def doc(id, kind, data, updated_at, deleted=0):
    return {"id": id, "kind": kind, "data": data, "updated_at": updated_at, "deleted": deleted}


class SyncTests(ServerCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cookie = cls("test_roundtrip").login()

    def sync(self, since, changes):
        s, _, b = self.post("/healthcore/api/sync", {"since": since, "changes": changes}, cookie=self.cookie)
        self.assertEqual(s, 200, b)
        return json.loads(b)

    def test_roundtrip(self):
        r = self.sync(0, [doc("a", "plan", {"name": "W"}, 100)])
        self.assertGreaterEqual(r["rev"], 1)
        self.assertIn("a", [d["id"] for d in self.sync(0, [])["changes"]])

    def test_older_change_loses(self):
        self.sync(0, [doc("b", "plan", {"name": "neu"}, 200)])
        r = self.sync(0, [doc("b", "plan", {"name": "alt"}, 100)])
        self.assertEqual(next(d for d in r["changes"] if d["id"] == "b")["data"]["name"], "neu")

    def test_tombstone(self):
        self.sync(0, [doc("c", "session", {}, 100)])
        r = self.sync(0, [doc("c", "session", {}, 101, deleted=1)])
        self.assertEqual(next(d for d in r["changes"] if d["id"] == "c")["deleted"], 1)

    def test_since_filters(self):
        rev = self.sync(0, [doc("d", "plan", {}, 100)])["rev"]
        self.assertEqual(self.sync(rev, [])["changes"], [])

    def test_since_beyond_server_rev_starts_over(self):   # review I5: database restored from an older backup
        self.sync(0, [doc("f", "plan", {"name": "nach dem Backup"}, 100)])
        ids = [d["id"] for d in self.sync(10_000, [])["changes"]]
        self.assertIn("f", ids)

    def test_invalid_rejected(self):
        bad = {"id": "e", "kind": "evil", "data": {}, "updated_at": 1, "deleted": 0}
        s = self.post("/healthcore/api/sync", {"since": 0, "changes": [bad]}, cookie=self.cookie)[0]
        self.assertEqual(s, 400)


if __name__ == "__main__":
    unittest.main()
