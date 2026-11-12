"""Export approved reports as HTML (print-ready), CSV and JSON.

Only an approved report whose content is unchanged since generation can be exported;
files are saved to exports/<client_id>/. Before approval an HTML preview marked DRAFT
can be viewed, but it is never saved.
"""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime
from html import escape

from . import config
from . import report as report_mod
from .errors import Conflict, InvalidInput
from .report import fmt_change, fmt_int, fmt_pct, short_date
from .storage import TenantRepository

FORMATS = {"html": "text/html; charset=utf-8", "csv": "text/csv; charset=utf-8",
           "json": "application/json; charset=utf-8"}

# Platform colours, chosen to stay distinguishable for colour-blind readers.
PLATFORM_COLORS = {"instagram": "#2a78d6", "facebook": "#eb6834", "tiktok": "#1baf7a"}


def export_report(repo: TenantRepository, report_id: int, fmt: str, draft_preview: bool = False):
    """Returns (filename, content_type, body_bytes, saved_path_or_None)."""
    if fmt not in FORMATS:
        raise InvalidInput(f"Unknown format '{fmt}'. Use one of: {', '.join(FORMATS)}")
    rep = report_mod.get_report(repo, report_id)
    if not report_mod.verify_integrity(repo, report_id):
        raise Conflict("Integrity check failed: the report content does not match its approved hash.")
    approved = rep["status"] == "approved"
    if not approved and not draft_preview:
        raise Conflict(f"Report {report_id} is '{rep['status']}'. Only approved reports can be exported; "
                       f"use the draft preview to look at it before approval.")
    if draft_preview and fmt != "html":
        raise InvalidInput("Draft preview is only available as HTML.")

    p = rep["payload"]
    base = f"{repo.client_id}_{p['period']['start']}_{p['period']['end']}_report{report_id}"
    if fmt == "html":
        body = render_html(rep, draft=not approved)
    elif fmt == "csv":
        body = render_csv(rep)
    else:
        body = json.dumps(_json_export(rep), indent=2, ensure_ascii=False)
    filename = f"{base}{'_DRAFT' if not approved else ''}.{fmt}"
    data = body.encode("utf-8")

    saved = None
    if approved and not draft_preview:  # previews are never saved or logged
        out_dir = config.exports_dir() / repo.client_id
        out_dir.mkdir(parents=True, exist_ok=True)
        saved = out_dir / filename
        saved.write_bytes(data)
        repo.add_event(report_id, f"exported_{fmt}", "system", str(saved.relative_to(config.home())))
    return filename, FORMATS[fmt], data, saved


def _json_export(rep: dict) -> dict:
    return {
        "report_id": rep["id"],
        "status": rep["status"],
        "approval": {"generated_by": rep["created_by"], "generated_at": rep["created_at"],
                     "approved_by": rep["reviewed_by"], "approved_at": rep["reviewed_at"],
                     "comment": rep["review_comment"]},
        "content_sha256": rep["content_hash"],
        "report": rep["payload"],
    }


def render_csv(rep: dict) -> str:
    p = rep["payload"]
    s = p["summary"]
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["section", "platform", "metric", "value"])
    meta = [("client", p["client_name"]), ("period_start", p["period"]["start"]),
            ("period_end", p["period"]["end"]), ("status", rep["status"]),
            ("approved_by", rep["reviewed_by"] or ""), ("approved_at", rep["reviewed_at"] or ""),
            ("content_sha256", rep["content_hash"])]
    for k, v in meta:
        w.writerow(["meta", "", k, v])
    metric_keys = ["posts", "impressions", "reach", "likes", "comments", "shares", "saves", "engagements",
                   "engagement_rate", "link_clicks", "ctr", "website_bookings_attributed", "booking_conversion"]
    for k in metric_keys:
        w.writerow(["totals", "all", k, _raw(s["overall"][k])])
    for platform, agg in s["by_platform"].items():
        for k in metric_keys:
            w.writerow(["platform", platform, k, _raw(agg[k])])
    f = s["followers"]
    w.writerow(["followers", "all", "start", f["start"]])
    w.writerow(["followers", "all", "end", f["end"]])
    w.writerow(["followers", "all", "net_growth", f["net"]])
    for platform, fp in f["by_platform"].items():
        w.writerow(["followers", platform, "net_growth", fp["net"]])
    if p["comparison"]:
        for k, c in p["comparison"].items():
            w.writerow(["vs_previous_period", "all", f"{k}_change", _raw(c["change"])])
    for wk in s["weekly"]:
        w.writerow(["weekly", "all", f"engagements_{wk['from']}_to_{wk['to']}", wk["engagements"]])
    for d in s["daily"]:
        w.writerow(["daily", "all", f"engagements_{d['date']}", d["engagements"]])
    for wd in s["weekday"]["by_weekday"]:
        w.writerow(["weekday", "all", f"avg_engagements_{wd['weekday']}", _raw(wd["avg_engagements"])])
    for st in s["funnel"]:
        w.writerow(["journey", "all", st["key"], st["value"]])
    ins = p["insights"]
    w.writerow(["insight", "", "verdict", ins["verdict"]["label"]])
    w.writerow(["insight", "", "headline", ins["headline"]])
    for kind in ("wins", "watch_outs", "actions"):
        for i, text in enumerate(ins[kind], 1):
            w.writerow(["insight", "", f"{kind}_{i}", text])
    for c in p["checks"]:
        w.writerow(["accuracy_check", "", c["name"], c["status"]])
    return buf.getvalue()


