import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api } from "@/lib/audit/api";
import { useAudit, useResource } from "@/lib/audit/store";
import { MiniKey } from "./KeyTag";

const navLink =
  "font-mono text-[0.78rem] uppercase tracking-[0.12em] text-ink-soft hover:text-ink data-[status=active]:text-ink data-[status=active]:underline data-[status=active]:decoration-stamp data-[status=active]:decoration-2 data-[status=active]:underline-offset-[6px]";

/** Page frame: top strip, header with navigation and sign-out, footer. */
export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut, sessionLoaded } = useAudit();
  const navigate = useNavigate();
  // Reviewers get a badge on "Review" counting reports waiting for them.
  const reviewer = sessionLoaded && user?.role === "reviewer" ? user : null;
  const reports = useResource(reviewer ? () => api.reports(reviewer.hotel) : null, [reviewer?.id]);
  const pending = reviewer ? (reports.data ?? []).filter((r) => r.status === "pending_review").length : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-1.5 font-mono text-[0.76rem] uppercase tracking-[0.2em]">
          <span className="whitespace-nowrap">Synthetic data edition</span>
          <span className="hidden whitespace-nowrap xl:inline">Two sealed databases · Five checks · Zero AI-written words</span>
          <span className="whitespace-nowrap text-brass">38 tests passing</span>
        </div>
      </div>

      <header className="border-b-[1.5px] border-ink">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link to="/" className="group flex items-baseline gap-2">
            <span className="relative top-0.5 inline-block h-5 w-5 rounded-full bg-ink shadow-[inset_-6px_-2px_0_var(--paper)] transition-transform group-hover:-rotate-45" aria-hidden />
            <span className="font-display text-3xl font-semibold italic leading-none tracking-tight">Night Audit</span>
          </Link>

          <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link to="/" className={navLink} activeOptions={{ exact: true }}>Front desk</Link>
            <Link to="/hotels/$hotelId" params={{ hotelId: "harbourlight" }} className={navLink}>Harbourlight</Link>
            <Link to="/hotels/$hotelId" params={{ hotelId: "pinecrest" }} className={navLink}>Pinecrest</Link>
            <Link to="/review" className={navLink}>
              Review{pending > 0 && <sup className="ml-0.5 rounded-full bg-stamp px-1.5 py-px text-[0.72rem] text-paper">{pending}</sup>}
            </Link>
            {sessionLoaded && user && (
              <Link to="/data/$hotelId" params={{ hotelId: user.hotel }} className={navLink}>Raw data</Link>
            )}
            <Link to="/audit" className={navLink}>Audit log</Link>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {sessionLoaded && user ? (
              <>
                <MiniKey user={user} />
                <button
                  onClick={async () => {
                    await signOut();
                    navigate({ to: "/" });
                  }}
                  className="font-mono text-[0.78rem] uppercase tracking-[0.16em] text-ink-soft underline-offset-4 hover:text-stamp hover:underline"
                >
                  Return key
                </button>
              </>
            ) : (
              <span className="font-mono text-[0.78rem] uppercase tracking-[0.16em] text-ink-faint">Not signed in</span>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-24 border-t-[1.5px] border-ink">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 md:grid-cols-3">
          <p className="font-display text-xl italic">Night Audit</p>
          <p className="text-sm text-ink-soft">
            Harbourlight and Pinecrest are fictional hotels. Every number on this site is synthetic.
          </p>
          <p className="figure-mono text-xs text-ink-soft md:text-right">
            Plain Python core · JSON API · 38 passing tests · <a className="underline" href="/classic">classic UI</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
