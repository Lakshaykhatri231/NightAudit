"""End-to-end over HTTP: login, 403 on cross-client access, full approval flow."""
import json
import threading
import urllib.error
import urllib.request

from hotelreports import config, server, synthetic
from tests.helpers import TempHomeCase

KEYS = {"anna": "hl-analyst-demo-key", "rob": "hl-reviewer-demo-key", "paul": "pc-analyst-demo-key"}


class ApiTest(TempHomeCase):
    def setUp(self):
        super().setUp()
        self.httpd = server.make_server("127.0.0.1", 0)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def call(self, method, path, body=None, key=None, headers=None, raw=False):
        h = dict(headers or {})
        data = None
        if body is not None:
            data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        if key:
            h["X-API-Key"] = KEYS[key]
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req) as res:
                payload = res.read()
                return res.status, (payload if raw else json.loads(payload)), res.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read()), e.headers

    def test_login_and_me(self):
        status, body, headers = self.call("POST", "/api/login", {"username": "anna@harbourlight", "password": "demo123"})
        self.assertEqual(status, 200)
        cookie = headers["Set-Cookie"].split(";")[0]
        status, me, _ = self.call("GET", "/api/me", headers={"Cookie": cookie})
        self.assertEqual(me["client_id"], "harbourlight")
        status, _, _ = self.call("POST", "/api/login", {"username": "anna@harbourlight", "password": "nope"})
        self.assertEqual(status, 401)

    def test_unauthenticated_is_401(self):
        self.assertEqual(self.call("GET", "/api/clients/harbourlight/reports")[0], 401)

    def test_cross_client_is_403(self):
        for path in ("/api/clients/pinecrest", "/api/clients/pinecrest/reports", "/api/clients/pinecrest/metrics",
                     "/api/clients/pinecrest/reports/1/export?format=json"):
            self.assertEqual(self.call("GET", path, key="anna")[0], 403, path)
        self.assertEqual(self.call("POST", "/api/clients/pinecrest/imports/sample", key="anna")[0], 403)
        status, clients, _ = self.call("GET", "/api/clients", key="anna")
        self.assertEqual([c["client_id"] for c in clients], ["harbourlight"])

    def test_full_flow_over_http(self):
        c = "/api/clients/harbourlight"
        status, res, _ = self.call("POST", c + "/imports/sample", key="anna")
        self.assertEqual((status, res["rows_rejected"]), (201, 3))
        status, rep, _ = self.call("POST", c + "/reports", {"period_start": "2026-10-01", "period_end": "2026-10-31"}, key="anna")
        self.assertEqual(status, 201)
        rid = rep["id"]
        self.assertEqual(self.call("GET", f"{c}/reports/{rid}/export?format=csv", key="anna")[0], 409)
        self.assertEqual(self.call("POST", f"{c}/reports/{rid}/submit", {}, key="anna")[0], 200)
        self.assertEqual(self.call("POST", f"{c}/reports/{rid}/approve", {}, key="anna")[0], 403)
        status, approved, _ = self.call("POST", f"{c}/reports/{rid}/approve", {"comment": "ok"}, key="rob")
        self.assertEqual(approved["status"], "approved")
        status, csv_bytes, headers = self.call("GET", f"{c}/reports/{rid}/export?format=csv", key="rob", raw=True)
        self.assertEqual(status, 200)
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertIn(b"approved_by,rob@harbourlight", csv_bytes)

    def test_misrouted_upload_over_http(self):
        text = synthetic.misrouted_path().read_text()
        status, body, _ = self.call("POST", "/api/clients/harbourlight/imports", text, key="anna",
                                    headers={"Content-Type": "text/csv", "X-Filename": "oops.csv"})
        self.assertEqual(status, 403)
        self.assertIn("another client", body["error"])

    def test_index_served(self):
        status, body, _ = self.call("GET", "/classic", raw=True)
        self.assertEqual(status, 200)
        self.assertIn(b"Hotel Social Reports", body)
        status, body, _ = self.call("GET", "/", raw=True)
        self.assertEqual(status, 200)
        if (config.FRONTEND_DIST / "index.html").is_file():
            self.assertIn(b'id="root"', body)
            # client-side routes fall back to the SPA shell; missing assets are a real 404
            self.assertEqual(self.call("GET", "/reports/harbourlight/1", raw=True)[1], body)
            self.assertEqual(self.call("GET", "/assets/missing.js")[0], 404)
            self.assertEqual(self.call("GET", "/../hotelreports/config.py")[0], 404)

    def test_sample_csv_is_per_client(self):
        status, body, headers = self.call("GET", "/api/clients/harbourlight/imports/sample.csv", key="anna", raw=True)
        self.assertEqual(status, 200)
        self.assertIn("text/csv", headers["Content-Type"])
        self.assertNotIn(b"pinecrest", body)
        self.assertEqual(self.call("GET", "/api/clients/pinecrest/imports/sample.csv", key="anna")[0], 403)

    def test_sample_preview_matches_import(self):
        status, prev, _ = self.call("GET", "/api/clients/harbourlight/imports/sample/preview", key="rob")
        self.assertEqual(status, 200)  # reviewers can inspect the source data too
        bad = {r["line"]: r["reason"] for r in prev["rows"] if not r["ok"]}
        self.assertEqual(len(bad), 3)
        _, imp, _ = self.call("POST", "/api/clients/harbourlight/imports/sample", key="anna")
        self.assertEqual({e["row"]: e["reason"] for e in imp["errors"]}, bad)  # same verdicts as a real import
        self.assertEqual(prev["rows_ok"], imp["rows_ok"])
        self.assertEqual(self.call("GET", "/api/clients/pinecrest/imports/sample/preview", key="rob")[0], 403)

    def test_activity_is_logged_in_own_trail(self):
        self.call("POST", "/api/login", {"username": "anna@harbourlight", "password": "demo123"})
        self.call("POST", "/api/clients/harbourlight/imports/sample", key="anna")
        self.assertEqual(self.call("GET", "/api/clients/pinecrest", key="anna")[0], 403)
        _, events, _ = self.call("GET", "/api/clients/harbourlight/audit", key="anna")
        actions = [e["action"] for e in events]
        for a in ("signed_in", "imported", "access_denied"):
            self.assertIn(a, actions)
        denied = next(e for e in events if e["action"] == "access_denied")
        self.assertIn("Pinecrest", denied["comment"])
        # the attempt is never written into the other hotel's database
        _, pc_events, _ = self.call("GET", "/api/clients/pinecrest/audit", key="paul")
        self.assertNotIn("anna@harbourlight", [e["actor"] for e in pc_events])
