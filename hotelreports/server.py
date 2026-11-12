"""HTTP server for the JSON API and the web UI, built on the standard library.

Callers sign in with a session cookie (from POST /api/login) or an X-API-Key header.
Every client route is /api/clients/{client_id}/... and calls tenancy.repo_for(),
which answers 403 unless the caller works for that client.
"""
from __future__ import annotations

import json
import logging
import mimetypes
import re
import traceback
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

from . import config, exporters, importer, synthetic, tenancy, workflow
from . import report as report_mod
from .errors import AppError, InvalidInput, NotFound, Unauthorized
from .storage import TenantRepository

log = logging.getLogger("hotelreports.http")
SESSIONS = tenancy.SessionStore()
COOKIE = "hr_session"

ROUTES = []  # (method, compiled path pattern, handler function)


def route(method, pattern):
    """Register the decorated function as the handler for `method` + `pattern`."""
    def deco(fn):
        ROUTES.append((method, re.compile(f"^{pattern}$"), fn))
        return fn
    return deco


CID = r"/api/clients/(?P<cid>[a-z0-9_-]+)"
RID = CID + r"/reports/(?P<rid>\d+)"


class Request:
    """What a route function gets: query parameters, raw body and the signed-in user (or None)."""

    def __init__(self, handler, query, body, principal):
        self.handler, self.query, self.body, self.principal = handler, query, body, principal

    def json(self) -> dict:
        if not self.body:
            return {}
        try:
            data = json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise InvalidInput("Request body must be valid JSON")
        if not isinstance(data, (dict, list)):
            raise InvalidInput("Request body must be a JSON object")
        return data

    def need_auth(self) -> tenancy.Principal:
        if self.principal is None:
            raise Unauthorized("Please sign in (or send an X-API-Key header).")
        return self.principal


# Sign-in
@route("POST", "/api/login")
def login(req):
    data = req.json()
    principal = tenancy.authenticate(data.get("username", ""), data.get("password", ""))
    token = SESSIONS.create(principal)
    TenantRepository(principal.client_id).add_event(None, "signed_in", principal.username, principal.role.title())
    cookie = f"{COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={config.SESSION_TTL_SECONDS}"
    return 200, principal.to_dict(), {"Set-Cookie": cookie}


@route("POST", "/api/logout")
def logout(req):
    p = SESSIONS.get(req.handler.session_token())
    if p is not None:
        TenantRepository(p.client_id).add_event(None, "signed_out", p.username)
    SESSIONS.delete(req.handler.session_token())
    return 200, {"ok": True}, {"Set-Cookie": f"{COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"}


@route("GET", "/api/me")
def me(req):
    return 200, req.need_auth().to_dict()


@route("GET", "/api/health")
def health(req):
    return 200, {"ok": True}


# Clients
@route("GET", "/api/clients")
def list_clients(req):
    p = req.need_auth()
    c = config.CLIENTS[p.client_id]
    return 200, [{"client_id": p.client_id, **c}]  # only the caller's own client is visible


@route("GET", CID)
def client_overview(req, cid):
    p = req.need_auth()
    repo = tenancy.repo_for(p, cid)
    reports = repo.list_reports()
    counts = {}
    for r in reports:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return 200, {"client_id": cid, **config.CLIENTS[cid], "data_range": repo.data_range(),
                 "report_counts": counts, "imports": len(repo.list_imports())}


# Imports
@route("POST", CID + "/imports")
def create_import(req, cid):
    p = req.need_auth()
    repo = tenancy.repo_for(p, cid)
    tenancy.require_role(p, "analyst", "import data")
    filename = req.handler.headers.get("X-Filename", "upload.csv")[:200]
    ctype = (req.handler.headers.get("Content-Type") or "").lower()
    if not req.body:
        raise InvalidInput("Empty upload")
    if "json" in ctype:
        result = importer.import_json(repo, req.json(), filename, p.username)
    else:
        try:
            text = req.body.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise InvalidInput("CSV must be UTF-8 encoded")
        result = importer.import_csv(repo, text, filename, p.username)
    _log_import(repo, p, result)
    return 201, result


def _log_import(repo, p, result):
    repo.add_event(None, "imported", p.username,
                   f"{result['filename']}: {result['rows_ok']} accepted, {result['rows_rejected']} rejected")


@route("POST", CID + "/imports/sample")
def import_sample(req, cid):
    p = req.need_auth()
    repo = tenancy.repo_for(p, cid)
    tenancy.require_role(p, "analyst", "import data")
    result = importer.import_csv(repo, synthetic.sample_csv(cid), f"{cid}/metrics.csv (sample)", p.username)
    _log_import(repo, p, result)
    return 201, result


@route("GET", CID + "/imports/sample.csv")
def sample_csv(req, cid):
    tenancy.repo_for(req.need_auth(), cid)  # checks access; the file comes from data/samples
    headers = {"Content-Disposition": f'attachment; filename="{cid}_metrics_sample.csv"'}
    return 200, ("text/csv; charset=utf-8", synthetic.sample_csv(cid).encode()), headers


