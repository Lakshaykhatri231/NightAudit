import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AccessDenied, Loading, LoadFailed, SignInRequired } from "@/components/desk/Gates";
import { StatusStamp } from "@/components/desk/Stamp";
import { Columns, Delta, Funnel, FollowerLine, GrowthBars, HeadToHead, PairBars, PLATFORM_COLOR, ShareBars, TrendChart, weekLabel } from "@/components/desk/charts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/audit/api";
import { HOTELS, isHotelId, nameOf, reportCode } from "@/lib/audit/directory";
import { fmtChange, fmtInt, fmtPct, fmtStamp } from "@/lib/audit/format";
import { useAudit, useResource } from "@/lib/audit/store";
import { PLATFORMS, PLATFORM_LABEL, type Change, type CheckStatus, type HotelId, type PlatformTotals, type Report } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reports/$hotelId/$reportId")({
  beforeLoad: ({ params }) => {
    if (!isHotelId(params.hotelId) || !/^\d+$/.test(params.reportId)) throw notFound();
  },
  head: ({ params }) => {
    const name = isHotelId(params.hotelId) ? HOTELS[params.hotelId].name : "Hotel";
    return { meta: [{ title: `Report #${params.reportId} · ${name} — Night Audit` }] };
  },
  component: ReportPage,
});

/** Plain-English description of each of the server's five checks, in order (hotelreports/report.py reconcile()). */
const CHECK_PLAIN = [
  "SQLite re-adds every total on its own and must agree with the Python figures to the last unit.",
  "Instagram + Facebook + TikTok must add up exactly to every overall figure.",
  "Likes, comments, shares and saves are re-added and the engagement rate worked out again.",
  "The day-by-day figures must sum to the month's engagements, reach, clicks and bookings.",
  "Every day of the period is present for every platform. A gap is flagged, not hidden.",
];

function ReportPage() {
  const { hotelId, reportId } = Route.useParams();
  const hotel = hotelId as HotelId;
  const id = Number(reportId);
  const { sessionLoaded, user } = useAudit();
  const res = useResource(sessionLoaded && user ? () => api.report(hotel, id) : null, [hotel, id, user?.id]);
  if (!sessionLoaded) return <Loading />;
  if (!user) return <SignInRequired />;
  if (res.error instanceof ApiError && res.error.status === 403)
    return <AccessDenied what={`report #${id} in ${HOTELS[hotel].vault}`} reason={res.error.message} />;
  if (res.error instanceof ApiError && res.error.status === 404)
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="font-display text-4xl">No such report on file.</h1>
        <Link to="/hotels/$hotelId" params={{ hotelId: hotel }} className="mt-6 inline-block underline">Back to the desk</Link>
      </div>
    );
  if (res.error) return <LoadFailed message={res.error.message} />;
  if (!res.data) return <Loading label="Fetching the report…" />;
  return <Broadsheet report={res.data} hotel={hotel} />;
}

// Years and day-of-month numbers are dates, not figures, so they are not highlighted.
const MONTH_AFTER = /^\s?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/;
const isDatePart = (num: string, after: string) => /^(19|20)\d\d$/.test(num) || MONTH_AFTER.test(after);

