"""Deterministic synthetic social-media data for the two fictional hotels.

Each client gets one CSV of daily metrics per platform for 1 Sep - 31 Oct 2026.
A few deliberately invalid rows are appended so the import validation is visible
in the demo. Fixed integer seeds mean every run produces byte-identical files.
"""
from __future__ import annotations

import csv
import io
import random
from datetime import date, timedelta
from pathlib import Path

from . import config

START = date(2026, 9, 1)
END = date(2026, 10, 31)

COLUMNS = [
    "client_id", "date", "platform", "followers", "impressions", "reach",
    "likes", "comments", "shares", "saves", "link_clicks", "posts",
    "website_bookings_attributed",
]

# Per-platform behaviour. eng = engagement per reach, ctr = clicks per impression,
# conv = bookings per link click, growth = mean new followers per day.
PROFILES = {
    "harbourlight": {
        "seed": 1101,
        "trend": lambda d: 1.0 + 0.004 * (d - START).days,  # steady growth
        "platforms": {
            "instagram": dict(followers=18400, growth=38, impressions=9200, reach_ratio=0.62,
                              eng=0.071, ctr=0.0105, conv=0.045, post_p=0.75),
            "facebook": dict(followers=9600, growth=9, impressions=4100, reach_ratio=0.71,
                             eng=0.032, ctr=0.0125, conv=0.06, post_p=0.45),
            "tiktok": dict(followers=3100, growth=21, impressions=5200, reach_ratio=0.80,
                           eng=0.058, ctr=0.0035, conv=0.02, post_p=0.30),
        },
    },
    "pinecrest": {
        "seed": 2202,
        # quiet September, then autumn foliage + ski-pass launch spike through October
        "trend": lambda d: 1.0 if d.month == 9 else 1.0 + 0.025 * d.day,
        "platforms": {
            "instagram": dict(followers=7200, growth=11, impressions=3100, reach_ratio=0.64,
                              eng=0.054, ctr=0.0085, conv=0.04, post_p=0.40),
            "facebook": dict(followers=15800, growth=17, impressions=6900, reach_ratio=0.69,
                             eng=0.038, ctr=0.0140, conv=0.07, post_p=0.60),
            "tiktok": dict(followers=11200, growth=46, impressions=11800, reach_ratio=0.83,
                           eng=0.083, ctr=0.0045, conv=0.025, post_p=0.65),
        },
    },
}


def _daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def generate_rows(client_id: str) -> list[dict]:
    profile = PROFILES[client_id]
    rng = random.Random(profile["seed"])
    rows = []
    followers = {p: spec["followers"] for p, spec in profile["platforms"].items()}
    for d in _daterange(START, END):
        trend = profile["trend"](d)
        weekend = 1.18 if d.weekday() >= 5 else 1.0
        for platform in config.PLATFORMS:
            spec = profile["platforms"][platform]
            posts = 1 if rng.random() < spec["post_p"] else 0
            if posts and rng.random() < 0.2:
                posts = 2
            post_boost = 1.0 + 0.35 * posts
            impressions = int(spec["impressions"] * trend * weekend * post_boost * rng.uniform(0.82, 1.18))
            reach = int(impressions * spec["reach_ratio"] * rng.uniform(0.93, 1.05))
            reach = min(reach, impressions)
            engagements = reach * spec["eng"] * rng.uniform(0.85, 1.15)
            likes = int(engagements * 0.78)
            comments = int(engagements * 0.07)
            shares = int(engagements * 0.06)
            saves = int(engagements * 0.09)
            link_clicks = int(impressions * spec["ctr"] * rng.uniform(0.8, 1.2))
            bookings = sum(1 for _ in range(link_clicks) if rng.random() < spec["conv"])
            followers[platform] += max(0, int(spec["growth"] * trend * rng.uniform(0.4, 1.6)))
            rows.append({
                "client_id": client_id, "date": d.isoformat(), "platform": platform,
                "followers": followers[platform], "impressions": impressions, "reach": reach,
                "likes": likes, "comments": comments, "shares": shares, "saves": saves,
                "link_clicks": link_clicks, "posts": posts,
                "website_bookings_attributed": bookings,
            })
    return rows


def bad_rows(client_id: str) -> list[dict]:
    """Three intentionally invalid rows (shown as rejected in the import step)."""
    base = {"client_id": client_id, "followers": 1000, "impressions": 500, "reach": 300,
            "likes": 20, "comments": 2, "shares": 1, "saves": 3, "link_clicks": 4,
            "posts": 1, "website_bookings_attributed": 0}
    return [
        {**base, "date": "2026-10-32", "platform": "instagram"},          # impossible date
        {**base, "date": "2026-10-12", "platform": "facebook", "likes": -40},  # negative count
        {**base, "date": "2026-10-20", "platform": "tiktok", "reach": 900},    # reach > impressions
    ]


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def sample_path(client_id: str) -> Path:
    return config.samples_dir() / client_id / "metrics.csv"


def misrouted_path() -> Path:
    return config.samples_dir() / "misrouted" / "pinecrest_rows_sent_to_wrong_client.csv"


def write_samples() -> list[Path]:
    written = []
    for client_id in config.CLIENTS:
        path = sample_path(client_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(to_csv(generate_rows(client_id) + bad_rows(client_id)), encoding="utf-8")
        written.append(path)
    # A Pinecrest extract that someone might accidentally upload into Harbourlight.
    path = misrouted_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(to_csv(generate_rows("pinecrest")[:9]), encoding="utf-8")
    written.append(path)
    return written


def sample_csv(client_id: str) -> str:
    path = sample_path(client_id)
    if not path.exists():
        write_samples()
    return path.read_text(encoding="utf-8")
