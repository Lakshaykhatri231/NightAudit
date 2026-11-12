/**
 * Who is signed in, plus a little per-tab memory. All real data lives on the Python server
 * (one SQLite file per hotel). The only thing kept here is the raw text of the last CSV posted
 * in this tab, so the upload panel can show each rejected line next to the server's reason.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { DEMO_PASSWORD, userById } from "./directory";
import type { HotelId, ImportError, ImportRecord, Inspection, ManifestLine, User } from "./types";

interface AuditState {
  /** False until the server has told us who (if anyone) is signed in. */
  sessionLoaded: boolean;
  user: User | null;
  /** Bumped after every change so pages and the nav badge refetch. */
  tick: number;
  bump: () => void;
  signIn: (userId: string) => Promise<User>;
  signOut: () => Promise<void>;
  inspection: (hotel: HotelId) => Inspection | null;
  upload: (hotel: HotelId, fileName: string, text: string) => Promise<Inspection>;
  /** After a page reload there is no raw text, so fall back to the server's record of the last import. */
  rememberHistory: (hotel: HotelId, last: ImportRecord | undefined) => void;
}

const AuditContext = createContext<AuditState | null>(null);

/** Splits the CSV into data lines and attaches the server's rejection reasons to each. */
function pairLinesWithErrors(text: string, errors: ImportError[]): ManifestLine[] {
  const reasonsByLine = new Map<number, string[]>();
  for (const e of errors) if (e.row != null) reasonsByLine.set(e.row, [...(reasonsByLine.get(e.row) ?? []), e.reason]);
  const lines: ManifestLine[] = [];
  text.replace(/\r\n?/g, "\n").split("\n").forEach((raw, i) => {
    if (i === 0 || raw.trim() === "") return; // header or blank line
    const line = i + 1; // the server counts lines from 1, header included
    const reasons = reasonsByLine.get(line) ?? [];
    lines.push({ line, raw, ok: reasons.length === 0, reasons });
  });
  return lines;
}

export function AuditProvider({ children }: { children: ReactNode }) {
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tick, setTick] = useState(0);
  const [inspections, setInspections] = useState<Partial<Record<HotelId, Inspection>>>({});

  useEffect(() => {
    api
      .me()
      .then((me) => setUser(userById(me.username)))
      .catch(() => setUser(null))
      .finally(() => setSessionLoaded(true));
  }, []);

  const bump = useCallback(() => setTick((t) => t + 1), []);

  const value = useMemo<AuditState>(
    () => ({
      sessionLoaded,
      user,
      tick,
      bump,
      signIn: async (userId) => {
        const me = await api.login(userId, DEMO_PASSWORD);
        const u = userById(me.username)!;
        setUser(u);
        setInspections({});
        bump();
        return u;
      },
      signOut: async () => {
        await api.logout().catch(() => undefined);
        setUser(null);
        setInspections({});
        bump();
      },
      inspection: (hotel) => inspections[hotel] ?? null,
      upload: async (hotel, fileName, text) => {
        const at = new Date().toISOString();
        let ins: Inspection;
        try {
          const r = await api.uploadCsv(hotel, fileName, text);
          ins = {
            fileName: r.filename, at, total: r.rows_total, accepted: r.rows_ok, rejected: r.rows_rejected,
            errors: r.errors, lines: pairLinesWithErrors(text, r.errors), refused: null,
          };
        } catch (e) {
          // A whole-file refusal is shown in the panel; anything else (e.g. signed out) is a real error.
          if (!(e instanceof ApiError) || e.status === 401) throw e;
          const kind = e.status === 403 ? "wrong_hotel" : /missing required columns/i.test(e.message) ? "columns" : "other";
          ins = { fileName, at, total: 0, accepted: 0, rejected: 0, errors: [], lines: null, refused: { kind, message: e.message } };
        }
        setInspections((s) => ({ ...s, [hotel]: ins }));
        bump();
        return ins;
      },
      rememberHistory: (hotel, last) => {
        if (!last) return;
        setInspections((s) =>
          s[hotel]
            ? s
            : {
                ...s,
                [hotel]: {
                  fileName: last.filename, at: last.created_at, total: last.rows_total, accepted: last.rows_ok,
                  rejected: last.rows_rejected, errors: last.errors, lines: null,
                  refused: last.status === "rejected_wrong_client" ? { kind: "wrong_hotel", message: last.errors[0]?.reason ?? "" } : null,
                },
              },
        );
      },
    }),
    [sessionLoaded, user, tick, bump, inspections],
  );

  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
}

export function useAudit() {
  const value = useContext(AuditContext);
  if (!value) throw new Error("useAudit must be used inside <AuditProvider>");
  return value;
}

/** Loads data from the API. Pass `null` to skip loading. Reloads when `deps` change or after any bump(). */
export function useResource<T>(load: (() => Promise<T>) | null, deps: unknown[]) {
  const { tick } = useAudit();
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    if (!load) return;
    let current = true; // ignore a response that arrives after the page moved on
    setState((s) => ({ ...s, loading: true }));
    load()
      .then((data) => current && setState({ data, error: null, loading: false }))
      .catch((error) => current && setState({ data: null, error, loading: false }));
    return () => {
      current = false;
    };
    // `load` is a new function on every render, so only `deps` decide when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return state;
}
