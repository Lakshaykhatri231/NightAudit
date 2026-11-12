import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loading, LoadFailed, SignInRequired } from "@/components/desk/Gates";
import { api } from "@/lib/audit/api";
import { HOTELS, nameOf } from "@/lib/audit/directory";
import { fmtClock, fmtDay } from "@/lib/audit/format";
import { useAudit, useResource } from "@/lib/audit/store";
import type { ReportEvent } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/audit")({
  head: () => ({ meta: [{ title: "Audit trail — Night Audit" }] }),
  component: AuditPage,
});

/** How an entry is coloured: refused (red), returned report (brass) or normal. */
const outcome = (e: ReportEvent) => (e.action === "access_denied" ? "denied" : e.action === "rejected" ? "rejected" : "ok");

/** Server action name → the code-style label printed on the roll. */
const LABEL: Record<string, string> = {
  signed_in: "session.sign_in",
  signed_out: "session.sign_out",
  imported: "upload.inspect",
  generated: "report.compose",
  submitted: "report.submit",
  approved: "report.approve",
  rejected: "report.return",
  access_denied: "vault.open",
};
const label = (a: string) => LABEL[a] ?? (a.startsWith("exported_") ? `report.export.${a.slice(9)}` : a);

const FILTERS: [string, (e: ReportEvent) => boolean][] = [
  ["Everything", () => true],
  ["Refused", (e) => e.action === "access_denied"],
  ["Uploads", (e) => e.action === "imported"],
  ["Sign-offs", (e) => e.action === "approved" || e.action === "rejected"],
  ["Downloads", (e) => e.action.startsWith("exported")],
];

function AuditPage() {
  const { sessionLoaded, user } = useAudit();
  const [filter, setFilter] = useState(0);
  const events = useResource(sessionLoaded && user ? () => api.audit(user.hotel) : null, [user?.id]);
  if (!sessionLoaded) return <Loading />;
  if (!user) return <SignInRequired />;
  if (events.error) return <LoadFailed message={events.error.message} />;

  const all = events.data ?? [];
  const shown = all.filter(FILTERS[filter]?.[1] ?? (() => true));
  const denied = all.filter((e) => e.action === "access_denied").length;
  const h = HOTELS[user.hotel];

  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <div className="grid gap-10 lg:grid-cols-[1fr_34rem]">
        <div>
          <p className="eyebrow">Audit trail · {h.vault}</p>
          <h1 className="font-display mt-3 text-6xl font-medium leading-[0.95] md:text-7xl">
            Nothing happens
            <br />
            <span className="italic">off the books.</span>
          </h1>
          <p className="mt-5 max-w-md text-ink-soft">
            Sign-ins, uploads, reports, approvals, refusals and downloads are written by the server into {h.name}'s own
            database, with a name and a time. You only ever see your own hotel's roll.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {FILTERS.map(([l], i) => (
              <button
                key={l}
                onClick={() => setFilter(i)}
                className={cn(
                  "border-[1.5px] border-ink px-3 py-1.5 font-mono text-[0.8rem] uppercase tracking-[0.14em] transition-colors",
                  filter === i ? "bg-ink text-paper" : "bg-paper hover:bg-highlight/50",
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <p className="mt-12 max-w-md font-mono text-[0.8rem] uppercase leading-relaxed tracking-[0.14em] text-ink-faint">
            To reset the demo: stop the server, run <span className="text-ink">python3 cli.py reset</span>, start it again.
          </p>
        </div>

        <div className="receipt-edge bg-paper-deep px-6 py-10 shadow-[0_20px_40px_-20px_var(--ink)]">
          <div className="text-center font-mono text-xs uppercase tracking-[0.2em]">
            <p className="font-semibold">*** Night Audit ***</p>
            <p className="mt-1 text-ink-soft">Audit roll · {h.name}</p>
          </div>
          <div className="my-4 border-t border-dashed border-ink" />
          <ol className="figure-mono max-h-[36rem] space-y-3 overflow-auto text-[0.84rem]">
            {events.data && shown.length === 0 && <li className="text-center text-ink-soft">— nothing printed —</li>}
            {shown.map((e, i) => {
              const o = outcome(e);
              return (
                <li key={e.id} className="animate-tick-in" style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }}>
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-soft">{fmtDay(e.at)} {fmtClock(e.at)}</span>
                    <span className={cn("font-semibold uppercase", o === "denied" ? "text-stamp" : o === "rejected" ? "text-brass-deep" : "text-ink")}>
                      {o === "ok" ? label(e.action) : `${label(e.action)} · ${o}`}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>{nameOf(e.actor)}</span>
                    <span className="text-ink-soft">{e.report_id ? `report #${e.report_id}` : h.code}</span>
                  </div>
                  {e.comment && <p className={cn("break-words text-ink-soft", o === "denied" && "text-stamp")}>{e.comment}</p>}
                </li>
              );
            })}
          </ol>
          <div className="my-4 border-t border-dashed border-ink" />
          <div className="figure-mono space-y-1 text-[0.84rem]">
            <p className="flex justify-between"><span>ENTRIES</span><span>{all.length}</span></p>
            <p className="flex justify-between text-stamp"><span>REFUSED</span><span>{denied}</span></p>
          </div>
          <p className="mt-6 text-center font-mono text-[0.78rem] uppercase tracking-[0.2em] text-ink-soft">Thank you for staying honest</p>
        </div>
      </div>
    </div>
  );
}
