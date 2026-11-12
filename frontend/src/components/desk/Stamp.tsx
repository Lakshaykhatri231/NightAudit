import type { CSSProperties, ReactNode } from "react";
import type { ReportStatus } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

type Tone = "stamp" | "approve" | "ink" | "brass";

/** A tilted rubber-stamp label. `animate` plays the "thunk" as it lands. */
export function Stamp({
  children,
  tone = "stamp",
  rotate = -8,
  animate = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  rotate?: number;
  animate?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn("stamp", `stamp-${tone}`, animate && "animate-thunk", className)}
      // --stamp-rot keeps the tilt during the thunk animation, which also sets transform.
      style={{ transform: `rotate(${rotate}deg)`, "--stamp-rot": `${rotate}deg` } as CSSProperties}
    >
      {children}
    </span>
  );
}

const STATUS_STAMP: Record<ReportStatus, { tone: Tone; label: string; rotate: number }> = {
  draft: { tone: "ink", label: "Draft", rotate: -4 },
  pending_review: { tone: "brass", label: "Awaiting review", rotate: 3 },
  approved: { tone: "approve", label: "Approved", rotate: -7 },
  rejected: { tone: "stamp", label: "Returned", rotate: 5 },
};

export function StatusStamp({ status, animate, className }: { status: ReportStatus; animate?: boolean | undefined; className?: string | undefined }) {
  const { tone, label, rotate } = STATUS_STAMP[status];
  return (
    <Stamp tone={tone} rotate={rotate} animate={animate} className={className}>
      {label}
    </Stamp>
  );
}
