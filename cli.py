"""Command-line interface for scripted use and demo preparation.

  python3 cli.py generate-data                 # (re)write synthetic CSVs to data/samples/
  python3 cli.py reset [--empty]               # wipe DBs + exports; pre-seed Pinecrest (unless --empty)
  python3 cli.py import <client> <file.csv> --user anna@harbourlight
  python3 cli.py report <client> --start 2026-10-01 --end 2026-10-31 --user anna@harbourlight
  python3 cli.py submit  <client> <report_id> --user anna@harbourlight
  python3 cli.py approve <client> <report_id> --user rob@harbourlight [--comment "..."]
  python3 cli.py reject  <client> <report_id> --user rob@harbourlight --comment "..."
  python3 cli.py export  <client> <report_id> --format html|csv|json --user rob@harbourlight
  python3 cli.py list    <client> --user anna@harbourlight
  python3 cli.py demo                          # full flow for both clients

The CLI acts *as* a named demo user, so the same isolation and role rules apply.
"""
import argparse
import shutil
import sys
from pathlib import Path

from hotelreports import config, exporters, importer, synthetic, tenancy, workflow
from hotelreports import report as report_mod
from hotelreports.errors import AppError

DEFAULT_USERS = {
    "harbourlight": ("anna@harbourlight", "rob@harbourlight"),
    "pinecrest": ("paul@pinecrest", "rita@pinecrest"),
}


def _user_and_repo(username, client):
    p = tenancy.principal_for(username)
    return p, tenancy.repo_for(p, client)


def cmd_generate(_):
    for path in synthetic.write_samples():
        print("wrote", path.relative_to(config.home()))


def _wipe():
    for d in (config.tenants_dir(), config.exports_dir()):
        if d.exists():
            shutil.rmtree(d)
    config.exports_dir().mkdir(parents=True, exist_ok=True)


def _full_flow(client, start, end, comment, export=True, quiet=False):
    """Import the sample, generate a report, submit and approve it, then optionally export."""
    analyst, reviewer = (tenancy.principal_for(u) for u in DEFAULT_USERS[client])
    repo = tenancy.repo_for(analyst, client)
    res = importer.import_csv(repo, synthetic.sample_csv(client), f"{client}/metrics.csv (sample)", analyst.username)
    rep = report_mod.build_report(repo, start, end, analyst)
    workflow.submit(repo, rep["id"], analyst)
    workflow.approve(repo, rep["id"], reviewer, comment)
    paths = [exporters.export_report(repo, rep["id"], f)[3] for f in ("html", "csv", "json")] if export else []
    if not quiet:
        print(f"\n== {config.CLIENTS[client]['name']} ==")
        print(f"import: {res['rows_ok']} rows ok, {res['rows_rejected']} rejected")
        for e in res["errors"]:
            print(f"   line {e['row']}: {e['reason']}")
        print(f"report #{rep['id']} {rep['payload']['period']['label']}: approved by {reviewer.name}")
        for line in rep["payload"]["narrative"]:
            print("  •", line)
        for c in rep["payload"]["checks"]:
            print(f"  [{c['status']}] {c['name']}")
        for p in paths:
            print("  exported", p.relative_to(config.home()))
    return rep


def cmd_reset(args):
    _wipe()
    synthetic.write_samples()
    print("Cleared client databases and exports; regenerated sample data.")
    if not args.empty:
        _full_flow("pinecrest", "2026-10-01", "2026-10-31", "Approved for client send-out.", export=False, quiet=True)
        print("Pre-seeded Pinecrest: data imported + approved October 2026 report.")
    print("Harbourlight is empty and ready for the live demo.")


