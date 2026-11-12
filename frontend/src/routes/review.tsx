import { createFileRoute, Link } from "@tanstack/react-router";
import { AccessDenied, Loading, LoadFailed, SignInRequired } from "@/components/desk/Gates";
import { StatusStamp } from "@/components/desk/Stamp";
import { api } from "@/lib/audit/api";
import { HOTELS, nameOf, reportCode } from "@/lib/audit/directory";
import { fmtMonth, fmtStamp } from "@/lib/audit/format";
import { useAudit, useResource } from "@/lib/audit/store";
import type { HotelId, ReportSummary } from "@/lib/audit/types";

export const Route = createFileRoute("/review")({
  head: () => ({ meta: [{ title: "Reviewer's in-tray — Night Audit" }] }),
  component: ReviewPage,
});

function ReviewPage() {
  const { sessionLoaded, user } = useAudit();
  const reports = useResource(sessionLoaded && user ? () => api.reports(user.hotel) : null, [user?.id]);
  if (!sessionLoaded) return <Loading />;
  if (!user) return <SignInRequired />;
  if (user.role !== "reviewer")
    return (
      <AccessDenied
        what="reviewer in-tray"
        reason="Only reviewers can open the in-tray. Whoever compiles a report is never the one who approves it."
      />
    );
  if (reports.error) return <LoadFailed message={reports.error.message} />;

  const all = reports.data ?? [];
  const pending = all.filter((r) => r.status === "pending_review");
  const decided = all.filter((r) => r.status === "approved" || r.status === "rejected");
  const hotel = user.hotel;

  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <p className="eyebrow">Signed in as {user.name} · {user.title}</p>
      <h1 className="font-display mt-3 text-6xl font-medium leading-none md:text-7xl">
        The in-tray<span className="text-stamp">.</span>
      </h1>
      <p className="mt-4 max-w-xl text-ink-soft">
        Nothing leaves {HOTELS[hotel].name} without your signature. Open a report, read it, and stamp it approved or send it back with a note.
      </p>

      <h2 className="eyebrow mt-14">Awaiting your signature · {reports.loading && !reports.data ? "…" : pending.length}</h2>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {reports.data && pending.length === 0 && (
          <p className="font-display text-2xl italic text-ink-soft">The tray is empty. Go and get a coffee.</p>
        )}
        {pending.map((r, i) => (
          <Envelope key={r.id} report={r} hotel={hotel} tilt={i % 2 ? 1.2 : -1.2} />
        ))}
      </div>

      {decided.length > 0 && (
        <>
          <h2 className="eyebrow mt-16">Already decided</h2>
          <div className="mt-3 border-t-[1.5px] border-ink">
            {decided.map((r) => (
              <Link
                key={r.id}
                to="/reports/$hotelId/$reportId"
                params={{ hotelId: hotel, reportId: String(r.id) }}
                className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border py-4 hover:bg-highlight/30 md:grid-cols-[10rem_1fr_12rem_auto]"
              >
                <span className="figure-mono text-xs">{reportCode(hotel, r)}</span>
                <span className="font-display text-xl">{HOTELS[hotel].name} · {fmtMonth(r.period_start.slice(0, 7))}</span>
                <span className="figure-mono hidden text-xs text-ink-soft md:block">{r.reviewed_at && fmtStamp(r.reviewed_at)}</span>
                <StatusStamp status={r.status} className="text-[0.72rem]" />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A report waiting for sign-off, drawn as a slightly tilted card. */
function Envelope({ report: r, hotel, tilt }: { report: ReportSummary; hotel: HotelId; tilt: number }) {
  const h = HOTELS[hotel];
  return (
    <Link
      to="/reports/$hotelId/$reportId"
      params={{ hotelId: hotel, reportId: String(r.id) }}
      className={`tone-${h.tone} sheet-lifted group relative block p-6 transition-transform hover:rotate-0`}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <div className="absolute inset-x-0 top-0 h-2 bg-tone" />
      <div className="flex items-start justify-between">
        <div>
          <p className="figure-mono text-xs text-ink-soft">{reportCode(hotel, r)}</p>
          <p className="font-display text-tone mt-1 text-4xl">{h.name}</p>
          <p className="font-display text-xl italic">{fmtMonth(r.period_start.slice(0, 7))}</p>
        </div>
        <StatusStamp status={r.status} className="text-[0.74rem]" />
      </div>
      <div className="figure-mono mt-6 grid grid-cols-2 gap-2 border-t border-dashed border-ink pt-3 text-[0.8rem]">
        <span>From: {nameOf(r.created_by)}</span>
        <span>Filed: {fmtStamp(r.created_at)}</span>
      </div>
      <span className="mt-5 block font-mono text-[0.82rem] uppercase tracking-[0.16em] group-hover:text-stamp">Open and read →</span>
    </Link>
  );
}
