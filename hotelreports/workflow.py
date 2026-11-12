"""Human approval of reports.

    draft ──submit (analyst)──▶ pending_review ──approve (reviewer)──▶ approved
                                       │
                                       └──reject (reviewer, comment required)──▶ rejected

A report with a failed accuracy check cannot be submitted, nobody may approve a
report they generated, and a report whose stored content has changed since it was
generated cannot be approved. Every step is recorded in the client's audit log.
"""
from __future__ import annotations

import json

from . import report as report_mod
from .errors import AccessDenied, Conflict, InvalidInput
from .storage import TenantRepository
from .tenancy import Principal, require_role


def submit(repo: TenantRepository, report_id: int, principal: Principal, comment: str = "") -> dict:
    require_role(principal, "analyst", "submit a report for review")
    r = repo.get_report(report_id)
    if r["status"] != "draft":
        raise Conflict(f"Only draft reports can be submitted (this one is '{r['status']}').")
    failed = [c["name"] for c in json.loads(r["payload_json"])["checks"] if c["status"] == "fail"]
    if failed:
        raise Conflict(f"Cannot submit: accuracy checks failed ({', '.join(failed)}).")
    repo.set_report_status(report_id, "pending_review")
    repo.add_event(report_id, "submitted", principal.username, comment.strip() or None)
    return report_mod.get_report(repo, report_id)


def approve(repo: TenantRepository, report_id: int, principal: Principal, comment: str = "") -> dict:
    require_role(principal, "reviewer", "approve a report")
    r = repo.get_report(report_id)
    if r["created_by"] == principal.username:
        raise AccessDenied("You cannot approve a report you generated yourself.")
    if r["status"] != "pending_review":
        raise Conflict(f"Only reports pending review can be approved (this one is '{r['status']}').")
    if not report_mod.verify_integrity(repo, report_id):
        raise Conflict("Integrity check failed: report content changed after generation. Regenerate it.")
    note = comment.strip() or None
    repo.set_report_status(report_id, "approved", reviewed_by=principal.username, comment=note)
    repo.add_event(report_id, "approved", principal.username, note)
    return report_mod.get_report(repo, report_id)


def reject(repo: TenantRepository, report_id: int, principal: Principal, comment: str) -> dict:
    require_role(principal, "reviewer", "reject a report")
    note = (comment or "").strip()
    if not note:
        raise InvalidInput("A comment explaining the rejection is required.")
    r = repo.get_report(report_id)
    if r["status"] != "pending_review":
        raise Conflict(f"Only reports pending review can be rejected (this one is '{r['status']}').")
    repo.set_report_status(report_id, "rejected", reviewed_by=principal.username, comment=note)
    repo.add_event(report_id, "rejected", principal.username, note)
    return report_mod.get_report(repo, report_id)
