"""KPI maths checked against hand-computed values."""
import unittest

from hotelreports import metrics
from tests.helpers import row


class MetricsTest(unittest.TestCase):
    def setUp(self):
        self.rows = [
            row("2026-10-01", "instagram", followers=1000, reach=500, likes=40, comments=5, shares=3, saves=2,
                impressions=1000, link_clicks=10),
            row("2026-10-02", "instagram", followers=1030, reach=300, likes=20, comments=4, shares=4, saves=2,
                impressions=600, link_clicks=5),
            row("2026-10-01", "facebook", followers=2000, reach=200, likes=8, comments=1, shares=1, saves=0,
                impressions=400, link_clicks=4),
            row("2026-10-02", "facebook", followers=1990, reach=200, likes=6, comments=2, shares=1, saves=1,
                impressions=400, link_clicks=2),
        ]

    def test_engagements_and_rate(self):
        o = metrics.aggregate(self.rows)
        # 50 + 30 + 10 + 10 = 100 engagements over reach 1200
        self.assertEqual(o["engagements"], 100)
        self.assertEqual(o["reach"], 1200)
        self.assertAlmostEqual(o["engagement_rate"], 100 / 1200)
        self.assertAlmostEqual(o["ctr"], 21 / 2400)

    def test_followers_are_snapshots_not_sums(self):
        f = metrics.follower_growth(self.rows)
        self.assertEqual(f["by_platform"]["instagram"]["net"], 30)
        self.assertEqual(f["by_platform"]["facebook"]["net"], -10)
        self.assertEqual((f["start"], f["end"], f["net"]), (3000, 3020, 20))

    def test_platform_breakdown_and_best(self):
        s = metrics.summarize(self.rows, "2026-10-01", "2026-10-02")
        self.assertEqual(s["by_platform"]["instagram"]["engagements"], 80)
        self.assertEqual(s["best_platform"], "instagram")  # 80/800 = 10% vs 20/400 = 5%
        self.assertEqual(s["coverage"]["missing"], {})

    def test_missing_days_detected(self):
        s = metrics.summarize(self.rows, "2026-10-01", "2026-10-03")
        self.assertEqual(s["coverage"]["missing"], {"facebook": ["2026-10-03"], "instagram": ["2026-10-03"]})

    def test_division_by_zero_is_none(self):
        o = metrics.aggregate([row("2026-10-01", "tiktok", reach=0, impressions=0, likes=0, comments=0,
                                   shares=0, saves=0, link_clicks=0)])
        self.assertIsNone(o["engagement_rate"])
        self.assertIsNone(o["ctr"])

    def test_previous_period(self):
        self.assertEqual(metrics.previous_period("2026-10-01", "2026-10-31"), ("2026-09-01", "2026-09-30"))
        self.assertEqual(metrics.previous_period("2026-10-08", "2026-10-14"), ("2026-10-01", "2026-10-07"))

    def test_compare(self):
        cur = metrics.summarize(self.rows, "2026-10-01", "2026-10-02")
        prev = metrics.summarize(self.rows[:2], "2026-10-01", "2026-10-02")
        c = metrics.compare(cur, prev)
        self.assertAlmostEqual(c["engagements"]["change"], (100 - 80) / 80)


if __name__ == "__main__":
    unittest.main()