@route("GET", CID + "/imports/sample/preview")
def sample_preview(req, cid):
    """The hotel's sample file row by row, with the import verdict for each row.

    Nothing is stored. Lets anyone at the hotel check the report against its source data.
    """
    tenancy.repo_for(req.need_auth(), cid)
    columns, records = importer.parse_csv(synthetic.sample_csv(cid))
    checked = importer.check_rows(records)
    rows = [{"line": c["line"], "ok": c["ok"], "reason": c["reason"], "values": rec}
            for c, rec in zip(checked, records)]
    ok = sum(c["ok"] for c in checked)
    return 200, {"filename": f"{cid}_metrics_sample.csv", "columns": columns, "rows": rows,
                 "rows_total": len(rows), "rows_ok": ok, "rows_rejected": len(rows) - ok}


@route("GET", CID + "/imports")
def list_imports(req, cid):
    return 200, tenancy.repo_for(req.need_auth(), cid).list_imports()


@route("GET", CID + "/metrics")
def get_metrics(req, cid):
    repo = tenancy.repo_for(req.need_auth(), cid)
    start, end = req.query.get("start"), req.query.get("end")
    if not start or not end:
        return 200, {"data_range": repo.data_range()}
    return 200, {"rows": repo.get_metrics(start, end)}


# Reports
@route("POST", CID + "/reports")
def create_report(req, cid):
    p = req.need_auth()
    repo = tenancy.repo_for(p, cid)
    tenancy.require_role(p, "analyst", "generate a report")
    data = req.json()
    return 201, report_mod.build_report(repo, data.get("period_start"), data.get("period_end"), p)


@route("GET", CID + "/reports")
def list_reports(req, cid):
    return 200, tenancy.repo_for(req.need_auth(), cid).list_reports()


@route("GET", RID)
def get_report(req, cid, rid):
    return 200, report_mod.get_report(tenancy.repo_for(req.need_auth(), cid), int(rid))


@route("POST", RID + "/(?P<action>submit|approve|reject)")
def transition(req, cid, rid, action):
    p = req.need_auth()
    repo = tenancy.repo_for(p, cid)
    comment = req.json().get("comment", "") or ""
    fn = {"submit": workflow.submit, "approve": workflow.approve, "reject": workflow.reject}[action]
    return 200, fn(repo, int(rid), p, comment)


@route("GET", RID + "/export")
def export(req, cid, rid):
    repo = tenancy.repo_for(req.need_auth(), cid)
    fmt = req.query.get("format", "html")
    preview = req.query.get("preview") == "1"
    filename, ctype, data, _ = exporters.export_report(repo, int(rid), fmt, draft_preview=preview)
    disposition = "inline" if (preview or req.query.get("inline") == "1") else "attachment"
    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename)}"}
    return 200, (ctype, data), headers


@route("GET", CID + "/audit")
def audit(req, cid):
    return 200, tenancy.repo_for(req.need_auth(), cid).list_events()


class Handler(BaseHTTPRequestHandler):
    server_version = "HotelReports/1.0"

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    def session_token(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        jar = cookies.SimpleCookie()
        try:
            jar.load(raw)
        except cookies.CookieError:
            return None
        return jar[COOKIE].value if COOKIE in jar else None

    def _principal(self):
        key = self.headers.get("X-API-Key")
        if key:
            return tenancy.principal_from_api_key(key)
        return SESSIONS.get(self.session_token())

    def _send(self, status, body, headers=None):
        if isinstance(body, tuple):
            ctype, data = body
        else:
            ctype, data = "application/json; charset=utf-8", json.dumps(body, indent=1).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _serve_static(self, path):
        # The older single-file UI stays available at /classic.
        if path in ("/classic", "/classic/index.html"):
            return self._send(200, ("text/html; charset=utf-8", (config.WEB_DIR / "index.html").read_bytes()))
        dist = config.FRONTEND_DIST
        if not (dist / "index.html").is_file():  # frontend not built: fall back to the classic UI
            if path in ("/", "/index.html"):
                return self._serve_static("/classic")
            return self._send(404, {"error": "Not found"})
        target = (dist / path.lstrip("/")).resolve()
        if target.is_file() and dist.resolve() in target.parents:
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
                ctype += "; charset=utf-8"
            return self._send(200, (ctype, target.read_bytes()))
        if "." in path.rsplit("/", 1)[-1]:  # a missing asset, not an app route
            return self._send(404, {"error": "Not found"})
        # Client-side routes (/hotels/..., /reports/..., /review, /audit) all load the SPA shell.
        return self._send(200, ("text/html; charset=utf-8", (dist / "index.html").read_bytes()))

    def _dispatch(self, method):
        url = urlparse(self.path)
        path = url.path.rstrip("/") or "/"
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > config.MAX_UPLOAD_BYTES:
                raise InvalidInput("Upload too large (max 5 MB)")
            body = self.rfile.read(length) if length else b""
            if method == "GET" and not path.startswith("/api/"):
                return self._serve_static(path)
            principal = self._principal()
            for m, rx, fn in ROUTES:
                match = rx.match(path)
                if match and m == method:
                    result = fn(Request(self, query, body, principal), **match.groupdict())
                    return self._send(*result)
            raise NotFound(f"No route for {method} {path}")
        except AppError as e:
            payload = {"error": e.message}
            if e.details is not None:
                payload["details"] = e.details
            return self._send(e.status, payload)
        except Exception:  # an unexpected bug: log it, don't leak details to the caller
            log.error("Unhandled error:\n%s", traceback.format_exc())
            return self._send(500, {"error": "Internal server error"})

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")


def make_server(host="127.0.0.1", port=8000) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    return httpd
