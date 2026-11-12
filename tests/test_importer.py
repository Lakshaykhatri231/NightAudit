"""Row validation, re-importing, and rejecting files meant for another client."""
from hotelreports import importer, synthetic, tenancy
from hotelreports.errors import AccessDenied, InvalidInput
from hotelreports.storage import TenantRepository
from tests.helpers import TempHomeCase


class ImporterTest(TempHomeCase):
    def test_sample_import_rejects_the_three_bad_rows(self):
        repo = TenantRepository("harbourlight")
        res = importer.import_csv(repo, synthetic.sample_csv("harbourlight"), "s.csv", "anna@harbourlight")
        self.assertEqual(res["rows_ok"], 61 * 3)
        self.assertEqual(res["rows_rejected"], 3)
        reasons = " | ".join(e["reason"] for e in res["errors"])
        self.assertIn("invalid date", reasons)
        self.assertIn("cannot be negative", reasons)
        self.assertIn("reach (900) cannot exceed impressions", reasons)
        self.assertEqual(repo.data_range()["rows"], 183)

    def test_reimport_does_not_duplicate_rows(self):
        repo = TenantRepository("harbourlight")
        for _ in range(2):
            importer.import_csv(repo, synthetic.sample_csv("harbourlight"), "s.csv", "anna@harbourlight")
        self.assertEqual(repo.data_range()["rows"], 183)
        self.assertEqual(len(repo.list_imports()), 2)

    def test_missing_columns_rejected(self):
        repo = TenantRepository("harbourlight")
        with self.assertRaises(InvalidInput):
            importer.import_csv(repo, "date,platform\n2026-10-01,instagram\n", "x.csv", "anna@harbourlight")

    def test_duplicate_and_unknown_platform(self):
        repo = TenantRepository("harbourlight")
        header = ",".join(importer.REQUIRED_COLUMNS)
        line = "2026-10-01,instagram,1,10,5,1,0,0,0,1,1,0"
        text = "\n".join([header, line, line, line.replace("instagram", "myspace")])
        res = importer.import_csv(repo, text, "x.csv", "anna@harbourlight")
        self.assertEqual(res["rows_ok"], 1)
        self.assertEqual([e["row"] for e in res["errors"]], [3, 4])

    def test_file_for_another_client_is_rejected_entirely(self):
        repo = tenancy.repo_for(self.anna, "harbourlight")
        text = synthetic.misrouted_path().read_text()
        with self.assertRaises(AccessDenied):
            importer.import_csv(repo, text, "wrong.csv", self.anna.username)
        self.assertEqual(repo.data_range()["rows"], 0)  # nothing stored
        self.assertEqual(repo.list_imports()[0]["status"], "rejected_wrong_client")  # attempt is logged

    def test_json_import(self):
        repo = TenantRepository("pinecrest")
        recs = synthetic.generate_rows("pinecrest")[:6]
        res = importer.import_json(repo, recs, "x.json", "paul@pinecrest")
        self.assertEqual(res["rows_ok"], 6)
