"""Approval steps, export rules and detection of changed report content."""
import sqlite3

from hotelreports import exporters, importer, report, synthetic, tenancy, workflow
from hotelreports.errors import AccessDenied, Conflict, InvalidInput
from tests.helpers import TempHomeCase


class WorkflowTest(TempHomeCase):
    def setUp(self):
        super().setUp()
        self.repo = tenancy.repo_for(self.anna, "harbourlight")
        importer.import_csv(self.repo, synthetic.sample_csv("harbourlight"), "s.csv", self.anna.username)
        self.rep = report.build_report(self.repo, "2026-10-01", "2026-10-31", self.anna)
        self.rid = self.rep["id"]

    def test_report_is_accurate_and_checks_pass(self):
        p = self.rep["payload"]
        self.assertTrue(all(c["status"] == "pass" for c in p["checks"]))
        self.assertTrue(p["previous_period"]["used"])
        self.assertEqual(self.rep["status"], "draft")

    def test_happy_path(self):
        workflow.submit(self.repo, self.rid, self.anna)
        r = workflow.approve(self.repo, self.rid, self.rob, "ok")
        self.assertEqual(r["status"], "approved")
        self.assertEqual(r["reviewed_by"], "rob@harbourlight")
        actions = [e["action"] for e in r["events"]]
        self.assertEqual(actions[::-1], ["generated", "submitted", "approved"])
        for fmt in ("html", "csv", "json"):
            name, _, data, path = exporters.export_report(self.repo, self.rid, fmt)
            self.assertTrue(path.exists())
            self.assertIn("harbourlight", str(path.parent))
        html = exporters.export_report(self.repo, self.rid, "html")[2].decode()
        self.assertIn("Approved by Rob Chen", html)
        self.assertNotIn("Pinecrest", html)

    def test_export_blocked_before_approval(self):
        with self.assertRaises(Conflict):
            exporters.export_report(self.repo, self.rid, "csv")
        workflow.submit(self.repo, self.rid, self.anna)
        with self.assertRaises(Conflict):
            exporters.export_report(self.repo, self.rid, "html")
        _, _, data, path = exporters.export_report(self.repo, self.rid, "html", draft_preview=True)
        self.assertIsNone(path)
        self.assertIn("DRAFT", data.decode())

    def test_roles_and_self_approval(self):
        workflow.submit(self.repo, self.rid, self.anna)
        with self.assertRaises(AccessDenied):
            workflow.approve(self.repo, self.rid, self.anna)  # analyst cannot approve
        with self.assertRaises(AccessDenied):
            workflow.submit(self.repo, self.rid, self.rob)  # reviewer cannot submit

    def test_cannot_approve_draft_or_twice(self):
        with self.assertRaises(Conflict):
            workflow.approve(self.repo, self.rid, self.rob)
        workflow.submit(self.repo, self.rid, self.anna)
        workflow.approve(self.repo, self.rid, self.rob)
        with self.assertRaises(Conflict):
            workflow.approve(self.repo, self.rid, self.rob)

    def test_reject_requires_comment(self):
        workflow.submit(self.repo, self.rid, self.anna)
        with self.assertRaises(InvalidInput):
            workflow.reject(self.repo, self.rid, self.rob, "  ")
        r = workflow.reject(self.repo, self.rid, self.rob, "Bookings look low, re-check source")
        self.assertEqual(r["status"], "rejected")
        with self.assertRaises(Conflict):
            exporters.export_report(self.repo, self.rid, "json")

    def test_tampering_after_generation_is_detected(self):
        workflow.submit(self.repo, self.rid, self.anna)
        with sqlite3.connect(self.repo.path) as conn:
            conn.execute("UPDATE reports SET payload_json = replace(payload_json, '\"reach\":', '\"reach\": ') WHERE id=?",
                         (self.rid,))
        with self.assertRaises(Conflict):
            workflow.approve(self.repo, self.rid, self.rob)

    def test_failed_check_blocks_submit(self):
        # Simulate a computation bug: the independent SQL totals disagree with the Python maths.
        orig = self.repo.sql_totals
        self.repo.sql_totals = lambda s, e: {**orig(s, e), "reach": 0}
        broken = report.build_report(self.repo, "2026-10-01", "2026-10-31", self.anna)
        self.repo.sql_totals = orig
        self.assertEqual(broken["payload"]["checks"][0]["status"], "fail")
        with self.assertRaises(Conflict):
            workflow.submit(self.repo, broken["id"], self.anna)

    def test_insights_are_traceable_to_the_numbers(self):
        p = self.rep["payload"]
        s, c, ins = p["summary"], p["comparison"], p["insights"]
        # headline quotes the computed engagement change and booking total
        self.assertIn(report.fmt_change(c["engagements"]["change"]).lstrip("+-"), ins["headline"])
        self.assertIn(report.fmt_int(s["overall"]["website_bookings_attributed"]), ins["headline"])
        # every "X up N%" win corresponds to a real positive change of at least 2%
        for w in ins["wins"]:
            if " up " in w:
                label = w.split(" up ")[0]
                key = next(k for k, v in report.METRIC_LABELS.items() if v == label)
                self.assertGreaterEqual(c[key]["change"], report.SIGNIFICANT)
        # the journey is the overall totals, in order
        self.assertEqual([st["value"] for st in s["funnel"]],
                         [s["overall"][k] for k in ("impressions", "reach", "engagements", "link_clicks",
                                                    "website_bookings_attributed")])
        # the best weekday really has the highest average
        wd = s["weekday"]
        best = max(wd["by_weekday"], key=lambda x: x["avg_engagements"] or 0)
        self.assertEqual(wd["best"], best["weekday"])
        # platform shares sum to 100%
        self.assertAlmostEqual(sum(a["share_of_engagements"] for a in s["by_platform"].values()), 1.0)
        self.assertEqual(len(p["checks"]), 5)

    def test_baseline_period_insights(self):
        r = report.build_report(self.repo, "2026-09-01", "2026-09-30", self.anna)
        self.assertEqual(r["payload"]["insights"]["verdict"]["label"], "Baseline period")
        self.assertIsNone(r["payload"]["previous_daily"])

    def test_incomplete_previous_period_is_not_compared(self):
        r = report.build_report(self.repo, "2026-09-01", "2026-09-30", self.anna)
        self.assertIsNone(r["payload"]["comparison"])
        self.assertFalse(r["payload"]["previous_period"]["used"])
