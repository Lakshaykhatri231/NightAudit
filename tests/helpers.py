"""Shared test setup: every test case gets its own temporary HOTELREPORTS_HOME."""
import os
import shutil
import tempfile
import unittest

from hotelreports import synthetic, tenancy


class TempHomeCase(unittest.TestCase):
    def setUp(self):
        self._old = os.environ.get("HOTELREPORTS_HOME")
        self.home = tempfile.mkdtemp(prefix="hotelreports-test-")
        os.environ["HOTELREPORTS_HOME"] = self.home
        synthetic.write_samples()
        self.anna = tenancy.principal_for("anna@harbourlight")
        self.rob = tenancy.principal_for("rob@harbourlight")
        self.paul = tenancy.principal_for("paul@pinecrest")
        self.rita = tenancy.principal_for("rita@pinecrest")

    def tearDown(self):
        if self._old is None:
            os.environ.pop("HOTELREPORTS_HOME", None)
        else:
            os.environ["HOTELREPORTS_HOME"] = self._old
        shutil.rmtree(self.home, ignore_errors=True)


ROW = {"followers": 1000, "impressions": 1000, "reach": 500, "likes": 40, "comments": 5, "shares": 3,
       "saves": 2, "link_clicks": 10, "posts": 1, "website_bookings_attributed": 1}


def row(d, platform, **kw):
    return {"date": d, "platform": platform, **ROW, **kw}
