import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { AccessDenied, Loading, LoadFailed, SignInRequired } from "@/components/desk/Gates";
import { Stamp } from "@/components/desk/Stamp";
import { api, ApiError } from "@/lib/audit/api";
import { HOTELS, isHotelId, reportCode } from "@/lib/audit/directory";
import { fmtInt, fmtMonth } from "@/lib/audit/format";
import { useAudit, useResource } from "@/lib/audit/store";
import { PLATFORMS, PLATFORM_LABEL, type HotelId, type Platform, type Report, type ReportSummary, type SamplePreview } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/data/$hotelId")({
  // ?month=YYYY-MM preselects a month (the report page links here with it).
  validateSearch: (s: Record<string, unknown>): { month?: string | undefined } => ({
    month: typeof s["month"] === "string" ? s["month"] : undefined,
  }),
  beforeLoad: ({ params }) => {
    if (!isHotelId(params.hotelId)) throw notFound();
  },
  head: ({ params }) => ({ meta: [{ title: `${isHotelId(params.hotelId) ? HOTELS[params.hotelId].name : "Hotel"} raw ledger — Night Audit` }] }),
  component: DataPage,
});

/** Numeric CSV columns: [column name, table heading]. */
const NUM_COLS = [
  ["followers", "Followers"],
  ["impressions", "Impressions"],
  ["reach", "Reach"],
  ["likes", "Likes"],
  ["comments", "Comments"],
  ["shares", "Shares"],
  ["saves", "Saves"],
  ["link_clicks", "Clicks"],
  ["posts", "Posts"],
  ["website_bookings_attributed", "Bookings"],
] as const;

function DataPage() {
  const { hotelId } = Route.useParams();
  const hotel = hotelId as HotelId;
  const { sessionLoaded, user } = useAudit();
  const preview = useResource(sessionLoaded && user ? () => api.samplePreview(hotel) : null, [hotel, user?.id]);
  const reports = useResource(sessionLoaded && user ? () => api.reports(hotel) : null, [hotel, user?.id]);
  if (!sessionLoaded) return <Loading />;
  if (!user) return <SignInRequired />;
  if (preview.error instanceof ApiError && preview.error.status === 403)
    return <AccessDenied what={`${HOTELS[hotel].name} sample data`} reason={preview.error.message} />;
  if (preview.error) return <LoadFailed message={preview.error.message} />;
  if (!preview.data) return <Loading label="Unrolling the ledger…" />;
  return <Ledger hotel={hotel} data={preview.data} reports={reports.data ?? []} />;
}

type Row = SamplePreview["rows"][number];
const num = (r: Row, k: string) => Number(r.values[k] ?? 0);

/**
 * Adds up the accepted rows for a period, in the browser, as an independent check on the report.
 * Deliberately shares no code with the server. It is only shown next to the report, never used in it.
 */
function recount(rows: Row[], start: string, end: string) {
  const inPeriod = rows.filter((r) => r.ok && r.values["date"]! >= start && r.values["date"]! <= end);
  const sum = (k: string) => inPeriod.reduce((a, r) => a + num(r, k), 0);
  // Followers is a running total: growth is last day minus first day, per platform.
  const followers = PLATFORMS.reduce((acc, p) => {
    const pr = inPeriod.filter((r) => r.values["platform"]?.toLowerCase() === p).sort((a, b) => a.values["date"]!.localeCompare(b.values["date"]!));
    return pr.length ? acc + num(pr[pr.length - 1]!, "followers") - num(pr[0]!, "followers") : acc;
  }, 0);
  return {
    rows: inPeriod.length,
    impressions: sum("impressions"),
    reach: sum("reach"),
    engagements: sum("likes") + sum("comments") + sum("shares") + sum("saves"),
    link_clicks: sum("link_clicks"),
    posts: sum("posts"),
    bookings: sum("website_bookings_attributed"),
    followers,
  };
}