def _raw(v):
    if v is None:
        return ""
    return round(v, 6) if isinstance(v, float) else v


# The HTML report is a client-facing document that reads top to bottom: verdict, key
# results in plain words, audience journey, wins and watch-outs, platform scorecards,
# timing, next steps. Detailed tables, checks and definitions go in the appendix.

BLUE, BLUE_LIGHT, PREV_GREY = "#2a78d6", "#9ec5f4", "#a9a79f"
TONES = {"good": ("#006300", "#e6f4e6"), "warn": ("#8a5a00", "#fdf3dc"),
         "bad": ("#b42318", "#fdecea"), "neutral": ("#52514e", "#f0efec")}


def _nice_max(v):
    """Round v up to a tidy axis maximum (1, 1.2, 1.5, 2, 2.5, ... times a power of ten)."""
    if v <= 0:
        return 1
    mag = 10 ** (len(str(int(v))) - 1)
    for m in (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if m * mag >= v:
            return m * mag
    return 10 * mag


def _sparkline(values, w=120, h=30):
    if len(values) < 2:
        return ""
    lo, hi = min(values), max(values)
    rng = (hi - lo) or 1
    pts = " ".join(f"{w * i / (len(values) - 1):.1f},{h - 3 - (h - 6) * (v - lo) / rng:.1f}" for i, v in enumerate(values))
    return (f'<svg class="spark" viewBox="0 0 {w} {h}" width="{w}" height="{h}" aria-hidden="true">'
            f'<polyline points="{pts}" fill="none" stroke="{BLUE}" stroke-width="2" stroke-linejoin="round"/>'
            f'<circle cx="{w}" cy="{pts.split()[-1].split(",")[1]}" r="3" fill="{BLUE}"/></svg>')


def _trend_chart(cur, prev, cur_label, prev_label):
    """Daily engagements: this period (blue) vs previous period (grey), aligned by day number."""
    if len(cur) < 2:
        return '<p class="muted">Not enough days to chart.</p>'
    prev = prev or []
    w, h, pl, pr, pt, pb = 560, 230, 46, 58, 14, 30
    n = max(len(cur), len(prev))
    vmax = _nice_max(max([d["engagements"] for d in cur] + [d["engagements"] for d in prev]))
    x = lambda i: pl + (w - pl - pr) * i / (n - 1)
    y = lambda v: pt + (h - pt - pb) * (1 - v / vmax)
    out = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Daily engagements, {e_(cur_label)}'
           f'{" vs " + e_(prev_label) if prev else ""}">']
    for k in range(1, 4):
        gv = vmax * k / 4
        out.append(f'<line x1="{pl}" x2="{w - pr}" y1="{y(gv):.1f}" y2="{y(gv):.1f}" class="grid"/>'
                   f'<text x="{pl - 6}" y="{y(gv) + 4:.1f}" text-anchor="end" class="ax">{round(gv):,}</text>')
    out.append(f'<line x1="{pl}" x2="{w - pr}" y1="{y(0)}" y2="{y(0)}" class="base"/>'
               f'<text x="{pl - 6}" y="{y(0) + 4}" text-anchor="end" class="ax">0</text>')

    def line(series, color, dash=""):
        pts = " ".join(f"{x(i):.1f},{y(d['engagements']):.1f}" for i, d in enumerate(series))
        return (f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2" '
                f'stroke-linejoin="round" stroke-linecap="round" {dash}/>')
    if prev:
        out.append(line(prev, PREV_GREY, 'stroke-dasharray="5 4"'))
        ly = y(prev[-1]["engagements"])
        out.append(f'<text x="{x(len(prev) - 1) + 6:.1f}" y="{ly + 4:.1f}" class="ax">{e_(prev_label.split()[0])}</text>')
    out.append(line(cur, BLUE))
    last = cur[-1]
    out.append(f'<circle cx="{x(len(cur) - 1):.1f}" cy="{y(last["engagements"]):.1f}" r="4" fill="{BLUE}"/>'
               f'<text x="{x(len(cur) - 1) + 8:.1f}" y="{y(last["engagements"]) + 4:.1f}" class="lbl">'
               f'{e_(cur_label.split()[0])}</text>')
    out.append(f'<text x="{pl}" y="{h - 8}" class="ax">{short_date(cur[0]["date"])}</text>'
               f'<text x="{x(len(cur) - 1):.1f}" y="{h - 8}" text-anchor="end" class="ax">{short_date(cur[-1]["date"])}</text>')
    step = (w - pl - pr) / (n - 1)
    for i in range(n):  # one wide hover area per day, showing both values
        c = cur[i] if i < len(cur) else None
        pv = prev[i] if i < len(prev) else None
        tip = " · ".join(t for t in (
            f'{short_date(c["date"])}: {c["engagements"]:,} engagements' if c else "",
            f'{short_date(pv["date"])}: {pv["engagements"]:,}' if pv else "") if t)
        out.append(f'<rect x="{x(i) - step / 2:.1f}" y="{pt}" width="{step:.1f}" height="{h - pt - pb}" '
                   f'fill="transparent"><title>{e_(tip)}</title></rect>')
    out.append("</svg>")
    return "".join(out)


