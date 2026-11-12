/**
 * Report charts, hand-drawn in SVG (no chart library). They only draw numbers the server already
 * computed; nothing is recalculated here.
 *
 * Platform colours were picked to stay distinguishable for colour-blind readers. Two of them are
 * low-contrast on paper, so bars and lines are always labelled with text as well.
 */
import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { fmtChange, fmtInt, fmtPct } from "@/lib/audit/format";
import { PLATFORM_LABEL, type Change, type DailyPoint, type Platform, type WeekPoint } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

export const PLATFORM_COLOR: Record<Platform, string> = {
  instagram: "#2a78d6",
  facebook: "#eb6834",
  tiktok: "#1baf7a",
};
/** Text colour to use on top of each platform colour. */
const ON_PLATFORM: Record<Platform, string> = { instagram: "#ffffff", facebook: "var(--ink)", tiktok: "var(--ink)" };

const INK = "var(--ink)";
const SOFT = "var(--ink-soft)";
const FAINT = "var(--ink-faint)";
const GRID = "oklch(0.22 0.025 55 / 0.12)";
const TONE = "var(--tone)"; // the current hotel's colour

/** Short axis numbers: 950, 1.2k, 45k, 1.3M. */
const compact = (n: number) =>
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3)}k` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`;

/** A y-axis with round tick values: about 4 equal steps of 1, 2, 2.5 or 5 × a power of ten. */
function niceScale(v: number, steps = 4) {
  const raw = Math.max(v, 1e-9) / steps;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  return { max: step * Math.ceil(v / step - 1e-9) || step, ticks: Array.from({ length: Math.ceil(v / step - 1e-9) + 1 }, (_, i) => i * step) };
}

/** Rounds a maximum up to a tidy number (used for bar charts, which have no tick labels). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

const dayLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const weekdayOf = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

/** SVG path through the points, e.g. "M0,10L5,8L10,3". */
const linePath = (vals: number[], x: (i: number) => number, y: (v: number) => number) =>
  vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

/** Which point (0..last) the mouse is over, from its position across the plot area. */
function hoverIndex(e: MouseEvent<SVGRectElement>, last: number) {
  const r = e.currentTarget.getBoundingClientRect();
  return Math.min(Math.max(Math.round(((e.clientX - r.left) / r.width) * last), 0), last);
}

/** Tracks an element's width so SVG charts can be drawn at real pixel size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => setW(entries[0]?.contentRect.width ?? el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Dark hover tooltip, kept inside the chart's width. */
function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 14, 0), Math.max(width - 210, 0));
  return (
    <div
      className="pointer-events-none absolute z-20 w-[200px] border-[1.5px] border-ink bg-ink px-3 py-2 font-mono text-[0.78rem] leading-snug text-paper shadow-[4px_4px_0_var(--brass)]"
      style={{ left, top: Math.max(y - 10, 0) }}
    >
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[0.78rem] text-ink-soft">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-2">
          <svg width="22" height="10" aria-hidden>
            <line x1="1" y1="5" x2="21" y2="5" stroke={it.color} strokeWidth={it.dashed ? 2 : 3} strokeDasharray={it.dashed ? "4 3" : undefined} strokeLinecap="round" />
          </svg>
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Change-vs-previous badge: green up, red down, grey when within ±2%. */
export function Delta({ change }: { change: number | null | undefined }) {
  if (change == null) return <span className="font-mono text-[0.8rem] text-ink-faint">no comparison</span>;
  const flat = Math.abs(change) < 0.02; // same ±2% rule the server's insights use
  const up = change > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border-[1.5px] font-mono font-semibold tabular-nums px-1.5 py-px text-[0.8rem]",
        flat ? "border-ink-faint text-ink-soft" : up ? "border-approve bg-approve text-paper" : "border-stamp bg-stamp text-paper",
      )}
    >
      {flat ? "≈" : up ? "▲" : "▼"} {up ? "+" : "−"}
      {Math.abs(change * 100).toFixed(1)}%
    </span>
  );
}

