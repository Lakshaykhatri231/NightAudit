import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied, Loading, LoadFailed, SignInRequired } from "@/components/desk/Gates";
import { Stamp, StatusStamp } from "@/components/desk/Stamp";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/audit/api";
import { analystOf, HOTELS, isHotelId, nameOf, reportCode } from "@/lib/audit/directory";
import { fmtInt, fmtMonth, fmtStamp, monthsBetween } from "@/lib/audit/format";
import { useAudit, useResource } from "@/lib/audit/store";
import type { HotelId, Inspection, Overview } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

// Same list as hotelreports/importer.py REQUIRED_COLUMNS. (An optional client_id column lets the
// server spot a file meant for the other hotel.)
const REQUIRED_COLUMNS = [
  "date", "platform", "followers", "impressions", "reach", "likes", "comments", "shares", "saves",
  "link_clicks", "posts", "website_bookings_attributed",
];

export const Route = createFileRoute("/hotels/$hotelId")({
  beforeLoad: ({ params }) => {
    if (!isHotelId(params.hotelId)) throw notFound();
  },
  head: ({ params }) => {
    const name = isHotelId(params.hotelId) ? HOTELS[params.hotelId].name : "Hotel";
    return { meta: [{ title: `${name} desk — Night Audit` }] };
  },
  component: HotelDesk,
});

function HotelDesk() {
  const { hotelId } = Route.useParams();
  const hotel = hotelId as HotelId;
  const { sessionLoaded, user } = useAudit();
  // The server decides access: it answers 403 for the other hotel.
  const overview = useResource(sessionLoaded && user ? () => api.overview(hotel) : null, [hotel, user?.id]);
  if (!sessionLoaded) return <Loading />;
  if (!user) return <SignInRequired />;
  if (overview.error instanceof ApiError && overview.error.status === 403)
    return <AccessDenied what={HOTELS[hotel].vault} reason={overview.error.message} />;
  if (overview.error) return <LoadFailed message={overview.error.message} />;
  if (!overview.data) return <Loading label="Opening the vault…" />;
  return <Desk hotel={hotel} overview={overview.data} />;
}