def cmd_demo(_):
    _wipe()
    synthetic.write_samples()
    _full_flow("harbourlight", "2026-10-01", "2026-10-31", "Figures checked against source. OK to send.")
    _full_flow("pinecrest", "2026-10-01", "2026-10-31", "Approved for client send-out.")
    # Show that one client's user cannot touch the other client's data.
    anna = tenancy.principal_for("anna@harbourlight")
    try:
        tenancy.repo_for(anna, "pinecrest")
    except AppError as e:
        print(f"\nIsolation check: Harbourlight analyst -> Pinecrest data: DENIED ({e.message})")
    try:
        importer.import_csv(tenancy.repo_for(anna, "harbourlight"),
                            synthetic.misrouted_path().read_text(), "misrouted.csv", anna.username)
    except AppError as e:
        print(f"Isolation check: Pinecrest rows uploaded into Harbourlight: REJECTED ({e.message})")


def cmd_import(args):
    p, repo = _user_and_repo(args.user, args.client)
    tenancy.require_role(p, "analyst", "import data")
    path = Path(args.file)
    res = importer.import_csv(repo, path.read_text(encoding="utf-8-sig"), path.name, p.username)
    print(f"{res['status']}: {res['rows_ok']} ok, {res['rows_rejected']} rejected")
    for e in res["errors"]:
        print(f"  line {e['row']}: {e['reason']}")


def cmd_report(args):
    p, repo = _user_and_repo(args.user, args.client)
    tenancy.require_role(p, "analyst", "generate a report")
    rep = report_mod.build_report(repo, args.start, args.end, p)
    print(f"report #{rep['id']} created (draft)")
    for line in rep["payload"]["narrative"]:
        print("  •", line)
    for c in rep["payload"]["checks"]:
        print(f"  [{c['status']}] {c['name']}: {c['detail']}")


def cmd_transition(args):
    p, repo = _user_and_repo(args.user, args.client)
    fn = {"submit": workflow.submit, "approve": workflow.approve, "reject": workflow.reject}[args.cmd]
    rep = fn(repo, args.report_id, p, args.comment or "")
    print(f"report #{rep['id']} is now {rep['status']}")


def cmd_export(args):
    _, repo = _user_and_repo(args.user, args.client)
    _, _, _, path = exporters.export_report(repo, args.report_id, args.format)
    print("exported", path)


def cmd_list(args):
    _, repo = _user_and_repo(args.user, args.client)
    for r in repo.list_reports():
        print(f"#{r['id']}  {r['period_start']}..{r['period_end']}  {r['status']:<15} by {r['created_by']}"
              + (f"  reviewed by {r['reviewed_by']}" if r["reviewed_by"] else ""))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("generate-data").set_defaults(fn=cmd_generate)
    r = sub.add_parser("reset")
    r.add_argument("--empty", action="store_true", help="do not pre-seed Pinecrest")
    r.set_defaults(fn=cmd_reset)
    sub.add_parser("demo").set_defaults(fn=cmd_demo)

    def with_user(p):
        p.add_argument("client", choices=list(config.CLIENTS))
        p.add_argument("--user", required=True, choices=list(config.USERS))
        return p

    i = with_user(sub.add_parser("import"))
    i.add_argument("file")
    i.set_defaults(fn=cmd_import)
    rp = with_user(sub.add_parser("report"))
    rp.add_argument("--start", required=True)
    rp.add_argument("--end", required=True)
    rp.set_defaults(fn=cmd_report)
    for name in ("submit", "approve", "reject"):
        t = with_user(sub.add_parser(name))
        t.add_argument("report_id", type=int)
        t.add_argument("--comment", default="")
        t.set_defaults(fn=cmd_transition)
    ex = with_user(sub.add_parser("export"))
    ex.add_argument("report_id", type=int)
    ex.add_argument("--format", default="html", choices=list(exporters.FORMATS))
    ex.set_defaults(fn=cmd_export)
    ls = with_user(sub.add_parser("list"))
    ls.set_defaults(fn=cmd_list)

    args = ap.parse_args(argv)
    try:
        args.fn(args)
    except AppError as e:
        print(f"error: {e.message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