/** Two bars, last period (grey) vs this period (hotel colour), on one shared scale from zero. */
export function PairBars({ prev, cur, prevLabel, curLabel, format }: {
  prev: number | null; cur: number | null; prevLabel: string; curLabel: string; format: (n: number) => string;
}) {
  const max = Math.max(prev ?? 0, cur ?? 0, 1e-9);
  const rows: [string, number | null, string][] = [[prevLabel, prev, "var(--paper-shade)"], [curLabel, cur, TONE]];
  return (
    <div className="space-y-1.5">
      {rows.map(([label, v, color]) => (
        <div key={label} className="grid grid-cols-[2.6rem_1fr] items-center gap-2">
          <span className="font-mono text-[0.75rem] uppercase text-ink-soft">{label}</span>
          {v == null ? (
            <span className="font-mono text-[0.75rem] text-ink-faint">n/a</span>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-3.5 rounded-r-[3px] border border-ink/30" style={{ width: `${Math.max((v / max) * 72, 1.5)}%`, background: color }} />
              <span className="font-mono text-[0.78rem] tabular-nums">{format(v)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

type TrendKey = "engagements" | "reach" | "link_clicks" | "bookings";
const TREND_TABS: { key: TrendKey; label: string }[] = [
  { key: "reach", label: "People reached" },
  { key: "engagements", label: "Interactions" },
  { key: "link_clicks", label: "Website clicks" },
  { key: "bookings", label: "Bookings" },
];

/** Day-by-day: this period (solid, hotel colour) over last period (dashed grey), aligned by day number. */
export function TrendChart({ daily, previous, curLabel, prevLabel, totals }: {
  daily: DailyPoint[];
  previous: DailyPoint[] | null;
  curLabel: string;
  prevLabel: string;
  totals: Record<TrendKey, Change | undefined>;
}) {
  const [key, setKey] = useState<TrendKey>("reach");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = 320;
  const m = { l: 52, r: 56, t: 22, b: 36 };
  const n = Math.max(daily.length, previous?.length ?? 0);
  const cur = daily.map((d) => d[key]);
  const prev = previous?.map((d) => d[key]) ?? [];
  const scale = niceScale(Math.max(...cur, ...prev, 1));
  const iw = Math.max(width - m.l - m.r, 10);
  const ih = H - m.t - m.b;
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / scale.max) * ih;
  const area = cur.length ? `${linePath(cur, x, y)}L${x(cur.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const best = cur.length ? cur.indexOf(Math.max(...cur)) : -1;
  const t = totals[key];
  // Label every 7th day (14th on narrow screens), plus the last day if there is room.
  const every = width < 600 ? 14 : 7;
  const lastI = daily.length - 1;
  const xTicks = daily
    .map((d, i) => ({ i, d }))
    .filter(({ i }) => i % every === 0 || (i === lastI && (lastI % every) * (iw / Math.max(n - 1, 1)) > 60));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-2" role="tablist">
          {TREND_TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={key === tab.key}
              onClick={() => setKey(tab.key)}
              className={cn(
                "border-[1.5px] border-ink px-3 py-1.5 font-mono text-[0.8rem] uppercase tracking-[0.1em] transition-colors",
                key === tab.key ? "bg-ink text-paper" : "bg-paper hover:bg-highlight/50",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {t && (
          <div className="flex items-center gap-3 font-mono text-sm">
            <span className="text-ink-soft">{prevLabel} {t.previous == null ? "n/a" : fmtInt(t.previous)}</span>
            <span aria-hidden>→</span>
            <span className="font-semibold">{curLabel} {fmtInt(t.current)}</span>
            <Delta change={t.change} />
          </div>
        )}
      </div>
      <div className="mt-3">
        <Legend items={[{ label: curLabel, color: TONE }, ...(previous ? [{ label: prevLabel, color: FAINT, dashed: true }] : [])]} />
      </div>
      <div ref={ref} className="relative mt-2 w-full min-w-0 overflow-hidden" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={`Daily ${key} in ${curLabel} compared with ${prevLabel}`}>
            {scale.ticks.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} stroke={GRID} />
                <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill={SOFT} fontFamily="var(--font-mono)">{compact(v)}</text>
              </g>
            ))}
            {xTicks.map(({ i, d }) => (
              <text key={i} x={x(i)} y={H - 12} textAnchor="middle" fontSize="12" fill={SOFT} fontFamily="var(--font-mono)">{dayLabel(d.date)}</text>
            ))}
            <path d={area} fill={TONE} opacity={0.1} />
            {prev.length > 0 && <path d={linePath(prev, x, y)} fill="none" stroke={FAINT} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />}
            <path d={linePath(cur, x, y)} fill="none" stroke={TONE} strokeWidth={2.5} strokeLinejoin="round" />
            {prev.length > 0 && (
              <text x={x(prev.length - 1) + 6} y={y(prev[prev.length - 1]!) + 4} fontSize="12" fill={SOFT} fontFamily="var(--font-mono)">{prevLabel}</text>
            )}
            {cur.length > 0 && (
              <text x={x(cur.length - 1) + 6} y={y(cur[cur.length - 1]!) + 4} fontSize="12" fontWeight="600" fill={INK} fontFamily="var(--font-mono)">{curLabel}</text>
            )}
            {best >= 0 && hover == null && (
              <g>
                <circle cx={x(best)} cy={y(cur[best]!)} r={6} fill={TONE} stroke="var(--paper)" strokeWidth={2} />
                <text x={Math.min(x(best), width - m.r - 70)} y={y(cur[best]!) - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill={INK} fontFamily="var(--font-mono)">
                  ★ best day · {weekdayOf(daily[best]!.date)} {dayLabel(daily[best]!.date)}
                </text>
              </g>
            )}
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke={INK} strokeWidth={1} strokeDasharray="2 3" />
                {prev[hover] != null && <circle cx={x(hover)} cy={y(prev[hover]!)} r={4.5} fill="var(--paper)" stroke={FAINT} strokeWidth={2} />}
                {cur[hover] != null && <circle cx={x(hover)} cy={y(cur[hover]!)} r={5} fill={TONE} stroke="var(--paper)" strokeWidth={2} />}
              </g>
            )}
            <rect
              x={m.l}
              y={m.t}
              width={iw}
              height={ih}
              fill="transparent"
              onMouseMove={(e) => setHover(hoverIndex(e, n - 1))}
            />
          </svg>
        )}
        {hover != null && (
          <Tip x={x(hover)} y={m.t} width={width}>
            <p className="text-brass">Day {hover + 1}</p>
            {daily[hover] && <p>{weekdayOf(daily[hover]!.date)} {dayLabel(daily[hover]!.date)}: <b>{fmtInt(cur[hover])}</b></p>}
            {previous?.[hover] && <p className="text-paper/70">{weekdayOf(previous[hover]!.date)} {dayLabel(previous[hover]!.date)}: {fmtInt(prev[hover])}</p>}
          </Tip>
        )}
      </div>
    </div>
  );
}

/** The audience journey as a funnel. Widths are on a log scale so the last steps stay visible. */
export function Funnel({ steps }: { steps: { key: string; label: string; value: number; rate: number | null; rate_of: string | null }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const vals = steps.map((s) => Math.max(s.value, 1));
  const lmax = Math.log10(Math.max(...vals));
  const lmin = Math.log10(Math.min(...vals));
  const minW = 0.14;
  const frac = (v: number) => (lmax === lmin ? 1 : minW + ((Math.log10(Math.max(v, 1)) - lmin) / (lmax - lmin)) * (1 - minW));
  const rowH = 52;
  const gap = 34;
  const H = steps.length * rowH + (steps.length - 1) * gap;
  const labelW = Math.min(190, width * 0.42);
  const area = Math.max(width - labelW, 40);
  const cx = labelW + area / 2;
  const shades = [1, 0.82, 0.66, 0.5, 0.38];

  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Funnel from times seen to bookings">
          {steps.map((s, i) => {
            const top = frac(s.value) * area * 0.96;
            const next = steps[i + 1];
            const bottom = next ? frac(next.value) * area * 0.96 : top * 0.9;
            const y0 = i * (rowH + gap);
            const pts = `${cx - top / 2},${y0} ${cx + top / 2},${y0} ${cx + bottom / 2},${y0 + rowH} ${cx - bottom / 2},${y0 + rowH}`;
            return (
              <g key={s.key}>
                <line x1={0} x2={cx - top / 2 - 6} y1={y0 + rowH / 2} y2={y0 + rowH / 2} stroke={GRID} strokeDasharray="2 3" />
                <polygon points={pts} fill={TONE} opacity={shades[i] ?? 0.35} stroke={INK} strokeWidth={1.5} />
                <text x={0} y={y0 + 24} fontSize="24" fontWeight="600" fill={INK} fontFamily="var(--font-display)"
                  style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 5 }}>{fmtInt(s.value)}</text>
                <text x={0} y={y0 + 44} fontSize="12" fill={SOFT} fontFamily="var(--font-mono)" letterSpacing="0.08em"
                  style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 5 }}>{s.label.toUpperCase()}</text>
                {next && next.rate != null && (
                  <text x={cx} y={y0 + rowH + 22} textAnchor="middle" fontSize="13" fontWeight="600" fill={INK} fontFamily="var(--font-mono)">
                    ↓ {fmtPct(next.rate)}
                    {width >= 560 && <tspan fontWeight="400" fill={SOFT}> {next.rate_of}</tspan>}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** 100% stacked bars: each platform's share of reach, interactions and bookings. */
export function ShareBars({ rows, platforms }: { rows: { label: string; shares: Partial<Record<Platform, number | null>> }[]; platforms: Platform[] }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <Legend items={platforms.map((p) => ({ label: PLATFORM_LABEL[p], color: PLATFORM_COLOR[p] }))} />
      <div className="mt-4 space-y-5">
        {rows.map((r) => (
          <div key={r.label}>
            <p className="font-mono text-[0.8rem] uppercase tracking-[0.12em] text-ink-soft">{r.label}</p>
            <div className="mt-1.5 flex h-11 gap-[2px] overflow-hidden rounded-[3px] border-[1.5px] border-ink bg-paper">
              {platforms.map((p) => {
                const v = r.shares[p] ?? 0;
                const id = `${r.label}-${p}`;
                return (
                  <div
                    key={p}
                    onMouseEnter={() => setHover(id)}
                    onMouseLeave={() => setHover(null)}
                    title={`${PLATFORM_LABEL[p]}: ${fmtPct(v, 1)} of ${r.label.toLowerCase()}`}
                    className="flex items-center justify-center font-mono text-[0.85rem] font-semibold transition-opacity"
                    style={{ width: `${v * 100}%`, background: PLATFORM_COLOR[p], color: ON_PLATFORM[p], opacity: hover && hover !== id ? 0.55 : 1 }}
                  >
                    {v >= 0.09 ? fmtPct(v, 0) : ""}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small multiples: one row per metric, one bar per platform, each row on its own scale from zero. */
export function HeadToHead({ metrics, platforms }: {
  metrics: { label: string; hint: string; values: Partial<Record<Platform, number | null>>; format: (n: number) => string }[];
  platforms: Platform[];
}) {
  return (
    <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
      {metrics.map((m) => {
        const max = Math.max(...platforms.map((p) => m.values[p] ?? 0), 1e-9);
        const leader = platforms.reduce((a, b) => ((m.values[b] ?? -1) > (m.values[a] ?? -1) ? b : a), platforms[0]!);
        return (
          <div key={m.label}>
            <p className="font-display text-xl leading-tight">{m.label}</p>
            <p className="text-sm text-ink-soft">{m.hint}</p>
            <div className="mt-3 space-y-2">
              {platforms.map((p) => {
                const v = m.values[p];
                return (
                  <div key={p} className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                    <span className={cn("font-mono text-[0.8rem]", p === leader ? "font-semibold text-ink" : "text-ink-soft")}>{PLATFORM_LABEL[p]}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-5 rounded-r-[4px]" style={{ width: `${v == null ? 0 : Math.max((v / max) * 78, 1)}%`, background: PLATFORM_COLOR[p] }} />
                      <span className="font-mono text-[0.85rem] tabular-nums">
                        {v == null ? "n/a" : m.format(v)}
                        {p === leader && " ★"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Total followers per day (a snapshot, so a line on a zoomed axis, not an area from zero). */
export function FollowerLine({ daily }: { daily: DailyPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const m = { l: 56, r: 64, t: 28, b: 32 };
  const vals = daily.map((d) => d.followers);
  if (vals.length === 0) return null;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, 1);
  const y0 = lo - pad;
  const y1 = hi + pad;
  const iw = Math.max(width - m.l - m.r, 10);
  const ih = H - m.t - m.b;
  const x = (i: number) => m.l + (vals.length <= 1 ? 0 : (i / (vals.length - 1)) * iw);
  const y = (v: number) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const d = linePath(vals, x, y);
  const last = vals.length - 1;
  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Total followers per day">
          {[y0 + pad, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} stroke={GRID} />
              <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill={SOFT} fontFamily="var(--font-mono)">{compact(v)}</text>
            </g>
          ))}
          <path d={d} fill="none" stroke={TONE} strokeWidth={2.5} strokeLinejoin="round" />
          <circle cx={x(0)} cy={y(vals[0]!)} r={5} fill="var(--paper)" stroke={TONE} strokeWidth={2} />
          <circle cx={x(last)} cy={y(vals[last]!)} r={6} fill={TONE} stroke="var(--paper)" strokeWidth={2} />
          <text x={x(0)} y={y(vals[0]!) - 12} fontSize="13" fill={SOFT} fontFamily="var(--font-mono)">{fmtInt(vals[0])}</text>
          <text x={x(last) + 8} y={y(vals[last]!) + 5} fontSize="14" fontWeight="600" fill={INK} fontFamily="var(--font-mono)">{fmtInt(vals[last])}</text>
          <text x={x(0)} y={H - 10} fontSize="12" fill={SOFT} fontFamily="var(--font-mono)">{dayLabel(daily[0]!.date)}</text>
          <text x={x(last)} y={H - 10} textAnchor="end" fontSize="12" fill={SOFT} fontFamily="var(--font-mono)">{dayLabel(daily[last]!.date)}</text>
          {hover != null && <circle cx={x(hover)} cy={y(vals[hover]!)} r={4.5} fill={INK} />}
          <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent"
            onMouseMove={(e) => setHover(hoverIndex(e, last))} />
        </svg>
      )}
      {hover != null && (
        <Tip x={x(hover)} y={m.t} width={width}>
          <p className="text-brass">{weekdayOf(daily[hover]!.date)} {dayLabel(daily[hover]!.date)}</p>
          <p><b>{fmtInt(vals[hover])}</b> followers</p>
        </Tip>
      )}
    </div>
  );
}

/** Net new followers per platform, horizontal bars from zero. */
export function GrowthBars({ rows }: { rows: { platform: Platform; net: number; pct: number | null; end: number }[] }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.net)), 1);
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.platform}>
          <div className="flex items-baseline justify-between font-mono text-[0.85rem]">
            <span>{PLATFORM_LABEL[r.platform]}</span>
            <span className="text-ink-soft">{fmtInt(r.end)} total</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-5 rounded-r-[4px]" style={{ width: `${Math.max((Math.abs(r.net) / max) * 70, 1)}%`, background: PLATFORM_COLOR[r.platform] }} />
            <span className="font-mono text-[0.85rem] font-semibold tabular-nums">
              {r.net >= 0 ? "+" : "−"}{fmtInt(Math.abs(r.net))} <span className="font-normal text-ink-soft">({fmtChange(r.pct)})</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Generic vertical bars with one highlighted bar, an optional reference line and per-bar tooltips. */
export function Columns({ bars, highlight, refLine, ariaLabel }: {
  bars: { key: string; label: string; sub?: string; value: number; tip: ReactNode }[];
  highlight: string | null;
  refLine?: { value: number; label: string } | undefined;
  ariaLabel: string;
}) {
  const height = 240;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 8, r: 8, t: 30, b: bars.some((b) => b.sub) ? 44 : 28 };
  const max = niceMax(Math.max(...bars.map((b) => b.value), refLine?.value ?? 0, 1) * 1.08);
  const iw = Math.max(width - m.l - m.r, 10);
  const ih = height - m.t - m.b;
  const slot = iw / Math.max(bars.length, 1);
  const bw = Math.min(slot * 0.62, 64);
  const y = (v: number) => m.t + ih - (v / max) * ih;
  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <line x1={m.l} x2={width - m.r} y1={y(0)} y2={y(0)} stroke={INK} strokeWidth={1.5} />
          {bars.map((b, i) => {
            const cx = m.l + slot * i + slot / 2;
            const hi = b.key === highlight;
            const top = y(b.value);
            const h = Math.max(y(0) - top, 1);
            const r = Math.min(4, bw / 2, h);
            return (
              <g key={b.key} onMouseEnter={() => setHover(i)}>
                {/* transparent target covering the whole column, so hovering anywhere in it works */}
                <rect x={cx - slot / 2} y={m.t} width={slot} height={ih + m.b} fill="transparent" />
                {/* bar shape with curved top corners */}
                <path
                  d={`M${cx - bw / 2},${y(0)}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${y(0)}Z`}
                  fill={TONE}
                  opacity={hi ? 1 : hover === i ? 0.6 : 0.35}
                  stroke={hi ? INK : "none"}
                  strokeWidth={1.5}
                />
                {(hi || hover === i) && (
                  <text x={cx} y={top - 8} textAnchor="middle" fontSize="13" fontWeight="600" fill={INK} fontFamily="var(--font-mono)">{compact(b.value)}</text>
                )}
                <text x={cx} y={height - (b.sub ? 24 : 8)} textAnchor="middle" fontSize="12" fontWeight={hi ? 700 : 400} fill={hi ? INK : SOFT} fontFamily="var(--font-mono)">{b.label}</text>
                {b.sub && <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill={SOFT} fontFamily="var(--font-mono)">{b.sub}</text>}
              </g>
            );
          })}
          {refLine && (
            <g pointerEvents="none">
              <line x1={m.l} x2={width - m.r} y1={y(refLine.value)} y2={y(refLine.value)} stroke={INK} strokeDasharray="4 4" strokeWidth={1.2} />
              <text x={m.l} y={y(refLine.value) - 6} textAnchor="start" fontSize="12" fill={INK} fontFamily="var(--font-mono)"
                style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 4 }}>
                {refLine.label}
              </text>
            </g>
          )}
        </svg>
      )}
      {hover != null && bars[hover] && (
        <Tip x={m.l + slot * hover + slot / 2} y={m.t} width={width}>{bars[hover]!.tip}</Tip>
      )}
    </div>
  );
}

/** "6–12 Oct". */
export const weekLabel = (w: WeekPoint) => `${new Date(w.from + "T00:00:00Z").getUTCDate()}–${dayLabel(w.to)}`;
