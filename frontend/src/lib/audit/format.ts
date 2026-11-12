/** Number and date formatting for display. Missing values show as "n/a". */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const fmtInt = (n: number | null | undefined) => (n == null ? "n/a" : Math.round(n).toLocaleString("en-US"));
/** The API sends ratios as fractions (0.067); show them as percentages. */
export const fmtPct = (x: number | null | undefined, digits = 2) => (x == null ? "n/a" : `${(x * 100).toFixed(digits)}%`);
/** A signed change, e.g. 0.123 → "+12.3%". */
export const fmtChange = (x: number | null | undefined) =>
  x == null ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
/** "2026-10" → "October 2026". */
export const fmtMonth = (ym: string) => {
  const [y = 0, m = 1] = ym.split("-").map(Number);
  return `${MONTHS[m - 1] ?? ""} ${y}`;
};
export const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

/**
 * The calendar months touched by [start, end] (YYYY-MM-DD), latest first. Each month is clipped to
 * the range, and `full` says whether the whole month is covered.
 */
export function monthsBetween(start: string, end: string) {
  const out: { ym: string; start: string; end: string; full: boolean }[] = [];
  let [y, m] = start.slice(0, 7).split("-").map(Number) as [number, number];
  const lastMonth = end.slice(0, 7);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthStart = `${ym}-01`;
    const monthEnd = `${ym}-${String(daysInMonth).padStart(2, "0")}`;
    const s = monthStart < start ? start : monthStart;
    const e = monthEnd > end ? end : monthEnd;
    out.push({ ym, start: s, end: e, full: s === monthStart && e === monthEnd });
    if (ym >= lastMonth) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.reverse();
}
