"""Client data separation at every layer."""
import shutil

from hotelreports import config, importer, report, synthetic, tenancy
from hotelreports.errors import AccessDenied, NotFound
from hotelreports.storage import TenantRepository
from tests.helpers import TempHomeCase


class IsolationTest(TempHomeCase):
    def setUp(self):
        super().setUp()
        for client, user in (("harbourlight", self.anna), ("pinecrest", self.paul)):
            repo = tenancy.repo_for(user, client)
            importer.import_csv(repo, synthetic.sample_csv(client), "s.csv", user.username)

    def test_users_cannot_reach_other_client(self):
        for user, other in ((self.anna, "pinecrest"), (self.rob, "pinecrest"),
                            (self.paul, "harbourlight"), (self.rita, "harbourlight")):
            with self.assertRaises(AccessDenied):
                tenancy.repo_for(user, other)

    def test_separate_database_files(self):
        a, b = TenantRepository("harbourlight"), TenantRepository("pinecrest")
        self.assertNotEqual(a.path, b.path)
        self.assertNotEqual(a.sql_totals("2026-10-01", "2026-10-31"), b.sql_totals("2026-10-01", "2026-10-31"))

    def test_reports_contain_only_own_client_numbers(self):
        hl = report.build_report(tenancy.repo_for(self.anna, "harbourlight"), "2026-10-01", "2026-10-31", self.anna)
        pc = report.build_report(tenancy.repo_for(self.paul, "pinecrest"), "2026-10-01", "2026-10-31", self.paul)
        self.assertEqual(hl["payload"]["client_id"], "harbourlight")
        self.assertEqual(pc["payload"]["client_id"], "pinecrest")
        hl_sql = TenantRepository("harbourlight").sql_totals("2026-10-01", "2026-10-31")
        self.assertEqual(hl["payload"]["summary"]["overall"]["reach"], hl_sql["reach"])
        self.assertNotEqual(hl["payload"]["summary"]["overall"]["reach"], pc["payload"]["summary"]["overall"]["reach"])

    def test_swapped_database_file_is_detected(self):
        TenantRepository("harbourlight")
        tdir = config.tenants_dir()
        shutil.copy(tdir / "pinecrest.db", tdir / "harbourlight.db")  # simulate a mix-up on disk
        with self.assertRaises(AccessDenied):
            TenantRepository("harbourlight")

    def test_report_ids_are_scoped_per_client(self):
        report.build_report(tenancy.repo_for(self.anna, "harbourlight"), "2026-10-01", "2026-10-31", self.anna)
        # Pinecrest has no report #1: ids never point into another client's database
        with self.assertRaises(NotFound):
            TenantRepository("pinecrest").get_report(1)
