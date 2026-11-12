/** Full-page states shared by every page: loading, signed out, access denied, server unreachable. */
import { Link } from "@tanstack/react-router";
import { useAudit } from "@/lib/audit/store";
import { Stamp } from "./Stamp";

export function SignInRequired() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="eyebrow">The desk is closed to strangers</p>
      <h1 className="font-display mt-4 text-5xl leading-[0.95]">Collect your key first.</h1>
      <p className="mt-4 text-ink-soft">Every page here is tied to a person, so every action can be logged against a name.</p>
      <Link to="/" className="mt-8 inline-block font-mono text-xs uppercase tracking-[0.2em] underline decoration-stamp decoration-2 underline-offset-4">
        Go to the front desk →
      </Link>
    </div>
  );
}

/** Shown when the server answered 403. The server has already logged the attempt. */
export function AccessDenied({ what, reason }: { what: string; reason: string }) {
  const { user } = useAudit();
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="sheet relative overflow-hidden px-8 py-12 md:px-14">
        <p className="eyebrow">File request · {what}</p>
        <h1 className="font-display mt-3 text-4xl">Confidential ledger</h1>
        <div className="mt-8 space-y-3" aria-hidden>
          {[92, 78, 85, 60, 88, 70, 95, 50].map((w, i) => (
            <div key={i} className="flex gap-3">
              <span className="figure-mono w-8 text-xs text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="redacted h-4" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Stamp tone="stamp" rotate={-14} animate className="bg-paper/70 text-3xl md:text-6xl">
            Access denied
          </Stamp>
        </div>
      </div>
      <div className="mt-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div className="max-w-xl text-ink-soft">
          <p className="figure-mono mb-2 inline-block border border-stamp px-2 py-0.5 text-[0.82rem] text-stamp">HTTP 403 · from the server</p>
          <p>
            {reason} This attempt by <b className="text-ink">{user?.name ?? "an anonymous visitor"}</b> has been written to the audit log.
          </p>
        </div>
        <Link to="/audit" className="font-mono text-xs uppercase tracking-[0.2em] underline decoration-stamp decoration-2 underline-offset-4">
          See it in the log →
        </Link>
      </div>
    </div>
  );
}

export function Loading({ label = "Unlocking the ledger…" }: { label?: string }) {
  return <div className="mx-auto max-w-6xl px-6 py-24"><p className="eyebrow animate-pulse">{label}</p></div>;
}

export function LoadFailed({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="eyebrow">The desk could not fetch that</p>
      <h1 className="font-display mt-4 text-4xl leading-[0.95]">{message}</h1>
      <p className="mt-4 text-ink-soft">Is the Python server running? Start it with <code className="figure-mono">python3 app.py</code>.</p>
    </div>
  );
}
