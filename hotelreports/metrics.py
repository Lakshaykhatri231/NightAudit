"""KPI calculations. Input is a list of metric rows, output is plain dicts; no I/O.

Definitions (also in the README):
- engagements        = likes + comments + shares + saves
- engagement_rate    = engagements / reach
- ctr                = link_clicks / impressions
- booking_conversion = website_bookings_attributed / link_clicks
- follower growth    = followers on the LAST day minus followers on the FIRST day of the
                       period, per platform (followers are a snapshot and are never summed
                       across days).
Any division by zero yields None (rendered as "n/a").
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from . import config

ENGAGEMENT_FIELDS = ("likes", "comments", "shares", "saves")
SUM_FIELDS = ("impressions", "reach", "likes", "comments", "shares", "saves",
              "link_clicks", "posts", "website_bookings_attributed")
COMPARE_KEYS = ("impressions", "reach", "engagements", "engagement_rate", "link_clicks",
                "website_bookings_attributed", "posts")
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def safe_div(a, b):
    return None if not b else a / b


def engagements(row: dict) -> int:
    return sum(row[f] for f in ENGAGEMENT_FIELDS)


def aggregate(rows: list[dict]) -> dict:
    totals = {f: sum(r[f] for r in rows) for f in SUM_FIELDS}
    totals["engagements"] = sum(totals[f] for f in ENGAGEMENT_FIELDS)
    totals["engagement_rate"] = safe_div(totals["engagements"], totals["reach"])
    totals["ctr"] = safe_div(totals["link_clicks"], totals["impressions"])
    totals["booking_conversion"] = safe_div(totals["website_bookings_attributed"], totals["link_clicks"])
    totals["row_count"] = len(rows)
    return totals


def follower_growth(rows: list[dict]) -> dict:
    by_platform = {}
    for platform in config.PLATFORMS:
        prow = sorted((r for r in rows if r["platform"] == platform), key=lambda r: r["date"])
        if not prow:
            continue
        start, end = prow[0]["followers"], prow[-1]["followers"]
        by_platform[platform] = {"start": start, "end": end, "net": end - start,
                                 "pct": safe_div(end - start, start),
                                 "start_date": prow[0]["date"], "end_date": prow[-1]["date"]}
    start = sum(p["start"] for p in by_platform.values())
    end = sum(p["end"] for p in by_platform.values())
    return {"start": start, "end": end, "net": end - start, "pct": safe_div(end - start, start),
            "by_platform": by_platform}


def _days(start: str, end: str) -> list[str]:
    d, e = date.fromisoformat(start), date.fromisoformat(end)
    out = []
    while d <= e:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def coverage(rows: list[dict], start: str, end: str) -> dict:
    expected = _days(start, end)
    present = defaultdict(set)
    for r in rows:
        present[r["platform"]].add(r["date"])
    missing = {p: [d for d in expected if d not in present[p]] for p in sorted(present)}
    missing = {p: ds for p, ds in missing.items() if ds}
    return {"expected_days": len(expected), "platforms": sorted(present), "missing": missing}


def weekly(rows: list[dict]) -> list[dict]:
    """Totals per week (weeks start on Monday), limited to days inside the period."""
    buckets = defaultdict(list)
    for r in rows:
        d = date.fromisoformat(r["date"])
        buckets[(d - timedelta(days=d.weekday())).isoformat()].append(r)
    out = []
    for week_start in sorted(buckets):
        agg = aggregate(buckets[week_start])
        dates = sorted(r["date"] for r in buckets[week_start])
        out.append({"week_start": week_start, "from": dates[0], "to": dates[-1],
                    "engagements": agg["engagements"], "reach": agg["reach"],
                    "bookings": agg["website_bookings_attributed"]})
    return out


def daily(rows: list[dict]) -> list[dict]:
    """One entry per date: totals across platforms (followers = sum of platform snapshots)."""
    per_day = defaultdict(list)
    for r in rows:
        per_day[r["date"]].append(r)
    out = []
    for d in sorted(per_day):
        rs = per_day[d]
        out.append({"date": d, "engagements": sum(engagements(r) for r in rs),
                    "reach": sum(r["reach"] for r in rs), "link_clicks": sum(r["link_clicks"] for r in rs),
                    "bookings": sum(r["website_bookings_attributed"] for r in rs),
                    "followers": sum(r["followers"] for r in rs)})
    return out


def weekday_profile(days: list[dict]) -> dict:
    """Average daily engagements per weekday, the best weekday and its uplift vs the average day."""
    buckets = defaultdict(list)
    for d in days:
        buckets[date.fromisoformat(d["date"]).weekday()].append(d["engagements"])
    profile = [{"weekday": WEEKDAYS[i], "days": len(buckets[i]),
                "avg_engagements": safe_div(sum(buckets[i]), len(buckets[i]))} for i in range(7)]
    avg_day = safe_div(sum(d["engagements"] for d in days), len(days))
    ranked = [p for p in profile if p["avg_engagements"] is not None]
    best = max(ranked, key=lambda p: p["avg_engagements"]) if ranked else None
    return {"by_weekday": profile, "average_day": avg_day, "best": best["weekday"] if best else None,
            "best_uplift": safe_div(best["avg_engagements"] - avg_day, avg_day) if best and avg_day else None}


def funnel(overall: dict) -> list[dict]:
    """The audience journey from seen to booked. Each step says what its rate is measured against."""
    o = overall
    return [
        {"key": "impressions", "label": "Times seen", "value": o["impressions"], "rate": None, "rate_of": None},
        {"key": "reach", "label": "People reached", "value": o["reach"],
         "rate": safe_div(o["reach"], o["impressions"]), "rate_of": "unique people per impression"},
        {"key": "engagements", "label": "Interactions", "value": o["engagements"],
         "rate": o["engagement_rate"], "rate_of": "of people reached"},
        {"key": "link_clicks", "label": "Website clicks", "value": o["link_clicks"],
         "rate": safe_div(o["link_clicks"], o["reach"]), "rate_of": "of people reached"},
        {"key": "website_bookings_attributed", "label": "Bookings", "value": o["website_bookings_attributed"],
         "rate": o["booking_conversion"], "rate_of": "of website clicks"},
    ]


def summarize(rows: list[dict], start: str, end: str) -> dict:
    overall = aggregate(rows)
    followers = follower_growth(rows)
    by_platform = {}
    for platform in config.PLATFORMS:
        prow = [r for r in rows if r["platform"] == platform]
        if prow:
            a = aggregate(prow)
            a["engagements_per_post"] = safe_div(a["engagements"], a["posts"])
            a["share_of_engagements"] = safe_div(a["engagements"], overall["engagements"])
            a["share_of_bookings"] = safe_div(a["website_bookings_attributed"], overall["website_bookings_attributed"])
            a["share_of_reach"] = safe_div(a["reach"], overall["reach"])
            by_platform[platform] = a
    ranked = sorted((p for p in by_platform if by_platform[p]["engagement_rate"] is not None),
                    key=lambda p: by_platform[p]["engagement_rate"], reverse=True)
    weeks = weekly(rows)
    days = daily(rows)
    return {
        "overall": overall,
        "by_platform": by_platform,
        "followers": followers,
        "best_platform": ranked[0] if ranked else None,
        "platform_ranking": ranked,
        "weekly": weeks,
        "top_week": max(weeks, key=lambda w: w["engagements"]) if weeks else None,
        "daily": days,
        "top_day": max(days, key=lambda d: d["engagements"]) if days else None,
        "weekday": weekday_profile(days),
        "funnel": funnel(overall),
        "coverage": coverage(rows, start, end),
    }


def compare(current: dict, previous: dict | None) -> dict | None:
    """Relative change of key KPIs vs the previous period (None if no previous data)."""
    if previous is None:
        return None
    out = {}
    for k in COMPARE_KEYS:
        cur, prev = current["overall"][k], previous["overall"][k]
        out[k] = {"current": cur, "previous": prev,
                  "change": None if cur is None or prev is None else safe_div(cur - prev, prev)}
    cur_f, prev_f = current["followers"]["net"], previous["followers"]["net"]
    out["follower_net_growth"] = {"current": cur_f, "previous": prev_f, "change": safe_div(cur_f - prev_f, prev_f)}
    return out


def previous_period(start: str, end: str) -> tuple[str, str]:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    # A whole calendar month compares with the month before; anything else with
    # the same number of days immediately before it.
    if s.day == 1 and (e + timedelta(days=1)).day == 1 and s.month == e.month:
        prev_end = s - timedelta(days=1)
        return prev_end.replace(day=1).isoformat(), prev_end.isoformat()
    length = (e - s).days + 1
    return (s - timedelta(days=length)).isoformat(), (s - timedelta(days=1)).isoformat()
