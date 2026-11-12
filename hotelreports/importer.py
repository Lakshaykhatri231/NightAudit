"""Import social-media metrics (CSV, or JSON records) for one client.

- A file with missing columns or no rows is rejected.
- A file with any row for a different client_id is rejected entirely, and the
  attempt is recorded in the client's import history.
- Otherwise each row is checked. Valid rows are saved, replacing any existing row
  for the same date and platform, so importing the same file twice changes nothing.
  Invalid rows are reported with their line number and the reason.
"""
from __future__ import annotations

import csv
import io
from datetime import date

from . import config
from .errors import AccessDenied, InvalidInput
from .storage import METRIC_FIELDS, TenantRepository

REQUIRED_COLUMNS = ("date", "platform") + METRIC_FIELDS


def parse_csv(text: str) -> tuple[list[str], list[dict]]:
    text = text.lstrip("﻿")
    reader = csv.DictReader(io.StringIO(text))
    columns = [c.strip().lower() for c in (reader.fieldnames or [])]
    rows = []
    for raw in reader:
        rows.append({(k or "").strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in raw.items()})
    return columns, rows


def _parse_date(value) -> str:
    s = str(value or "").strip()
    try:
        if len(s) != 10:
            raise ValueError
        return date.fromisoformat(s).isoformat()
    except ValueError:
        raise ValueError(f"invalid date '{s}' (expected YYYY-MM-DD)")


def _parse_count(field, value) -> int:
    s = str(value if value is not None else "").strip()
    try:
        n = int(s)
    except ValueError:
        raise ValueError(f"{field} must be a whole number (got '{s}')")
    if n < 0:
        raise ValueError(f"{field} cannot be negative (got {n})")
    return n


def validate_row(raw: dict) -> dict:
    row = {"date": _parse_date(raw.get("date"))}
    platform = str(raw.get("platform") or "").strip().lower()
    if platform not in config.PLATFORMS:
        raise ValueError(f"unknown platform '{platform}' (allowed: {', '.join(config.PLATFORMS)})")
    row["platform"] = platform
    for f in METRIC_FIELDS:
        row[f] = _parse_count(f, raw.get(f))
    if row["reach"] > row["impressions"]:
        raise ValueError(f"reach ({row['reach']}) cannot exceed impressions ({row['impressions']})")
    engagements = row["likes"] + row["comments"] + row["shares"] + row["saves"]
    if engagements > row["impressions"]:
        raise ValueError(f"engagements ({engagements}) cannot exceed impressions ({row['impressions']})")
    if row["link_clicks"] > row["impressions"]:
        raise ValueError(f"link_clicks ({row['link_clicks']}) cannot exceed impressions")
    return row


def check_rows(records: list[dict]) -> list[dict]:
    """Check every record with the import rules, without saving anything.

    Returns one entry per record: {line, ok, row, reason}.
    """
    out, seen = [], set()
    for i, raw in enumerate(records):
        line = i + 2  # header is line 1
        try:
            row = validate_row(raw)
            key = (row["date"], row["platform"])
            if key in seen:
                raise ValueError(f"duplicate row for {key[0]} / {key[1]} in this file")
            seen.add(key)
            out.append({"line": line, "ok": True, "row": row, "reason": None})
        except ValueError as e:
            out.append({"line": line, "ok": False, "row": None, "reason": str(e)})
    return out


def import_records(repo: TenantRepository, columns: list[str], records: list[dict],
                   filename: str, actor: str) -> dict:
    client_id = repo.client_id
    missing = [c for c in REQUIRED_COLUMNS if c not in columns]
    if missing:
        raise InvalidInput(f"File is missing required columns: {', '.join(missing)}")
    if not records:
        raise InvalidInput("File contains no data rows")

    # A file containing another client's rows was sent to the wrong place: refuse all of it.
    foreign = sorted({str(r.get("client_id")).strip() for r in records
                      if r.get("client_id") and str(r.get("client_id")).strip() != client_id})
    if foreign:
        msg = (f"File rejected: it contains rows for another client ({', '.join(foreign)}). "
               f"Nothing was imported into {config.CLIENTS[client_id]['name']}.")
        repo.create_import(filename, "rejected_wrong_client", len(records), 0, len(records),
                           [{"row": None, "reason": msg}], actor)
        raise AccessDenied(msg)

    checked = check_rows(records)
    valid = [c["row"] for c in checked if c["ok"]]
    errors = [{"row": c["line"], "reason": c["reason"]} for c in checked if not c["ok"]]

    status = "imported" if not errors else ("imported_with_rejections" if valid else "rejected")
    import_id = repo.create_import(filename, status, len(records), len(valid), len(errors), errors, actor)
    if valid:
        repo.upsert_metrics(valid, import_id)
    dates = sorted(r["date"] for r in valid)
    return {
        "import_id": import_id,
        "client_id": client_id,
        "filename": filename,
        "status": status,
        "rows_total": len(records),
        "rows_ok": len(valid),
        "rows_rejected": len(errors),
        "errors": errors,
        "date_range": {"start": dates[0], "end": dates[-1]} if dates else None,
    }


def import_csv(repo: TenantRepository, text: str, filename: str, actor: str) -> dict:
    columns, rows = parse_csv(text)
    return import_records(repo, columns, rows, filename, actor)


def import_json(repo: TenantRepository, records: list, filename: str, actor: str) -> dict:
    if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
        raise InvalidInput("JSON import must be a list of objects")
    records = [{str(k).lower(): v for k, v in r.items()} for r in records]
    columns = sorted({k for r in records for k in r})
    return import_records(repo, columns, records, filename, actor)