def _weekday_chart(wd):
    rows = wd["by_weekday"]
    vals = [r["avg_engagements"] or 0 for r in rows]
    if not any(vals):
        return ""
    w, h, pl, pt, pb = 560, 210, 10, 26, 28
    vmax = max(vals) * 1.08
    slot = (w - 2 * pl) / 7
    bw = slot * 0.62
    out = [f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="Average engagements by weekday">']
    for i, r in enumerate(rows):
        v = vals[i]
        bh = (h - pt - pb) * v / vmax
        bx = pl + slot * i + (slot - bw) / 2
        by = h - pb - bh
        best = r["weekday"] == wd["best"]
        out.append(f'<path d="M{bx:.1f},{h - pb} V{by + 4:.1f} q0,-4 4,-4 H{bx + bw - 4:.1f} q4,0 4,4 V{h - pb} Z" '
                   f'fill="{BLUE if best else BLUE_LIGHT}"><title>{r["weekday"]}: {round(v):,} engagements on average '
                   f'({r["days"]} days)</title></path>'
                   f'<text x="{bx + bw / 2:.1f}" y="{by - 6:.1f}" text-anchor="middle" class="{"lbl" if best else "ax"}">'
                   f'{round(v):,}</text>'
                   f'<text x="{bx + bw / 2:.1f}" y="{h - 10}" text-anchor="middle" class="{"lbl" if best else "ax"}">'
                   f'{r["weekday"][:3]}</text>')
    out.append(f'<line x1="{pl}" x2="{w - pl}" y1="{h - pb}" y2="{h - pb}" class="base"/></svg>')
    return "".join(out)


def _delta(comparison, key) -> str:
    if not comparison or key not in comparison:
        return '<div class="delta muted">first period — no comparison</div>'
    ch = comparison[key]["change"]
    if ch is None:
        return '<div class="delta muted">n/a</div>'
    if abs(ch) < 0.02:
        return f'<div class="delta muted">● {fmt_change(ch)} — about the same</div>'
    cls, arrow = ("up", "▲") if ch >= 0 else ("down", "▼")
    return f'<div class="delta {cls}">{arrow} {fmt_change(ch)} vs previous</div>'


def e_(s):
    return escape(str(s))


def _when(iso):
    if not iso:
        return ""
    d = datetime.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b %Y, %H:%M')} UTC"


def _name(username):
    u = config.USERS.get(username or "")
    return u["name"] if u else (username or "")


def render_html(rep: dict, draft: bool) -> str:
    p = rep["payload"]
    s, o, comp = p["summary"], p["summary"]["overall"], p["comparison"]
    f, ins, bp = s["followers"], p["insights"], s["by_platform"]
    L = config.PLATFORM_LABELS
    tone_fg, tone_bg = TONES[ins["verdict"]["tone"]]
    compared = (f'Compared with {e_(p["previous_period"]["label"])}' if p["previous_period"]["used"]
                else e_(p["previous_period"]["note"] or "No previous period"))

    # Key results with plain-English captions
    pl = ins["plain"]
    tiles = [
        ("People reached", fmt_int(o["reach"]), pl["reach"], _delta(comp, "reach"), ""),
        ("Interactions", fmt_int(o["engagements"]), pl["engagements"], _delta(comp, "engagements"), ""),
        ("Engagement rate", fmt_pct(o["engagement_rate"]), pl["engagement_rate"], _delta(comp, "engagement_rate"), ""),
        ("New followers", f"{f['net']:+,}", pl["follower_growth"], _delta(comp, "follower_net_growth"),
         _sparkline([d["followers"] for d in s["daily"]])),
        ("Website clicks", fmt_int(o["link_clicks"]), pl["link_clicks"], _delta(comp, "link_clicks"), ""),
        ("Bookings from social", fmt_int(o["website_bookings_attributed"]), pl["bookings"],
         _delta(comp, "website_bookings_attributed"), ""),
    ]
    tiles_html = "".join(
        f'<div class="tile"><div class="tl">{e_(t)}</div><div class="tv">{v}</div>'
        f'<div class="cap">{e_(c)}</div>{d}{sp}</div>' for t, v, c, d, sp in tiles)

    # Audience journey
    steps = []
    for i, st in enumerate(s["funnel"]):
        rate = (f'<div class="jr">{fmt_pct(st["rate"], 1)} <span>{e_(st["rate_of"])}</span></div>'
                if st["rate"] is not None else '<div class="jr"><span>every time a post was shown</span></div>')
        steps.append(f'<div class="js" style="--lvl:{i}"><div class="jv">{fmt_int(st["value"])}</div>'
                     f'<div class="jl">{e_(st["label"])}</div>{rate}</div>')
    journey = '<div class="jarrow" aria-hidden="true">›</div>'.join(steps)

    wins = "".join(f"<li>{e_(w)}</li>" for w in ins["wins"])
    watch = "".join(f"<li>{e_(w)}</li>" for w in ins["watch_outs"])

    # Platform scorecards, biggest contributor first
    cards = []
    fp_all = f["by_platform"]
    for plat in sorted(bp, key=lambda k: -bp[k]["engagements"]):
        a, fp = bp[plat], fp_all.get(plat, {})
        share = a["share_of_engagements"] or 0
        badges = "".join(f'<span class="badge">{e_(r)}</span>' for r in ins["platform_roles"].get(plat, []))
        cards.append(f'''<div class="pcard" style="--pc:{PLATFORM_COLORS[plat]}">
<div class="ph"><span class="pname">{L[plat]}</span>{badges}</div>
<div class="pbig">{fmt_int(a["engagements"])} <span>interactions</span></div>
<div class="sharebar" title="{fmt_pct(share, 1)} of all interactions"><i style="width:{share * 100:.1f}%"></i></div>
<div class="sharecap">{fmt_pct(share, 0)} of all interactions · {fmt_pct(a["share_of_reach"], 0)} of reach</div>
<dl>
<div><dt>Engagement rate</dt><dd>{fmt_pct(a["engagement_rate"])}</dd></div>
<div><dt>Per post</dt><dd>{fmt_int(round(a["engagements_per_post"])) if a["engagements_per_post"] else "n/a"}</dd></div>
<div><dt>Website clicks</dt><dd>{fmt_int(a["link_clicks"])}</dd></div>
<div><dt>Bookings</dt><dd>{fmt_int(a["website_bookings_attributed"])}</dd></div>
<div><dt>New followers</dt><dd>{fp.get("net", 0):+,} <small>({fmt_change(fp.get("pct"))})</small></dd></div>
<div><dt>Posts</dt><dd>{fmt_int(a["posts"])}</dd></div>
</dl></div>''')

    wd = s["weekday"]
    wd_caption = ""
    if wd["best"] and wd["best_uplift"] is not None:
        wd_caption = (f'<p class="cap2"><b>{e_(wd["best"])}s</b> were the strongest day: '
                      f'{fmt_change(wd["best_uplift"]).lstrip("+")} above the average day '
                      f'({fmt_int(round(wd["average_day"]))} interactions).</p>')
    td = s["top_day"]
    trend_caption = (f'<p class="cap2">Best single day: <b>{short_date(td["date"])}</b> with '
                     f'{fmt_int(td["engagements"])} interactions.</p>') if td else ""
    legend = (f'<div class="legend"><span><i style="background:{BLUE}"></i>{e_(p["period"]["label"])}</span>'
              + (f'<span><i class="dash"></i>{e_(p["previous_period"]["label"])}</span>' if p.get("previous_daily") else "")
              + "</div>")

    actions = "".join(f'<li><span class="num">{i}</span><span>{e_(a)}</span></li>'
                      for i, a in enumerate(ins["actions"], 1))

    # Appendix tables
    rows = ""
    for plat, a in bp.items():
        fp = fp_all.get(plat, {})
        rows += (f'<tr><td><span class="sw" style="background:{PLATFORM_COLORS[plat]}"></span>{L[plat]}</td>'
                 f'<td>{fmt_int(a["posts"])}</td><td>{fmt_int(a["impressions"])}</td><td>{fmt_int(a["reach"])}</td>'
                 f'<td>{fmt_int(a["likes"])}</td><td>{fmt_int(a["comments"])}</td><td>{fmt_int(a["shares"])}</td>'
                 f'<td>{fmt_int(a["saves"])}</td><td>{fmt_int(a["engagements"])}</td><td>{fmt_pct(a["engagement_rate"])}</td>'
                 f'<td>{fmt_int(a["link_clicks"])}</td><td>{fmt_pct(a["ctr"])}</td>'
                 f'<td>{fmt_int(a["website_bookings_attributed"])}</td><td>{fmt_int(fp.get("end"))}</td>'
                 f'<td>{fp.get("net", 0):+,}</td></tr>')
    rows += (f'<tr class="total"><td>Total</td><td>{fmt_int(o["posts"])}</td><td>{fmt_int(o["impressions"])}</td>'
             f'<td>{fmt_int(o["reach"])}</td><td>{fmt_int(o["likes"])}</td><td>{fmt_int(o["comments"])}</td>'
             f'<td>{fmt_int(o["shares"])}</td><td>{fmt_int(o["saves"])}</td><td>{fmt_int(o["engagements"])}</td>'
             f'<td>{fmt_pct(o["engagement_rate"])}</td><td>{fmt_int(o["link_clicks"])}</td><td>{fmt_pct(o["ctr"])}</td>'
             f'<td>{fmt_int(o["website_bookings_attributed"])}</td><td>{fmt_int(f["end"])}</td><td>{f["net"]:+,}</td></tr>')
    cmp_rows = ""
    if comp:
        labels = {"impressions": "Impressions", "reach": "People reached", "engagements": "Interactions",
                  "engagement_rate": "Engagement rate", "link_clicks": "Website clicks",
                  "website_bookings_attributed": "Bookings from social", "posts": "Posts",
                  "follower_net_growth": "New followers"}
        for k, lab in labels.items():
            c = comp[k]
            fmt = fmt_pct if k == "engagement_rate" else fmt_int
            cmp_rows += (f'<tr><td>{lab}</td><td>{fmt(c["previous"])}</td><td>{fmt(c["current"])}</td>'
                         f'<td>{fmt_change(c["change"])}</td></tr>')
    weeks = "".join(f'<tr><td>{short_date(w["from"])} – {short_date(w["to"])}</td><td>{fmt_int(w["reach"])}</td>'
                    f'<td>{fmt_int(w["engagements"])}</td><td>{fmt_int(w["bookings"])}</td></tr>' for w in s["weekly"])
    icon = {"pass": "✓", "warn": "!", "fail": "✗"}
    checks = "".join(f'<li class="ck {c["status"]}"><b>{icon[c["status"]]} {e_(c["name"])}</b> '
                     f'<span>{e_(c["detail"])}</span></li>' for c in p["checks"])
    narrative = "".join(f"<li>{e_(line)}</li>" for line in p["narrative"])
    n_pass = sum(1 for c in p["checks"] if c["status"] == "pass")

    if draft:
        stamp = f'<div class="stamp draft">DRAFT — NOT APPROVED ({e_(rep["status"].replace("_", " "))})</div>'
        approval = '<p class="muted">This report has not been approved and must not be sent to the client.</p>'
    else:
        stamp = f'<div class="stamp ok">✓ Approved by {e_(_name(rep["reviewed_by"]))} · {e_(_when(rep["reviewed_at"]))}</div>'
        approval = (f'<p>Approved by <b>{e_(_name(rep["reviewed_by"]))}</b> on {e_(_when(rep["reviewed_at"]))}'
                    + (f' — “{e_(rep["review_comment"])}”' if rep["review_comment"] else "") + "</p>")

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e_(p["client_name"])} — {e_(p["period"]["label"])}</title>
<style>
:root {{ --brand:{e_(p["brand"])}; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --line:#e1e0d9; --bg:#f6f5f2; --card:#fff; }}
* {{ box-sizing:border-box }}
body {{ margin:0; font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--ink); background:var(--bg) }}
.page {{ max-width:1000px; margin:0 auto; padding:0 18px 40px }}
header {{ background:var(--brand); color:#fff; padding:26px 18px 22px; margin:0 -18px }}
header .kicker {{ text-transform:uppercase; letter-spacing:.08em; font-size:12px; opacity:.85 }}
header h1 {{ margin:2px 0 0; font-size:28px; line-height:1.2 }} header p {{ margin:4px 0 0; opacity:.9 }}
.stamp {{ display:inline-block; margin-top:12px; padding:4px 10px; border-radius:6px; font-weight:650; font-size:13px }}
.stamp.ok {{ background:#fff; color:#006300 }} .stamp.draft {{ background:#fab219; color:#0b0b0b }}
.wm {{ position:fixed; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none;
       font-size:96px; font-weight:800; color:rgba(208,59,59,.12); transform:rotate(-24deg); z-index:9 }}
.verdict {{ margin:-14px 0 0; background:var(--card); border-radius:14px; padding:20px 22px; position:relative;
            box-shadow:0 2px 10px rgba(0,0,0,.06); border-left:6px solid {tone_fg} }}
.vlabel {{ display:inline-block; font-weight:700; font-size:13px; color:{tone_fg}; background:{tone_bg};
           padding:3px 10px; border-radius:999px; text-transform:uppercase; letter-spacing:.04em }}
.headline {{ font-size:22px; font-weight:650; line-height:1.35; margin:10px 0 4px }}
.sub {{ color:var(--ink2); font-size:13px; margin:0 }}
h2 {{ font-size:18px; margin:30px 0 4px }} .lead {{ color:var(--ink2); margin:0 0 12px; font-size:14px }}
.tiles {{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px }}
@media (max-width:760px) {{ .tiles {{ grid-template-columns:1fr 1fr }} }}
.tile {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; position:relative }}
.tl {{ color:var(--ink2); font-size:13px; font-weight:600 }} .tv {{ font-size:30px; font-weight:750; line-height:1.15; margin-top:2px }}
.cap {{ font-size:13px; color:var(--ink2); margin:2px 0 4px }}
.delta {{ font-size:12.5px; font-weight:600 }} .up {{ color:#006300 }} .down {{ color:#b42318 }} .muted {{ color:var(--muted) }}
.spark {{ position:absolute; right:12px; top:14px }}
.journey {{ display:flex; align-items:stretch; gap:4px }}
.js {{ flex:1; border-radius:12px; padding:14px 12px; color:#fff;
       background:color-mix(in srgb, #0d366b calc(var(--lvl) * 18% + 10%), #3987e5) }}
.jv {{ font-size:24px; font-weight:750; line-height:1.1 }} .jl {{ font-weight:600; font-size:14px; margin-top:2px }}
.jr {{ font-size:12.5px; margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,.3); font-weight:700 }}
.jr span {{ font-weight:400; opacity:.9 }}
.jarrow {{ display:flex; align-items:center; color:var(--muted); font-size:26px; font-weight:300 }}
@media (max-width:760px) {{ .journey {{ flex-direction:column }} .jarrow {{ transform:rotate(90deg); justify-content:center; height:18px }} }}
.two {{ display:grid; grid-template-columns:1fr 1fr; gap:12px }}
@media (max-width:760px) {{ .two {{ grid-template-columns:1fr }} }}
.card {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px }}
.card h3 {{ margin:0 0 8px; font-size:15px }}
ul.il {{ list-style:none; margin:0; padding:0 }} ul.il li {{ padding:7px 0 7px 30px; position:relative; border-bottom:1px solid var(--line) }}
ul.il li:last-child {{ border-bottom:0 }}
ul.il li::before {{ position:absolute; left:0; top:7px; width:21px; height:21px; border-radius:50%; display:grid; place-items:center;
                    font-size:12px; font-weight:800; color:#fff }}
ul.wins li::before {{ content:"✓"; background:#0ca30c }} ul.watch li::before {{ content:"!"; background:#c98500 }}
.pcards {{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px }}
@media (max-width:860px) {{ .pcards {{ grid-template-columns:1fr }} }}
.pcard {{ background:var(--card); border:1px solid var(--line); border-top:5px solid var(--pc); border-radius:12px; padding:14px }}
.ph {{ display:flex; flex-wrap:wrap; gap:6px; align-items:center }} .pname {{ font-weight:750; font-size:17px; margin-right:4px }}
.badge {{ font-size:11.5px; font-weight:650; background:#f0efec; color:var(--ink2); padding:2px 8px; border-radius:999px }}
.pbig {{ font-size:26px; font-weight:750; margin-top:8px }} .pbig span {{ font-size:13px; font-weight:500; color:var(--ink2) }}
.sharebar {{ height:8px; border-radius:4px; background:#f0efec; margin-top:6px; overflow:hidden }}
.sharebar i {{ display:block; height:100%; background:var(--pc); border-radius:4px }}
.sharecap {{ font-size:12px; color:var(--muted); margin-top:4px }}
dl {{ display:grid; grid-template-columns:1fr 1fr; gap:8px 12px; margin:12px 0 0 }}
dt {{ font-size:12px; color:var(--ink2) }} dd {{ margin:0; font-weight:650; font-variant-numeric:tabular-nums }}
dd small {{ font-weight:500; color:var(--muted) }}
.legend {{ display:flex; gap:16px; font-size:13px; color:var(--ink2); margin-bottom:4px }}
.legend i {{ display:inline-block; width:18px; height:3px; border-radius:2px; vertical-align:middle; margin-right:6px }}
.legend i.dash {{ background:repeating-linear-gradient(90deg,{PREV_GREY} 0 5px,transparent 5px 9px) }}
.cap2 {{ font-size:13.5px; color:var(--ink2); margin:8px 0 0 }}
svg text.ax {{ font-size:11px; fill:var(--muted) }} svg text.lbl {{ font-size:12px; fill:var(--ink); font-weight:650 }}
svg .grid {{ stroke:var(--line) }} svg .base {{ stroke:#c3c2b7 }}
ol.actions {{ list-style:none; padding:0; margin:0; display:grid; gap:10px }}
ol.actions li {{ display:flex; gap:12px; align-items:flex-start; background:var(--card); border:1px solid var(--line);
                 border-radius:12px; padding:14px }}
.num {{ flex:none; width:28px; height:28px; border-radius:50%; background:var(--brand); color:#fff; display:grid;
        place-items:center; font-weight:750 }}
.note {{ font-size:12.5px; color:var(--muted); margin-top:8px }}
details.appx {{ margin-top:30px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:4px 16px }}
details.appx > summary {{ cursor:pointer; font-weight:700; font-size:17px; padding:12px 0 }}
details.appx h3 {{ font-size:15px; margin:20px 0 8px }}
table {{ width:100%; border-collapse:collapse; font-size:13px; font-variant-numeric:tabular-nums }}
th,td {{ text-align:right; padding:6px 8px; border-bottom:1px solid var(--line); white-space:nowrap }}
th:first-child,td:first-child {{ text-align:left }} th {{ color:var(--ink2); font-weight:600 }}
tr.total td {{ font-weight:700; border-top:2px solid var(--ink2) }}
.tw {{ overflow-x:auto }}
.sw {{ display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px }}
ul.checks {{ list-style:none; padding:0; margin:0 }} .ck {{ padding:6px 0; border-bottom:1px solid var(--line) }}
.ck.pass b {{ color:#006300 }} .ck.warn b {{ color:#8a5a00 }} .ck.fail b {{ color:#b42318 }} .ck span {{ color:var(--ink2); font-size:13px }}
dl.gloss {{ grid-template-columns:180px 1fr; gap:6px 14px }} dl.gloss dt {{ font-weight:650; color:var(--ink); font-size:13.5px }}
dl.gloss dd {{ font-weight:400; font-size:13.5px; color:var(--ink2) }}
@media (max-width:600px) {{ dl.gloss {{ grid-template-columns:1fr }} }}
footer {{ margin-top:24px; font-size:12px; color:var(--muted) }} .hash {{ word-break:break-all }}
@media print {{ body {{ background:#fff }} .tile,.card,.pcard,ol.actions li {{ break-inside:avoid }}
  header,.js,.num,.sharebar i,.vlabel {{ -webkit-print-color-adjust:exact; print-color-adjust:exact }} }}
</style></head><body>
{'<div class="wm">DRAFT</div>' if draft else ''}
<div class="page">
<header><div class="kicker">Social media performance report</div><h1>{e_(p["client_name"])}</h1>
<p>{e_(p["period"]["label"])} · {e_(short_date(p["period"]["start"]))} – {e_(short_date(p["period"]["end"]))} · Instagram, Facebook &amp; TikTok</p>
{stamp}<div style="height:14px"></div></header>

<section class="verdict"><span class="vlabel">{ins["verdict"]["icon"]} {e_(ins["verdict"]["label"])}</span>
<p class="headline">{e_(ins["headline"])}</p><p class="sub">{compared} · {n_pass}/{len(p["checks"])} accuracy checks passed</p></section>

<h2>Key results</h2><p class="lead">What the numbers mean, in plain words.</p>
<div class="tiles">{tiles_html}</div>

<h2>From seen to booked</h2><p class="lead">How your audience moved from seeing a post to booking a stay.</p>
<div class="journey">{journey}</div>

<h2>What went well · what to watch</h2>
<div class="two"><div class="card"><h3>Wins</h3><ul class="il wins">{wins}</ul></div>
<div class="card"><h3>Watch-outs</h3><ul class="il watch">{watch}</ul></div></div>

<h2>How each platform performed</h2><p class="lead">Each platform plays a different role. Badges show where it led.</p>
<div class="pcards">{"".join(cards)}</div>

<h2>When your audience engaged</h2>
<div class="two"><div class="card"><h3>Interactions per day</h3>{legend}
{_trend_chart(s["daily"], p.get("previous_daily"), p["period"]["label"], p["previous_period"]["label"])}{trend_caption}</div>
<div class="card"><h3>Average interactions by day of week</h3>{_weekday_chart(wd)}{wd_caption}</div></div>

<h2>Suggested next steps</h2>
<ol class="actions">{actions}</ol>
<p class="note">{e_(ins["rules_note"])}</p>

<details class="appx" open><summary>Detailed numbers, checks &amp; definitions</summary>
<h3>Platform breakdown</h3><div class="tw"><table>
<tr><th>Platform</th><th>Posts</th><th>Impressions</th><th>Reach</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th>
<th>Interactions</th><th>Eng. rate</th><th>Clicks</th><th>CTR</th><th>Bookings</th><th>Followers</th><th>Growth</th></tr>{rows}</table></div>
{f'<h3>Compared with {e_(p["previous_period"]["label"])}</h3><div class="tw"><table><tr><th>Measure</th><th>{e_(p["previous_period"]["label"])}</th><th>{e_(p["period"]["label"])}</th><th>Change</th></tr>{cmp_rows}</table></div>' if comp else ''}
<h3>Week by week</h3><div class="tw"><table><tr><th>Week</th><th>Reach</th><th>Interactions</th><th>Bookings</th></tr>{weeks}</table></div>
<h3>Written summary</h3><ul>{narrative}</ul>
<h3>Accuracy checks</h3><ul class="checks">{checks}</ul>
<h3>What the terms mean</h3><dl class="gloss">
<dt>Impressions</dt><dd>How many times your posts were shown. One person can see a post several times.</dd>
<dt>People reached</dt><dd>How many different people saw your posts.</dd>
<dt>Interactions</dt><dd>Likes + comments + shares + saves.</dd>
<dt>Engagement rate</dt><dd>Interactions ÷ people reached — how many of the people who saw you reacted.</dd>
<dt>Website clicks</dt><dd>Clicks from social posts through to the hotel website.</dd>
<dt>Click-through rate (CTR)</dt><dd>Website clicks ÷ impressions.</dd>
<dt>Bookings from social</dt><dd>Website bookings traced back to a click from social media.</dd>
<dt>New followers</dt><dd>Followers on the last day minus followers on the first day of the period.</dd>
</dl>
<h3>Approval</h3><p>Prepared by <b>{e_(p["generated_by"]["name"])}</b> on {e_(_when(p["generated_at"]))}.</p>{approval}
</details>

<footer>Report #{rep["id"]} · content SHA-256 <span class="hash">{e_(rep["content_hash"])}</span><br>
Prototype using synthetic data for a fictional hotel.</footer>
</div></body></html>"""