function Desk({ hotel, overview }: { hotel: HotelId; overview: Overview }) {
  const h = HOTELS[hotel];
  const { user, inspection, upload, rememberHistory, bump } = useAudit();
  const reports = useResource(() => api.reports(hotel), [hotel]);
  const history = useResource(() => api.imports(hotel), [hotel]);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAnalyst = user?.role === "analyst";
  const ins = inspection(hotel);

  useEffect(() => rememberHistory(hotel, history.data?.[0]), [hotel, history.data, rememberHistory]);

  // Months that have data, for the "Compose the report" picker. Defaults to the latest.
  const months = useMemo(
    () => (overview.data_range.start && overview.data_range.end ? monthsBetween(overview.data_range.start, overview.data_range.end) : []),
    [overview.data_range.start, overview.data_range.end],
  );
  const [month, setMonth] = useState<string>("");
  const chosen = months.find((m) => m.ym === month) ?? months[0];

  const sendFile = async (fileName: string, text: string) => {
    setBusy(true);
    try {
      const res = await upload(hotel, fileName, text);
      if (res.refused?.kind === "wrong_hotel") toast.error("Wrong hotel's file", { description: res.refused.message });
      else if (res.refused) toast.error("That ledger was refused", { description: res.refused.message });
      else toast(`${fmtInt(res.total)} rows inspected by the server`, { description: `${res.accepted} accepted · ${res.rejected} rejected` });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onFile = async (f: File | undefined) => {
    if (f) await sendFile(f.name, await f.text());
  };
  const sendSample = async () => sendFile(`${hotel}_metrics_sample.csv`, await api.sampleCsv(hotel));

  const onCompose = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const r = await api.compose(hotel, chosen.start, chosen.end);
      bump();
      navigate({ to: "/reports/$hotelId/$reportId", params: { hotelId: hotel, reportId: String(r.id) } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`tone-${h.tone}`}>
      <section className="border-b-[1.5px] border-ink bg-tone-tint">
        <div className="mx-auto grid max-w-6xl items-end gap-6 px-6 py-10 md:grid-cols-[1fr_auto]">
          <div>
            <p className="eyebrow">Property desk · {h.code} · {h.vault}</p>
            <h1 className="font-display text-tone mt-3 text-6xl font-medium leading-none tracking-tight md:text-8xl">{h.name}</h1>
            <p className="mt-3 text-lg italic text-ink-soft">{h.place}</p>
            <p className="figure-mono mt-4 text-xs text-ink-soft">
              {overview.data_range.rows
                ? `${fmtInt(overview.data_range.rows)} rows on file · ${overview.data_range.start} → ${overview.data_range.end}`
                : "No numbers on file yet"}
            </p>
          </div>
          <div className="sheet isolate hidden rotate-2 p-2 md:block">
            <img src={h.image} alt="" width={1024} height={768} className="etching h-36 w-48 object-cover" />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-3xl">
              <span className="figure-mono mr-3 text-base text-ink-faint">01</span>Check-in
            </h2>
            <div className="flex flex-wrap items-center gap-5">
              <Link
                to="/data/$hotelId"
                params={{ hotelId: hotel }}
                className="font-mono text-xs uppercase tracking-[0.16em] text-ink border-b-[1.5px] border-ink hover:text-stamp hover:border-stamp"
              >
                Open sample data →
              </Link>
              <a className="font-mono text-xs uppercase tracking-[0.16em] text-ink border-b-[1.5px] border-dashed border-ink hover:text-stamp hover:border-stamp" href={api.sampleCsvUrl(hotel)}>
                Download CSV
              </a>
            </div>
          </div>

          {isAnalyst ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                onFile(e.dataTransfer.files[0]);
              }}
              className={cn("mt-5 border-[1.5px] border-dashed border-ink p-8 transition-colors", dragging ? "bg-highlight/50" : "bg-paper-deep/50")}
            >
              <div className="mx-auto h-3 w-2/3 rounded-full border-[1.5px] border-ink bg-ink/80 shadow-[inset_0_2px_4px_var(--ink)]" aria-hidden />
              <p className="font-display mt-6 text-center text-2xl italic">Post this month's CSV through the slot</p>
              <p className="mt-2 text-center text-sm text-ink-soft">
                Drop a file here, choose one, or use the synthetic sample (two months, three bad rows planted in it).
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-4">
                <Button disabled={busy} onClick={() => fileRef.current?.click()}>Choose a CSV</Button>
                <Button disabled={busy} variant="paper" onClick={sendSample}>Use the sample ledger</Button>
                {/* Clearing the value lets the same file be chosen twice in a row. */}
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-1.5">
                {REQUIRED_COLUMNS.map((c) => (
                  <span key={c} className="figure-mono border border-border bg-paper px-1.5 py-0.5 text-[0.78rem] text-ink-soft">{c}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 border-[1.5px] border-dashed border-ink p-6 text-ink-soft">
              Reviewers read this vault but cannot post numbers into it. Uploads belong to {analystOf(hotel).name}.
            </div>
          )}

          {ins && (
            <div className="mt-14">
              <h2 className="font-display text-3xl">
                <span className="figure-mono mr-3 text-base text-ink-faint">02</span>Inspection
              </h2>
              <p className="figure-mono mt-1 text-xs text-ink-soft">
                {ins.fileName} · inspected by the server {fmtStamp(ins.at)}
              </p>
              <Manifest ins={ins} />
            </div>
          )}

          {isAnalyst && months.length > 0 && (
            <div className="sheet-lifted mt-10 flex flex-col items-start justify-between gap-4 p-6 md:flex-row md:items-center">
              <div>
                <h3 className="font-display text-2xl">
                  <span className="figure-mono mr-3 text-base text-ink-faint">03</span>Compose the report
                </h3>
                <p className="mt-1 text-sm text-ink-soft">
                  Figures come from the rows on file. Five checks run before you see a word.
                </p>
                <label className="mt-3 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.14em]">
                  Month
                  <select
                    value={chosen?.ym ?? ""}
                    onChange={(e) => setMonth(e.target.value)}
                    className="border-[1.5px] border-ink bg-paper px-2 py-1 font-mono text-xs"
                  >
                    {months.map((m) => (
                      <option key={m.ym} value={m.ym}>
                        {fmtMonth(m.ym)}{m.full ? "" : " (partial)"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Button variant="stamp" size="lg" disabled={busy} onClick={onCompose}>Compose &amp; check →</Button>
            </div>
          )}
        </div>

        <aside>
          <p className="eyebrow">Reports on file</p>
          <div className="mt-3 border-t-[1.5px] border-ink">
            {reports.data?.length === 0 && <p className="py-6 text-sm italic text-ink-soft">Nothing filed yet.</p>}
            {(reports.data ?? []).map((r) => (
              <Link
                key={r.id}
                to="/reports/$hotelId/$reportId"
                params={{ hotelId: hotel, reportId: String(r.id) }}
                className="group block border-b border-border py-4 hover:bg-highlight/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="figure-mono text-xs text-ink-soft">{reportCode(hotel, r)}</p>
                    <p className="font-display text-xl group-hover:underline">{fmtMonth(r.period_start.slice(0, 7))}</p>
                    <p className="figure-mono mt-1 text-[0.78rem] text-ink-soft">By {nameOf(r.created_by)} · {fmtStamp(r.created_at)}</p>
                  </div>
                  <StatusStamp status={r.status} className="text-[0.72rem]" />
                </div>
              </Link>
            ))}
          </div>

          {(history.data?.length ?? 0) > 0 && (
            <>
              <p className="eyebrow mt-10">Files received</p>
              <div className="mt-3 border-t-[1.5px] border-ink">
                {history.data!.slice(0, 6).map((i) => (
                  <div key={i.id} className="border-b border-border py-3">
                    <p className="figure-mono truncate text-[0.82rem]">{i.filename}</p>
                    <p className={cn("figure-mono mt-0.5 text-[0.78rem]", i.status === "rejected_wrong_client" ? "text-stamp" : "text-ink-soft")}>
                      {i.status === "rejected_wrong_client" ? "Refused · another hotel's rows" : `${i.rows_ok} ok · ${i.rows_rejected} rejected`} · {nameOf(i.imported_by)}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Result of an upload: counts, then the rejected lines (or every line) with the server's reasons. */
function Manifest({ ins }: { ins: Inspection }) {
  const [showAll, setShowAll] = useState(false);
  if (ins.refused)
    return (
      <div className="sheet mt-5 flex flex-col items-center gap-4 p-10 text-center">
        <Stamp tone="stamp" rotate={-6} animate className="text-2xl">
          {ins.refused.kind === "wrong_hotel" ? "Wrong hotel" : "Wrong ledger"}
        </Stamp>
        <p className="mt-2 max-w-lg text-ink-soft">{ins.refused.message}</p>
        {ins.refused.kind === "wrong_hotel" && <p className="figure-mono text-xs">Nothing was imported. The attempt is in the import history.</p>}
      </div>
    );

  const { total, accepted, rejected } = ins;
  const pct = total ? (accepted / total) * 100 : 0;
  const lines = ins.lines ? (showAll ? ins.lines : ins.lines.filter((l) => !l.ok)) : null;

  return (
    <div className="mt-5">
      <div className="grid grid-cols-3 border-[1.5px] border-ink">
        {([["Uploaded", total, "text-ink"], ["Accepted", accepted, "text-approve"], ["Rejected", rejected, "text-stamp"]] as const).map(([l, n, c], i) => (
          <div key={l} className={cn("px-5 py-4", i > 0 && "border-l-[1.5px] border-ink")}>
            <p className="eyebrow">{l}</p>
            <p className={cn("font-display mt-1 text-5xl font-light tabular-nums", c)}>{fmtInt(n)}</p>
          </div>
        ))}
      </div>
      <div className="flex h-2 border-x-[1.5px] border-b-[1.5px] border-ink">
        <div className="bg-approve" style={{ width: `${pct}%` }} />
        <div className="hatch flex-1 bg-stamp/60" />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="eyebrow">{showAll ? "Full manifest" : "Turned away at the door"}</p>
        {ins.lines && (
          <Button variant="ledger" size="sm" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show rejected only" : `Show all ${fmtInt(total)} rows`}
          </Button>
        )}
      </div>

      <div className="sheet mt-3 max-h-[28rem] overflow-auto">
        {/* Without the file text (after a reload) only the server's error list is available. */}
        {lines === null
          ? ins.errors.map((e, i) => (
              <div key={i} className="grid grid-cols-[3rem_1fr] gap-x-3 border-b border-border px-4 py-2.5 last:border-b-0">
                <span className="figure-mono pt-0.5 text-xs text-ink-faint">L{e.row ?? "–"}</span>
                <span className="font-display text-sm italic leading-snug text-stamp">✕ {e.reason}</span>
              </div>
            ))
          : lines.map((l, i) => (
              <div
                key={l.line}
                className="grid animate-tick-in grid-cols-[3rem_1fr] gap-x-3 border-b border-border px-4 py-2.5 last:border-b-0 md:grid-cols-[3rem_1fr_17rem]"
                style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
              >
                <span className="figure-mono pt-0.5 text-xs text-ink-faint">L{l.line}</span>
                <span className={cn("figure-mono truncate text-xs", l.ok ? "text-ink" : "strike-ink text-ink-soft")}>{l.raw}</span>
                <span className="col-start-2 md:col-start-auto">
                  {l.ok ? (
                    <span className="figure-mono text-xs text-approve">✓ accepted</span>
                  ) : (
                    <span className="font-display text-sm italic leading-snug text-stamp">✕ {l.reasons.join("; ")}</span>
                  )}
                </span>
              </div>
            ))}
        {(lines?.length === 0 || (lines === null && ins.errors.length === 0)) && (
          <p className="p-6 text-sm italic text-ink-soft">Every row passed inspection.</p>
        )}
      </div>
    </div>
  );
}
