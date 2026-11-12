"""Build a client's report: KPIs, comparison with the previous period, accuracy checks
and the written summary.

Every number in the text is taken from the computed summary, so the words can never
disagree with the tables. The report content is stored with a SHA-256 fingerprint,
which is checked again at approval and export to catch any later change.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta

from . import config, metrics
from .errors import InvalidInput
from .storage import TenantRepository, now_iso


# Formatting helpers, also used by the exporters.
def fmt_int(n) -> str:
    return "n/a" if n is None else f"{n:,}"


def fmt_pct(x, digits=2) -> str:
    return "n/a" if x is None else f"{x * 100:.{digits}f}%"


def fmt_change(x) -> str:
    return "n/a" if x is None else f"{x * 100:+.1f}%"


def short_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b')}"


def period_label(start: str, end: str) -> str:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    if s.day == 1 and (s.year, s.month) == (e.year, e.month) and (e + timedelta(days=1)).day == 1:
        return s.strftime("%B %Y")  # a whole calendar month, e.g. "October 2026"
    return f"{s.day} {s.strftime('%b %Y')} – {e.day} {e.strftime('%b %Y')}"


def canonical_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_hash(payload_json: str) -> str:
    return hashlib.sha256(payload_json.encode("utf-8")).hexdigest()


def reconcile(repo: TenantRepository, start: str, end: str, summary: dict) -> list[dict]:
    """Accuracy checks: re-add the numbers in different ways and confirm they agree."""
    checks = []
    overall, by_platform = summary["overall"], summary["by_platform"]

    sql = repo.sql_totals(start, end)
    mismatches = [f for f in metrics.SUM_FIELDS if sql[f] != overall[f]]
    if sql["row_count"] != overall["row_count"]:
        mismatches.append("row_count")
    checks.append({
        "name": "Totals match the database",
        "status": "fail" if mismatches else "pass",
        "detail": (f"Mismatch in: {', '.join(mismatches)}" if mismatches else
                   f"All {len(metrics.SUM_FIELDS)} totals and the row count ({sql['row_count']}) "
                   f"independently re-summed in SQL and matched."),
    })

    bad = [f for f in metrics.SUM_FIELDS + ("engagements",)
           if sum(p[f] for p in by_platform.values()) != overall[f]]
    checks.append({
        "name": "Platform breakdown adds up to the total",
        "status": "fail" if bad else "pass",
        "detail": f"Mismatch in: {', '.join(bad)}" if bad else
                  f"{len(by_platform)} platforms sum exactly to the overall figures.",
    })

    eng = sum(overall[f] for f in metrics.ENGAGEMENT_FIELDS)
    rate_ok = eng == overall["engagements"] and (
        overall["reach"] == 0 or abs(eng / overall["reach"] - overall["engagement_rate"]) < 1e-12)
    checks.append({
        "name": "Engagement maths recomputed",
        "status": "pass" if rate_ok else "fail",
        "detail": f"likes + comments + shares + saves = {eng:,}; ÷ reach {overall['reach']:,} "
                  f"= {fmt_pct(overall['engagement_rate'])}.",
    })

    days = summary["daily"]
    day_bad = [k for k, f in (("engagements", "engagements"), ("bookings", "website_bookings_attributed"),
                              ("link_clicks", "link_clicks"), ("reach", "reach"))
               if sum(d[k] for d in days) != overall[f]]
    checks.append({
        "name": "Daily figures add up to the period total",
        "status": "fail" if day_bad else "pass",
        "detail": f"Mismatch in: {', '.join(day_bad)}" if day_bad else
                  f"{len(days)} daily totals sum exactly to the period's engagements, reach, clicks and bookings.",
    })

    cov = summary["coverage"]
    missing_total = sum(len(v) for v in cov["missing"].values())
    checks.append({
        "name": "Complete daily data for the period",
        "status": "warn" if missing_total else "pass",
        "detail": (f"{missing_total} platform-day(s) missing: " +
                   "; ".join(f"{config.PLATFORM_LABELS[p]}: {', '.join(d[:5])}{'…' if len(d) > 5 else ''}"
                             for p, d in cov["missing"].items()))
        if missing_total else
        f"All {cov['expected_days']} days present for {len(cov['platforms'])} platforms.",
    })
    return checks


def narrative(client_name: str, label: str, summary: dict, comparison: dict | None) -> list[str]:
    o, f = summary["overall"], summary["followers"]
    n_platforms = len(summary["by_platform"])
    lines = [
        f"In {label}, {client_name} reached {fmt_int(o['reach'])} accounts across {n_platforms} "
        f"social platforms ({fmt_int(o['impressions'])} impressions from {fmt_int(o['posts'])} posts), "
        f"generating {fmt_int(o['engagements'])} engagements — an engagement rate of {fmt_pct(o['engagement_rate'])}."
    ]
    if comparison:
        c = comparison["engagements"]
        direction = "up" if (c["change"] or 0) >= 0 else "down"
        lines.append(
            f"Engagements were {direction} {fmt_change(c['change']).lstrip('+-')} on the previous period "
            f"({fmt_int(c['previous'])} → {fmt_int(c['current'])}), and reach changed by "
            f"{fmt_change(comparison['reach']['change'])}.")
    else:
        lines.append("No complete previous period is available, so period-over-period comparison is not shown.")
    lines.append(
        f"Total followers {'grew' if f['net'] >= 0 else 'fell'} by {fmt_int(abs(f['net']))} "
        f"({fmt_change(f['pct'])}) to {fmt_int(f['end'])}.")
    if summary["best_platform"]:
        bp = summary["best_platform"]
        p = summary["by_platform"][bp]
        lines.append(
            f"{config.PLATFORM_LABELS[bp]} had the highest engagement rate ({fmt_pct(p['engagement_rate'])}) "
            f"with {fmt_int(p['engagements'])} engagements.")
    lines.append(
        f"Social channels drove {fmt_int(o['link_clicks'])} link clicks (CTR {fmt_pct(o['ctr'])}) and "
        f"{fmt_int(o['website_bookings_attributed'])} attributed website bookings.")
    tw = summary["top_week"]
    if tw:
        lines.append(
            f"The strongest week was {short_date(tw['from'])}–{short_date(tw['to'])} "
            f"with {fmt_int(tw['engagements'])} engagements.")
    return lines


# Insights (verdict, headline, wins, watch-outs, platform roles, next steps) follow
# fixed rules and read only from `summary` and `comparison`, so every statement can
# be traced to a number in the report.
SIGNIFICANT = 0.02           # a change smaller than ±2% is treated as "flat"
METRIC_LABELS = {
    "reach": "Reach", "engagements": "Engagements", "engagement_rate": "Engagement rate",
    "link_clicks": "Website clicks", "website_bookings_attributed": "Bookings from social",
    "impressions": "Impressions", "follower_net_growth": "New followers",
}
VERDICT_KEYS = ("reach", "engagements", "link_clicks", "website_bookings_attributed")


def _fmt_metric(key, v):
    return fmt_pct(v) if key == "engagement_rate" else fmt_int(v)


def _per_100(rate) -> str:
    return "n/a" if rate is None else f"{rate * 100:.1f}"


def platform_roles(summary: dict) -> dict:
    bp = summary["by_platform"]
    fp = summary["followers"]["by_platform"]
    roles = {p: [] for p in bp}
    if len(bp) < 2:
        return roles
    pick = lambda fn: max((p for p in bp if fn(p) is not None), key=fn, default=None)
    for label, fn in (("🏆 Best engagement", lambda p: bp[p]["engagement_rate"]),
                      ("💼 Top booking driver", lambda p: bp[p]["website_bookings_attributed"]),
                      ("🚀 Fastest growing", lambda p: fp.get(p, {}).get("pct")),
                      ("👀 Biggest audience", lambda p: bp[p]["reach"])):
        winner = pick(fn)
        if winner:
            roles[winner].append(label)
    return roles


def insights(summary: dict, comparison: dict | None) -> dict:
    o, f, bp = summary["overall"], summary["followers"], summary["by_platform"]
    L = config.PLATFORM_LABELS

    # Verdict
    if comparison:
        ups = sum(1 for k in VERDICT_KEYS if (comparison[k]["change"] or 0) >= SIGNIFICANT)
        downs = sum(1 for k in VERDICT_KEYS if (comparison[k]["change"] or 0) <= -SIGNIFICANT)
        if ups >= 3 and downs == 0:
            verdict = {"label": "Strong period", "tone": "good", "icon": "▲"}
        elif downs >= 3 and ups == 0:
            verdict = {"label": "Needs attention", "tone": "bad", "icon": "▼"}
        elif ups > downs:
            verdict = {"label": "Positive, with some dips", "tone": "good", "icon": "▲"}
        elif downs > ups:
            verdict = {"label": "Mixed — some declines", "tone": "warn", "icon": "!"}
        else:
            verdict = {"label": "Steady period", "tone": "neutral", "icon": "●"}
        ce, cb = comparison["engagements"], comparison["website_bookings_attributed"]
        headline = (f"Engagements {'up' if (ce['change'] or 0) >= 0 else 'down'} "
                    f"{fmt_change(ce['change']).lstrip('+-')}, {fmt_int(o['website_bookings_attributed'])} bookings "
                    f"from social ({fmt_change(cb['change'])}) and {f['net']:+,} new followers.")
    else:
        verdict = {"label": "Baseline period", "tone": "neutral", "icon": "●"}
        headline = (f"{fmt_int(o['engagements'])} engagements, {fmt_int(o['website_bookings_attributed'])} bookings "
                    f"from social and {f['net']:+,} new followers. The next report will show the trend.")

    plain = {
        "reach": "different people saw your content",
        "engagements": "likes, comments, shares and saves",
        "engagement_rate": f"≈ {_per_100(o['engagement_rate'])} of every 100 people reached interacted",
        "follower_growth": f"{fmt_change(f['pct'])} → {fmt_int(f['end'])} followers in total",
        "link_clicks": "visits to your website from social posts",
        "bookings": (f"1 booking for every {round(o['link_clicks'] / o['website_bookings_attributed'])} website clicks"
                     if o["website_bookings_attributed"] else "no bookings traced to social"),
    }

    # Wins and watch-outs
    wins, watch = [], []
    if comparison:
        changes = [(k, c) for k, c in comparison.items() if k in METRIC_LABELS and c["change"] is not None]
        for k, c in sorted(changes, key=lambda kc: -kc[1]["change"]):
            if c["change"] >= SIGNIFICANT and len(wins) < 3:
                wins.append(f"{METRIC_LABELS[k]} up {fmt_change(c['change']).lstrip('+')} "
                            f"({_fmt_metric(k, c['previous'])} → {_fmt_metric(k, c['current'])})")
        for k, c in sorted(changes, key=lambda kc: kc[1]["change"]):
            if c["change"] <= -SIGNIFICANT and len(watch) < 3:
                why = ""
                if k == "engagement_rate" and (comparison["engagements"]["change"] or 0) > 0:
                    why = " — reach grew faster than interactions, so total engagements still rose"
                watch.append(f"{METRIC_LABELS[k]} down {fmt_change(c['change']).lstrip('-')} "
                             f"({_fmt_metric(k, c['previous'])} → {_fmt_metric(k, c['current'])}){why}")
        cp = comparison.get("posts")
        if cp and cp["change"] is not None and cp["change"] <= -0.10:
            watch.append(f"Fewer posts than the previous period ({fmt_int(cp['previous'])} → {fmt_int(cp['current'])})")
    if summary["best_platform"]:
        b = summary["best_platform"]
        wins.append(f"{L[b]} led engagement at {fmt_pct(bp[b]['engagement_rate'])} "
                    f"({fmt_int(bp[b]['engagements'])} interactions)")
    tw = summary["top_week"]
    if tw:
        wins.append(f"Best week: {short_date(tw['from'])}–{short_date(tw['to'])} with {fmt_int(tw['engagements'])} engagements")

    ranking = summary["platform_ranking"]
    if len(ranking) >= 2:
        best, worst = ranking[0], ranking[-1]
        if bp[worst]["engagement_rate"] < 0.5 * bp[best]["engagement_rate"]:
            watch.append(f"{L[worst]} engagement rate ({fmt_pct(bp[worst]['engagement_rate'])}) is less than half "
                         f"of {L[best]}'s ({fmt_pct(bp[best]['engagement_rate'])})")
    low_ctr = [p for p in bp if bp[p]["ctr"] is not None and o["ctr"] and bp[p]["ctr"] < 0.5 * o["ctr"]]
    for p in low_ctr[:1]:
        watch.append(f"{L[p]} sends few people to your website: {fmt_pct(bp[p]['ctr'])} click-through "
                     f"vs {fmt_pct(o['ctr'])} overall")
    missing = sum(len(v) for v in summary["coverage"]["missing"].values())
    if missing:
        watch.append(f"Data is missing for {missing} platform-day(s); totals may be understated")
    if not watch:
        watch.append("No notable declines this period")

    # Suggested next steps
    actions = []
    wd = summary["weekday"]
    if wd["best"] and wd["best_uplift"] is not None and wd["best_uplift"] >= 0.10:
        best_avg = next(x["avg_engagements"] for x in wd["by_weekday"] if x["weekday"] == wd["best"])
        actions.append(f"Schedule key posts for {wd['best']}s — they averaged {fmt_int(round(best_avg))} engagements, "
                       f"{fmt_change(wd['best_uplift']).lstrip('+')} more than a typical day.")
    epp = {p: bp[p]["engagements_per_post"] for p in bp if bp[p]["engagements_per_post"]}
    if len(epp) >= 2:
        hi, lo = max(epp, key=epp.get), min(epp, key=epp.get)
        if epp[hi] >= 1.5 * epp[lo]:
            actions.append(f"Put more content into {L[hi]}: each post earned {fmt_int(round(epp[hi]))} engagements "
                           f"on average vs {fmt_int(round(epp[lo]))} on {L[lo]}.")
    if o["website_bookings_attributed"]:
        top_b = max(bp, key=lambda p: bp[p]["website_bookings_attributed"])
        actions.append(f"Use {L[top_b]} for offers and booking links — it drove "
                       f"{fmt_int(bp[top_b]['website_bookings_attributed'])} of {fmt_int(o['website_bookings_attributed'])} "
                       f"bookings ({fmt_pct(bp[top_b]['share_of_bookings'], 0)}).")
    for p in low_ctr[:1]:
        actions.append(f"Add clearer booking links and calls-to-action on {L[p]} to lift its "
                       f"{fmt_pct(bp[p]['ctr'])} click-through rate.")
    if not actions:
        actions.append("Keep the current posting mix — no platform is clearly under-performing.")

    return {"verdict": verdict, "headline": headline, "plain": plain, "wins": wins[:4], "watch_outs": watch[:4],
            "actions": actions[:3], "platform_roles": platform_roles(summary),
            "rules_note": "Insights and suggestions are generated by fixed rules from the numbers in this report "
                          "(changes under ±2% are treated as flat) and are reviewed by a person before release."}


def build_report(repo: TenantRepository, start: str, end: str, actor) -> dict:
    """Compute, check and save a new draft report. `actor` is the signed-in Principal."""
    try:
        s, e = date.fromisoformat(start), date.fromisoformat(end)
    except (TypeError, ValueError):
        raise InvalidInput("period_start and period_end must be YYYY-MM-DD dates")
    if s > e:
        raise InvalidInput("period_start must be on or before period_end")
    if (e - s).days > 366:
        raise InvalidInput("Report period cannot exceed one year")

    rows = repo.get_metrics(start, end)
    if not rows:
        raise InvalidInput(f"No data for {start} to {end}. Import metrics first.")
    summary = metrics.summarize(rows, start, end)

    prev_start, prev_end = metrics.previous_period(start, end)
    prev_rows = repo.get_metrics(prev_start, prev_end)
    prev_summary, comparison_note = None, None
    if prev_rows:
        candidate = metrics.summarize(prev_rows, prev_start, prev_end)
        if candidate["coverage"]["missing"] or set(candidate["by_platform"]) != set(summary["by_platform"]):
            comparison_note = "Previous period data is incomplete; comparison omitted to avoid a misleading figure."
        else:
            prev_summary = candidate
    else:
        comparison_note = "No data for the previous period."
    comparison = metrics.compare(summary, prev_summary)

    client = config.CLIENTS[repo.client_id]
    label = period_label(start, end)
    payload = {
        "client_id": repo.client_id,
        "client_name": client["name"],
        "client_location": client["location"],
        "brand": client["brand"],
        "period": {"start": start, "end": end, "label": label},
        "previous_period": {"start": prev_start, "end": prev_end, "label": period_label(prev_start, prev_end),
                            "used": prev_summary is not None, "note": comparison_note},
        "generated_at": now_iso(),
        "generated_by": {"username": actor.username, "name": actor.name},
        "summary": summary,
        "comparison": comparison,
        "checks": reconcile(repo, start, end, summary),
        "narrative": narrative(client["name"], label, summary, comparison),
        "insights": insights(summary, comparison),
        "previous_daily": prev_summary["daily"] if prev_summary else None,
        "definitions": {
            "engagements": "likes + comments + shares + saves",
            "engagement_rate": "engagements ÷ reach",
            "ctr": "link clicks ÷ impressions",
            "follower_growth": "followers on last day − followers on first day of the period",
        },
    }
    payload_json = canonical_json(payload)
    digest = content_hash(payload_json)
    report_id = repo.create_report(start, end, payload_json, digest, actor.username)
    repo.add_event(report_id, "generated", actor.username, f"Report generated for {label}")
    return get_report(repo, report_id)


def get_report(repo: TenantRepository, report_id: int) -> dict:
    r = repo.get_report(report_id)
    r["payload"] = json.loads(r.pop("payload_json"))
    r["events"] = repo.list_events(report_id)
    return r


def verify_integrity(repo: TenantRepository, report_id: int) -> bool:
    """True if the stored report is unchanged since generation and belongs to this client."""
    r = repo.get_report(report_id)
    payload = json.loads(r["payload_json"])
    return content_hash(r["payload_json"]) == r["content_hash"] and payload.get("client_id") == repo.client_id