function Ledger({ hotel, data, reports }: { hotel: HotelId; data: SamplePreview; reports: ReportSummary[] }) {
  const h = HOTELS[hotel];
  const search = Route.useSearch();
  const months = useMemo(
    () => [...new Set(data.rows.filter((r) => r.ok).map((r) => r.values["date"]!.slice(0, 7)))].sort().reverse(),
    [data.rows],
  );
  const [month, setMonth] = useState<string>(search.month && months.includes(search.month) ? search.month : (months[0] ?? "all"));
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [onlyBad, setOnlyBad] = useState(false);

  // The latest report for the chosen month, if any, is what the recount is compared with.
  const latest = reports.filter((r) => r.period_start.slice(0, 7) === month).sort((a, b) => b.id - a.id)[0];
  const report = useResource(latest ? () => api.report(hotel, latest.id) : null, [hotel, latest?.id]);

  // Rejected rows are listed whatever month is picked (their date may be the thing that is wrong).
  const shown = data.rows.filter(
    (r) =>
      (month === "all" || r.values["date"]?.startsWith(month) || !r.ok) &&
      (platform === "all" || r.values["platform"]?.toLowerCase() === platform) &&
      (!onlyBad || !r.ok),
  );
  const okShown = shown.filter((r) => r.ok);
  const totals = Object.fromEntries(NUM_COLS.map(([k]) => [k, okShown.reduce((a, r) => a + num(r, k), 0)]));

  return (
    <div className={`tone-${h.tone}`}>
      <section className="border-b-[1.5px] border-ink bg-tone-tint">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <Link to="/hotels/$hotelId" params={{ hotelId: hotel }} className="font-mono text-sm uppercase tracking-[0.14em] text-ink-soft hover:text-ink">
            ← {h.name} desk
          </Link>
          <p className="eyebrow mt-6">The raw ledger · {data.filename}</p>
          <h1 className="font-display mt-2 text-5xl font-medium leading-none md:text-7xl">
            Don't take our word<span className="text-stamp">.</span> <span className="italic text-tone">Count it.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-ink-soft">
            This is {h.name}'s synthetic data exactly as it goes into the system: {fmtInt(data.rows_total)} rows, one per day per platform.
            The server marks every row it would accept or reject. Below, your browser re-adds the accepted rows on its own and lines them up
            against the report.
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <a
              href={api.sampleCsvUrl(hotel)}
              className="inline-flex items-center gap-2 border-[1.5px] border-ink bg-paper px-4 py-2 font-mono text-sm uppercase tracking-[0.12em] shadow-[3px_3px_0_var(--ink)] hover:-translate-y-px"
            >
              <Download className="h-4 w-4" /> Download the CSV
            </a>
            <span className="inline-flex items-center gap-3 font-mono text-sm">
              <span className="text-approve">✓ {fmtInt(data.rows_ok)} accepted</span>
              <span className="text-stamp">✕ {fmtInt(data.rows_rejected)} rejected</span>
            </span>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-6">
          <label className="flex flex-col gap-1 font-mono text-[0.8rem] uppercase tracking-[0.12em] text-ink-soft">
            Month
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="border-[1.5px] border-ink bg-paper px-2 py-1.5 font-mono text-sm text-ink">
              {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
              <option value="all">All months</option>
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[0.8rem] uppercase tracking-[0.12em] text-ink-soft">Platform</span>
            <div className="flex flex-wrap gap-2">
              {(["all", ...PLATFORMS] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={cn("border-[1.5px] border-ink px-3 py-1.5 font-mono text-[0.8rem] uppercase tracking-[0.1em]", platform === p ? "bg-ink text-paper" : "bg-paper hover:bg-highlight/50")}
                >
                  {p === "all" ? "All" : PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 font-mono text-[0.8rem] uppercase tracking-[0.12em]">
            <input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} className="h-4 w-4 accent-[var(--stamp)]" />
            Rejected rows only
          </label>
        </div>

        {/* Recount vs report */}
        {month !== "all" && <Recount rows={data.rows} report={report.data} month={month} hotel={hotel} />}

        {/* The table */}
        <div className="sheet mt-8 max-h-[40rem] overflow-auto">
          <table className="w-full min-w-[60rem] border-collapse font-mono text-[0.82rem] tabular-nums">
            <thead className="sticky top-0 z-10 bg-paper-deep">
              <tr className="border-b-[1.5px] border-ink text-left text-[0.75rem] uppercase tracking-[0.08em] text-ink-soft">
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Platform</th>
                {NUM_COLS.map(([k, l]) => <th key={k} className="px-3 py-2 text-right">{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.line} className={cn("border-b border-border", r.ok ? "hover:bg-highlight/30" : "bg-stamp/10")}>
                  <td className="px-3 py-1.5 text-ink-faint">L{r.line}</td>
                  <td className={cn("px-3 py-1.5", !r.ok && "strike-ink")}>{r.values["date"]}</td>
                  <td className={cn("px-3 py-1.5", !r.ok && "strike-ink")}>{r.values["platform"]}</td>
                  {r.ok ? (
                    NUM_COLS.map(([k]) => <td key={k} className="px-3 py-1.5 text-right">{fmtInt(num(r, k))}</td>)
                  ) : (
                    <td colSpan={NUM_COLS.length} className="px-3 py-1.5 font-display text-[0.95rem] italic text-stamp">
                      ✕ Rejected by the server: {r.reason}
                    </td>
                  )}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={NUM_COLS.length + 3} className="px-3 py-6 text-center italic text-ink-soft">No rows match these filters.</td></tr>
              )}
            </tbody>
            {okShown.length > 0 && (
              <tfoot className="sticky bottom-0 bg-ink text-paper">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>Sum of {fmtInt(okShown.length)} accepted rows</td>
                  {NUM_COLS.map(([k]) => (
                    <td key={k} className="px-3 py-2 text-right">{k === "followers" ? "—" : fmtInt(totals[k])}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-soft">
          Followers is a running total, so it is never added up. The report counts growth as the last day minus the first day, per platform.
        </p>
      </div>
    </div>
  );
}

/** The report's figures side by side with the browser's own sums. */
function Recount({ rows, report, month, hotel }: { rows: Row[]; report: Report | null; month: string; hotel: HotelId }) {
  if (!report) {
    return (
      <div className="mt-8 border-[1.5px] border-dashed border-ink p-5 text-ink-soft">
        No report has been composed for {fmtMonth(month)} yet. Compose one from the desk and this page will check it against these rows.
      </div>
    );
  }
  const o = report.payload.summary.overall;
  const c = recount(rows, report.period_start, report.period_end);
  const lines: [string, number, number][] = [
    ["Rows used", o.row_count, c.rows],
    ["Times seen (impressions)", o.impressions, c.impressions],
    ["People reached", o.reach, c.reach],
    ["Interactions (likes + comments + shares + saves)", o.engagements, c.engagements],
    ["Website clicks", o.link_clicks, c.link_clicks],
    ["Posts", o.posts, c.posts],
    ["Bookings from social", o.website_bookings_attributed, c.bookings],
    ["New followers (last day − first day)", report.payload.summary.followers.net, c.followers],
  ];
  const ok = lines.filter(([, a, b]) => a === b).length;
  const all = ok === lines.length;
  return (
    <div className="sheet-lifted relative mt-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Recount · {fmtMonth(month)}</p>
          <h2 className="font-display mt-1 text-3xl">
            Report {reportCode(hotel, report)} against the raw rows
          </h2>
          <p className="mt-1 text-ink-soft">
            Left: what the report says. Right: the accepted rows below, added up again in your browser.
          </p>
        </div>
        <Stamp tone={all ? "approve" : "stamp"} rotate={-6} animate className="text-lg">
          {all ? `Matches ${ok}/${lines.length}` : `${lines.length - ok} differ`}
        </Stamp>
      </div>
      <table className="mt-5 w-full font-mono text-[0.9rem] tabular-nums">
        <thead>
          <tr className="border-b-[1.5px] border-ink text-left text-[0.75rem] uppercase tracking-[0.1em] text-ink-soft">
            <th className="py-2">Figure</th>
            <th className="py-2 text-right">Report says</th>
            <th className="py-2 text-right">Rows add up to</th>
            <th className="w-12 py-2 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map(([label, a, b]) => (
            <tr key={label} className="border-b border-dotted border-ink/40">
              <td className="py-2 font-sans text-base">{label}</td>
              <td className="py-2 text-right">{fmtInt(a)}</td>
              <td className="py-2 text-right">{fmtInt(b)}</td>
              <td className={cn("py-2 text-right font-bold", a === b ? "text-approve" : "text-stamp")}>{a === b ? "✓" : "✕"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!all && (
        <p className="mt-3 text-sm text-ink-soft">
          A difference here usually means a different file was uploaded for this month, so the report was built from that file instead of the sample.
        </p>
      )}
      <Link
        to="/reports/$hotelId/$reportId"
        params={{ hotelId: hotel, reportId: String(report.id) }}
        className="mt-4 inline-block font-mono text-sm uppercase tracking-[0.14em] underline decoration-stamp decoration-2 underline-offset-4"
      >
        Open the report →
      </Link>
    </div>
  );
}