/** Highlights the figures inside a server-written sentence. Purely visual: the text is not changed. */
function Figures({ text }: { text: string }) {
  // Splitting on a capture group puts the numbers at the odd indexes.
  const parts = text.split(/([+−-]?\d[\d,]*(?:\.\d+)?%?)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 && !isDatePart(p, parts[i + 1] ?? "") ? (
          <span key={i} className="figure-link">{p}</span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** A numbered report section with a title and an optional one-line intro. */
function Section({ no, title, kicker, children, className }: { no: string; title: string; kicker?: string | undefined; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 border-t-[1.5px] border-ink pt-6", className)}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="figure-mono text-sm text-ink-faint">{no}</span>
        <h2 className="font-display text-3xl leading-tight md:text-4xl">{title}</h2>
      </div>
      {kicker && <p className="mt-1 max-w-3xl text-base text-ink-soft">{kicker}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** "October 2026" → "Oct". */
const shortMonth = (label: string) => label.split(" ")[0]!.slice(0, 3);

const CHECK_RING: Record<CheckStatus, string> = { pass: "border-approve text-approve", warn: "border-brass-deep text-brass-deep", fail: "border-stamp text-stamp" };
const CHECK_FILL: Record<CheckStatus, string> = { pass: "bg-approve", warn: "bg-brass-deep", fail: "bg-stamp" };
const CHECK_MARK: Record<CheckStatus, string> = { pass: "✓", warn: "!", fail: "✕" };

function Broadsheet({ report: r, hotel }: { report: Report; hotel: HotelId }) {
  const h = HOTELS[hotel];
  const p = r.payload;
  const s = p.summary;
  const o = s.overall;
  const ins = p.insights;
  const cmp = p.comparison;
  const failed = p.checks.filter((c) => c.status === "fail").length;
  const passed = p.checks.filter((c) => c.status === "pass").length;
  const platforms = PLATFORMS.filter((x) => s.by_platform[x]);
  /** One figure per platform, e.g. perPlatform((t) => t.share_of_reach). */
  const perPlatform = (pick: (t: PlatformTotals) => number | null) => Object.fromEntries(platforms.map((x) => [x, pick(s.by_platform[x]!)]));
  const cur = shortMonth(p.period.label);
  const prev = p.previous_period.used ? shortMonth(p.previous_period.label) : "Prev";
  const verdictTone =
    ins.verdict.tone === "good" ? "bg-approve text-paper" : ins.verdict.tone === "bad" ? "bg-stamp text-paper" : "bg-brass text-ink";

  const kpis: { key: string; label: string; value: string; plain?: string | undefined; change?: Change | undefined; fmt: (n: number) => string }[] = [
    { key: "reach", label: "People reached", value: fmtInt(o.reach), plain: ins.plain["reach"], change: cmp?.["reach"], fmt: fmtInt },
    { key: "engagements", label: "Interactions", value: fmtInt(o.engagements), plain: ins.plain["engagements"], change: cmp?.["engagements"], fmt: fmtInt },
    { key: "engagement_rate", label: "Engagement rate", value: fmtPct(o.engagement_rate), plain: ins.plain["engagement_rate"], change: cmp?.["engagement_rate"], fmt: (n) => fmtPct(n) },
    { key: "link_clicks", label: "Website clicks", value: fmtInt(o.link_clicks), plain: ins.plain["link_clicks"], change: cmp?.["link_clicks"], fmt: fmtInt },
    { key: "bookings", label: "Bookings from social", value: fmtInt(o.website_bookings_attributed), plain: ins.plain["bookings"], change: cmp?.["website_bookings_attributed"], fmt: fmtInt },
    { key: "followers", label: "New followers", value: `${s.followers.net >= 0 ? "+" : ""}${fmtInt(s.followers.net)}`, plain: ins.plain["follower_growth"], change: cmp?.["follower_net_growth"], fmt: (n) => `${n >= 0 ? "+" : ""}${fmtInt(n)}` },
  ];

  const avgDay = s.weekday.average_day;

  return (
    <div className={`tone-${h.tone} mx-auto max-w-6xl px-4 py-10 md:px-6`}>
      <Link to="/hotels/$hotelId" params={{ hotelId: hotel }} className="font-mono text-sm uppercase tracking-[0.14em] text-ink-soft hover:text-ink">
        ← {h.name} desk
      </Link>

      <article className="sheet-lifted relative mt-5 px-5 pb-12 pt-6 md:px-12">
        <div className="flex flex-wrap justify-between gap-2 font-mono text-[0.8rem] uppercase tracking-[0.12em] text-ink-soft">
          <span>Report {reportCode(hotel, r)}</span>
          <span>Compiled by {p.generated_by.name} · {fmtStamp(p.generated_at)}</span>
          <span title={r.content_hash}>SHA-256 {r.content_hash.slice(0, 12)}…</span>
        </div>

        <header className="rule-double mt-4 border-b-[1.5px] border-ink pb-5 pt-5 text-center">
          <h1 className="font-display text-[clamp(2.6rem,7vw,5.6rem)] font-semibold leading-[0.9] tracking-[-0.025em]">
            The <span className="text-tone italic">{h.name}</span> Dispatch
          </h1>
          <p className="mt-4 font-mono text-sm uppercase tracking-[0.2em]">
            Monthly social report · {p.period.label}
            {p.previous_period.used ? ` · compared with ${p.previous_period.label}` : ""}
          </p>
        </header>

        {/* Keyed on status so the stamp animates again when the status changes. */}
        <div key={r.status} className="absolute -top-6 right-4 z-10 md:right-10">
          <StatusStamp status={r.status} animate className="bg-paper text-sm md:text-xl" />
        </div>

        {/* Verdict */}
        <div className="mt-8 grid gap-5 md:grid-cols-[auto_1fr] md:items-center">
          <span className={cn("inline-flex items-center gap-2 self-start border-[1.5px] border-ink px-4 py-2 font-mono text-base font-semibold uppercase tracking-[0.16em] shadow-[3px_3px_0_var(--ink)]", verdictTone)}>
            {ins.verdict.icon} {ins.verdict.label}
          </span>
          <p className="font-display text-3xl leading-tight md:text-[2.6rem]"><Figures text={ins.headline} /></p>
        </div>

        {/* Scoreboard */}
        <div className="mt-10 grid gap-px overflow-hidden border-[1.5px] border-ink bg-ink sm:grid-cols-2 lg:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.key} className="flex flex-col bg-paper p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-mono text-[0.8rem] uppercase tracking-[0.14em] text-ink-soft">{k.label}</p>
                <Delta change={k.change?.change} />
              </div>
              <p className="font-display mt-2 text-5xl font-light tabular-nums leading-none">{k.value}</p>
              {k.plain && <p className="mt-2 text-[0.95rem] leading-snug text-ink-soft">{k.plain}</p>}
              {k.change && (
                <div className="mt-auto pt-4">
                  <PairBars prev={k.change.previous} cur={k.change.current} prevLabel={prev} curLabel={cur} format={k.fmt} />
                </div>
              )}
            </div>
          ))}
        </div>
        <Link
          to="/data/$hotelId"
          params={{ hotelId: hotel }}
          search={{ month: p.period.start.slice(0, 7) }}
          className="group mt-4 flex flex-wrap items-center justify-between gap-3 border-[1.5px] border-dashed border-ink bg-paper-deep/60 px-5 py-3 hover:bg-highlight/40"
        >
          <span className="text-base">
            <b>Don't take our word for it.</b> See the {fmtInt(o.row_count)} raw rows behind these numbers and re-add them yourself.
          </span>
          <span className="font-mono text-sm uppercase tracking-[0.14em] group-hover:text-stamp">Open the raw data →</span>
        </Link>
        {!p.previous_period.used && p.previous_period.note && (
          <p className="mt-3 text-sm italic text-ink-soft">{p.previous_period.note}</p>
        )}

        <div className="mt-14 space-y-14">
          <Section no="01" title={`${p.period.label}, day by day`} kicker={p.previous_period.used ? `Solid line: this month. Dashed: ${p.previous_period.label}, matched day for day. Hover to read any day.` : "Hover to read any day."}>
            <TrendChart
              daily={s.daily}
              previous={p.previous_daily}
              curLabel={cur}
              prevLabel={prev}
              totals={{ engagements: cmp?.["engagements"], reach: cmp?.["reach"], link_clicks: cmp?.["link_clicks"], bookings: cmp?.["website_bookings_attributed"] }}
            />
          </Section>

          <div className="grid gap-14 lg:grid-cols-2 lg:gap-10">
            <Section no="02" title="From seen to booked" kicker={`${ins.plain["bookings"] ?? ""}. Widths use a log scale so the small final steps stay visible.`}>
              <Funnel steps={s.funnel} />
            </Section>
            <Section no="03" title="Who brought what" kicker="Each bar is 100%. Compare who brings the audience with who brings the bookings.">
              <ShareBars
                platforms={platforms}
                rows={[
                  { label: "People reached", shares: perPlatform((t) => t.share_of_reach) },
                  { label: "Interactions", shares: perPlatform((t) => t.share_of_engagements) },
                  { label: "Bookings", shares: perPlatform((t) => t.share_of_bookings) },
                ]}
              />
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {platforms.map((x) => (
                  <div key={x} className="border-[1.5px] border-ink bg-paper p-3" style={{ borderTop: `6px solid ${PLATFORM_COLOR[x]}` }}>
                    <p className="font-display text-xl">{PLATFORM_LABEL[x]}</p>
                    <div className="mt-1 space-y-0.5 text-[0.85rem] leading-snug">
                      {(ins.platform_roles[x] ?? []).length === 0 ? (
                        <p className="text-ink-faint">Steady contributor</p>
                      ) : (
                        ins.platform_roles[x]!.map((role) => <p key={role}>{role}</p>)
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <Section no="04" title="Platform head-to-head" kicker="Each metric has its own scale. ★ marks the leader.">
            <HeadToHead
              platforms={platforms}
              metrics={[
                { label: "Engagement rate", hint: "interactions ÷ people reached", values: perPlatform((t) => t.engagement_rate), format: (n) => fmtPct(n) },
                { label: "Interactions per post", hint: "how hard each post works", values: perPlatform((t) => t.engagements_per_post), format: fmtInt },
                { label: "Click-through rate", hint: "website clicks ÷ times seen", values: perPlatform((t) => t.ctr), format: (n) => fmtPct(n) },
                { label: "Bookings", hint: "website bookings attributed to the platform", values: perPlatform((t) => t.website_bookings_attributed), format: fmtInt },
              ]}
            />
          </Section>

          <div className="grid gap-14 lg:grid-cols-[1.4fr_1fr] lg:gap-10">
            <Section no="05" title="The follower climb" kicker={`From ${fmtInt(s.followers.start)} to ${fmtInt(s.followers.end)} followers across all platforms.`}>
              <FollowerLine daily={s.daily} />
            </Section>
            <Section no="06" title="New followers by platform">
              <GrowthBars
                rows={platforms
                  .filter((x) => s.followers.by_platform[x])
                  .map((x) => ({ platform: x, net: s.followers.by_platform[x]!.net, pct: s.followers.by_platform[x]!.pct, end: s.followers.by_platform[x]!.end }))}
              />
            </Section>
          </div>

          <div className="grid gap-14 lg:grid-cols-2 lg:gap-10">
            <Section
              no="07"
              title="The rhythm of the week"
              kicker={s.weekday.best ? `${s.weekday.best}s are the best day, ${fmtChange(s.weekday.best_uplift)} above an average day.` : undefined}
            >
              <Columns
                ariaLabel="Average interactions by weekday"
                highlight={s.weekday.best}
                refLine={avgDay != null ? { value: avgDay, label: `average day ${fmtInt(avgDay)}` } : undefined}
                bars={s.weekday.by_weekday.map((w) => ({
                  key: w.weekday,
                  label: w.weekday.slice(0, 3),
                  value: w.avg_engagements ?? 0,
                  tip: (
                    <>
                      <p className="text-brass">{w.weekday}</p>
                      <p><b>{fmtInt(w.avg_engagements)}</b> interactions on average</p>
                      <p className="text-paper/70">across {w.days} {w.days === 1 ? "day" : "days"}</p>
                    </>
                  ),
                }))}
              />
            </Section>
            <Section
              no="08"
              title="Week by week"
              kicker={s.top_week ? `Strongest week: ${weekLabel(s.top_week)} with ${fmtInt(s.top_week.engagements)} interactions.` : undefined}
            >
              <Columns
                ariaLabel="Interactions per week"
                highlight={s.top_week?.week_start ?? null}
                bars={s.weekly.map((w) => ({
                  key: w.week_start,
                  label: weekLabel(w),
                  sub: `${fmtInt(w.bookings)} bkg`,
                  value: w.engagements,
                  tip: (
                    <>
                      <p className="text-brass">{weekLabel(w)}</p>
                      <p><b>{fmtInt(w.engagements)}</b> interactions</p>
                      <p>{fmtInt(w.reach)} reached · {fmtInt(w.bookings)} bookings</p>
                    </>
                  ),
                }))}
              />
            </Section>
          </div>

          {/* Wins / watch-outs / next steps */}
          <Section no="09" title="What it means">
            <div className="grid gap-5 md:grid-cols-3">
              {([
                ["Wins", ins.wins, "border-approve", "bg-approve text-paper", "▲"],
                ["Watch-outs", ins.watch_outs, "border-stamp", "bg-stamp text-paper", "!"],
                ["Next steps", ins.actions, "border-ink", "bg-ink text-paper", "→"],
              ] as const).map(([title, items, border, chip, mark]) => (
                <div key={title} className={cn("border-[1.5px] bg-paper p-5 shadow-[4px_4px_0_var(--ink)]", border)}>
                  <h3 className="font-display text-2xl">{title}</h3>
                  <ul className="mt-4 space-y-4">
                    {items.length === 0 && <li className="text-base italic text-ink-soft">Nothing to flag.</li>}
                    {items.map((t, i) => (
                      <li key={i} className="grid grid-cols-[1.8rem_1fr] gap-2 text-base leading-relaxed">
                        <span className={cn("flex h-6 w-6 items-center justify-center font-mono text-sm font-bold", chip)}>{title === "Next steps" ? i + 1 : mark}</span>
                        <span><Figures text={t} /></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          <Section no="10" title="The month in words" kicker="The same story as text, for people who prefer to read it.">
            <div className="text-lg leading-[1.8] md:columns-2 md:gap-10 [column-rule:1px_solid_var(--border)]">
              {p.narrative.map((para, i) => (
                <p key={i} className={cn("mb-4 break-inside-avoid-column", i === 0 && "drop-cap")}>
                  <Figures text={para} />
                </p>
              ))}
              <p className="break-inside-avoid-column font-mono text-[0.8rem] uppercase tracking-[0.12em] text-ink-faint">
                Written by fixed rules from the figures. No language model.
              </p>
            </div>
          </Section>

          <Section no="11" title="The five checks" kicker={`${passed} of ${p.checks.length} passed${failed ? `, ${failed} failed` : ""}. Every number above was re-added independently before you could read it.`}>
            <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
              {p.checks.map((c, i) => (
                <li key={c.name} className="flex flex-col items-start">
                  <span className={cn("flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed font-display text-2xl", CHECK_RING[c.status])}>
                    <span className={cn("flex h-11 w-11 items-center justify-center rounded-full text-paper", CHECK_FILL[c.status])}>
                      {CHECK_MARK[c.status]}
                    </span>
                  </span>
                  <p className="mt-3 font-mono text-[0.75rem] text-ink-faint">CHECK {i + 1}</p>
                  <p className="font-display text-xl leading-tight">{c.name}</p>
                  <p className="mt-1 text-[0.95rem] leading-relaxed text-ink-soft">{CHECK_PLAIN[i]}</p>
                  <p className="figure-mono mt-2 border-t border-dotted border-ink/40 pt-1 text-[0.8rem]">{c.detail}</p>
                </li>
              ))}
            </ol>
            <p className="mt-6 font-mono text-[0.78rem] uppercase tracking-[0.12em] text-ink-faint">{ins.rules_note}</p>
          </Section>
        </div>
      </article>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <Countersign report={r} hotel={hotel} />
        <Takeaway report={r} hotel={hotel} />
      </div>
    </div>
  );
}

/** Who compiled and who signed, plus the buttons for whatever the current user may do next. */
function Countersign({ report: r, hotel }: { report: Report; hotel: HotelId }) {
  const { user, bump } = useAudit();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const failed = r.payload.checks.some((c) => c.status === "fail");
  const isAuthor = user?.id === r.created_by;
  const isReviewer = user?.role === "reviewer";
  const code = reportCode(hotel, r);

  const act = async (action: "submit" | "approve" | "reject") => {
    setBusy(true);
    try {
      await api.transition(hotel, r.id, action, note);
      bump();
      if (action === "submit") toast("Sent to the reviewer", { description: `${code} is waiting for a second pair of eyes.` });
      if (action === "approve") toast.success(`${code} approved`, { description: "Copies can now be taken away." });
      if (action === "reject") toast(`${code} returned to ${nameOf(r.created_by)}`);
      setNote("");
    } catch (e) {
      toast.error("The server refused", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet p-6">
      <p className="eyebrow">Countersign slip</p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[0.78rem] uppercase tracking-[0.14em] text-ink-soft">Compiled by</p>
          <p className="font-display mt-1 border-b-[1.5px] border-ink pb-1 text-2xl italic">{nameOf(r.created_by)}</p>
        </div>
        <div>
          <p className="font-mono text-[0.78rem] uppercase tracking-[0.14em] text-ink-soft">{r.status === "rejected" ? "Returned by" : "Approved by"}</p>
          <p className="font-display mt-1 border-b-[1.5px] border-dashed border-ink pb-1 text-2xl italic text-ink-soft">
            {r.reviewed_by ? nameOf(r.reviewed_by) : "—"}
          </p>
        </div>
      </div>

      {r.review_comment && <p className="font-display mt-5 border-l-2 border-stamp pl-3 italic text-ink-soft">“{r.review_comment}”</p>}

      <div className="mt-6">
        {isAuthor && r.status === "draft" && (
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="stamp" disabled={failed || busy} onClick={() => act("submit")}>Submit for review</Button>
            <p className="text-sm text-ink-soft">
              {failed ? "A check failed, so the server will not accept this for review." : "You cannot approve your own report. Your hotel's reviewer will."}
            </p>
          </div>
        )}
        {r.status === "rejected" && user?.role === "analyst" && (
          <p className="text-sm text-ink-soft">Returned. Fix the data if needed and compose a fresh report from the desk.</p>
        )}
        {isAuthor && r.status === "pending_review" && (
          <p className="text-sm text-ink-soft">With the reviewer. You'll see their decision here; you cannot sign it yourself.</p>
        )}
        {isReviewer && r.status === "pending_review" && (
          <div className="space-y-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the analyst (required to return it)"
              className="rounded-sm border-[1.5px] border-ink bg-paper font-display italic"
            />
            <div className="flex flex-wrap gap-4">
              <Button variant="approve" disabled={busy} onClick={() => act("approve")}>Stamp approved</Button>
              <Button variant="paper" disabled={busy} onClick={() => act("reject")}>Return with note</Button>
            </div>
          </div>
        )}
        {isReviewer && r.status === "draft" && <p className="text-sm text-ink-soft">The analyst hasn't submitted this yet.</p>}
        {r.status === "approved" && (
          <p className="text-sm text-ink-soft">Signed off {r.reviewed_at ? fmtStamp(r.reviewed_at) : ""}. Every step is in the audit log.</p>
        )}
      </div>

      {r.events.length > 0 && (
        <ol className="figure-mono mt-6 space-y-1 border-t border-dashed border-ink pt-4 text-[0.8rem] text-ink-soft">
          {[...r.events].reverse().map((e) => (
            <li key={e.id}>
              {fmtStamp(e.at)} · <span className="uppercase text-ink">{e.action.replace("_", " ")}</span> · {nameOf(e.actor)}
              {e.comment && !e.action.startsWith("exported") ? ` · “${e.comment}”` : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Download links for the approved report. Locked until approval (the server enforces this too). */
function Takeaway({ report: r, hotel }: { report: Report; hotel: HotelId }) {
  const { bump } = useAudit();
  const open = r.status === "approved";
  const code = reportCode(hotel, r);
  return (
    <div className="border-[1.5px] border-ink p-6">
      <p className="eyebrow">Take-away copies</p>
      <div className="relative mt-4">
        <div className="grid grid-cols-3 gap-3">
          {(["html", "csv", "json"] as const).map((fmt) => (
            <a
              key={fmt}
              href={open ? api.exportUrl(hotel, r.id, fmt) : undefined}
              aria-disabled={!open}
              onClick={() => {
                if (!open) return;
                toast(`${code}.${fmt} downloaded`, { description: "Hash re-verified by the server and logged." });
                setTimeout(bump, 800); // give the server a moment to log the export, then refresh
              }}
              className={cn(
                "group flex aspect-[3/4] flex-col justify-between border-[1.5px] border-ink bg-paper p-2 text-left shadow-[3px_3px_0_var(--ink)] transition-transform",
                open ? "hover:-translate-y-1" : "pointer-events-none",
              )}
            >
              <span className="font-mono text-[0.72rem] text-ink-faint">#{r.id}</span>
              <span className="font-display text-2xl uppercase">.{fmt}</span>
            </a>
          ))}
        </div>
        {!open && (
          <div className="hatch absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper/80 text-center">
            <Lock className="h-6 w-6" />
            <p className="font-mono text-[0.82rem] uppercase tracking-[0.16em]">Locked until approved</p>
          </div>
        )}
      </div>
    </div>
  );
}
