"""SQLite storage, one database file per client.

A TenantRepository opens exactly one client's file, so no query can ever return
another client's rows. Each file also records which client it belongs to, and that
is checked on open to catch a copied or swapped file.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config
from .errors import AccessDenied, NotFound

METRIC_FIELDS = (
    "followers", "impressions", "reach", "likes", "comments", "shares", "saves",
    "link_clicks", "posts", "website_bookings_attributed",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS tenant_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metrics (
    date TEXT NOT NULL,
    platform TEXT NOT NULL,
    followers INTEGER NOT NULL,
    impressions INTEGER NOT NULL,
    reach INTEGER NOT NULL,
    likes INTEGER NOT NULL,
    comments INTEGER NOT NULL,
    shares INTEGER NOT NULL,
    saves INTEGER NOT NULL,
    link_clicks INTEGER NOT NULL,
    posts INTEGER NOT NULL,
    website_bookings_attributed INTEGER NOT NULL,
    import_id INTEGER,
    PRIMARY KEY (date, platform)
);
CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    status TEXT NOT NULL,
    rows_total INTEGER NOT NULL,
    rows_ok INTEGER NOT NULL,
    rows_rejected INTEGER NOT NULL,
    errors_json TEXT NOT NULL,
    imported_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_comment TEXT
);
CREATE TABLE IF NOT EXISTS review_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    comment TEXT,
    at TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class TenantRepository:
    """Reads and writes the data of one client."""

    def __init__(self, client_id: str):
        if client_id not in config.CLIENTS:
            raise NotFound(f"Unknown client '{client_id}'")
        self.client_id = client_id
        self.path = config.tenants_dir() / f"{client_id}.db"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn:  # commits on success, rolls back on exception
                yield conn
        finally:
            conn.close()

    def _init_db(self):
        with self._conn() as conn:
            conn.executescript(SCHEMA)
            row = conn.execute("SELECT value FROM tenant_meta WHERE key='client_id'").fetchone()
            if row is None:
                conn.execute("INSERT INTO tenant_meta(key, value) VALUES ('client_id', ?)", (self.client_id,))
            elif row["value"] != self.client_id:
                raise AccessDenied(
                    f"Database file {self.path.name} belongs to '{row['value']}', not '{self.client_id}'"
                )

    # Metrics
    def upsert_metrics(self, rows: list[dict], import_id: int) -> int:
        cols = ("date", "platform") + METRIC_FIELDS + ("import_id",)
        placeholders = ",".join("?" for _ in cols)
        updates = ",".join(f"{c}=excluded.{c}" for c in cols[2:])
        sql = (f"INSERT INTO metrics ({','.join(cols)}) VALUES ({placeholders}) "
               f"ON CONFLICT(date, platform) DO UPDATE SET {updates}")
        with self._conn() as conn:
            conn.executemany(sql, [tuple(r[c] for c in cols[:-1]) + (import_id,) for r in rows])
        return len(rows)

    def get_metrics(self, start: str, end: str) -> list[dict]:
        with self._conn() as conn:
            cur = conn.execute(
                "SELECT * FROM metrics WHERE date BETWEEN ? AND ? ORDER BY date, platform", (start, end))
            return [dict(r) for r in cur.fetchall()]

    def data_range(self) -> dict:
        with self._conn() as conn:
            r = conn.execute("SELECT MIN(date) AS start, MAX(date) AS end, COUNT(*) AS rows FROM metrics").fetchone()
            return dict(r)

    def sql_totals(self, start: str, end: str) -> dict:
        """The same totals summed by SQLite, used to double-check the Python maths."""
        sums = ", ".join(f"COALESCE(SUM({f}),0) AS {f}" for f in METRIC_FIELDS if f != "followers")
        with self._conn() as conn:
            r = conn.execute(f"SELECT COUNT(*) AS row_count, {sums} FROM metrics WHERE date BETWEEN ? AND ?",
                             (start, end)).fetchone()
            return dict(r)

    # Imports
    def create_import(self, filename, status, rows_total, rows_ok, rows_rejected, errors, imported_by) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO imports(filename,status,rows_total,rows_ok,rows_rejected,errors_json,imported_by,created_at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (filename, status, rows_total, rows_ok, rows_rejected, json.dumps(errors), imported_by, now_iso()))
            return cur.lastrowid

    def list_imports(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM imports ORDER BY id DESC").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["errors"] = json.loads(d.pop("errors_json"))
            out.append(d)
        return out

    # Reports
    def create_report(self, period_start, period_end, payload_json, content_hash, created_by) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO reports(period_start,period_end,status,payload_json,content_hash,created_by,created_at)"
                " VALUES (?,?,'draft',?,?,?,?)",
                (period_start, period_end, payload_json, content_hash, created_by, now_iso()))
            return cur.lastrowid

    def get_report(self, report_id: int) -> dict:
        with self._conn() as conn:
            r = conn.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone()
        if r is None:
            raise NotFound(f"Report {report_id} not found for client '{self.client_id}'")
        return dict(r)

    def list_reports(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id,period_start,period_end,status,content_hash,created_by,created_at,"
                "reviewed_by,reviewed_at,review_comment FROM reports ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]

    def set_report_status(self, report_id, status, reviewed_by=None, comment=None):
        with self._conn() as conn:
            if reviewed_by:
                conn.execute(
                    "UPDATE reports SET status=?, reviewed_by=?, reviewed_at=?, review_comment=? WHERE id=?",
                    (status, reviewed_by, now_iso(), comment, report_id))
            else:
                conn.execute("UPDATE reports SET status=? WHERE id=?", (status, report_id))

    # Audit log
    def add_event(self, report_id, action, actor, comment=None):
        with self._conn() as conn:
            conn.execute("INSERT INTO review_events(report_id,action,actor,comment,at) VALUES (?,?,?,?,?)",
                         (report_id, action, actor, comment, now_iso()))

    def list_events(self, report_id=None) -> list[dict]:
        with self._conn() as conn:
            if report_id is None:
                rows = conn.execute("SELECT * FROM review_events ORDER BY id DESC").fetchall()
            else:
                rows = conn.execute("SELECT * FROM review_events WHERE report_id=? ORDER BY id DESC",
                                    (report_id,)).fetchall()
        return [dict(r) for r in rows]
