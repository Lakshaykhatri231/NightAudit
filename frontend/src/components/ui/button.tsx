import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

// The four "block" buttons share one look: they lift on hover and press flat on click.
const PRESS =
  "border-[1.5px] border-ink hover:-translate-x-px hover:-translate-y-px active:translate-x-0.5 active:translate-y-0.5 active:shadow-none";

const VARIANTS = {
  default: `bg-primary text-primary-foreground ${PRESS} shadow-[3px_3px_0_var(--brass)] hover:shadow-[5px_5px_0_var(--brass)]`,
  stamp: `bg-stamp text-paper ${PRESS} shadow-[3px_3px_0_var(--ink)] hover:shadow-[5px_5px_0_var(--ink)]`,
  approve: `bg-approve text-paper ${PRESS} shadow-[3px_3px_0_var(--ink)] hover:shadow-[5px_5px_0_var(--ink)]`,
  paper: `bg-paper text-ink ${PRESS} shadow-[3px_3px_0_var(--ink)] hover:shadow-[5px_5px_0_var(--ink)]`,
  // A text link with a dashed underline.
  ledger:
    "font-mono text-xs uppercase tracking-[0.16em] text-ink border-b-[1.5px] border-dashed border-ink rounded-none px-0 hover:text-stamp hover:border-stamp",
};

const SIZES = {
  default: "h-9 px-4 py-2",
  sm: "h-8 rounded-md px-3 text-xs",
  lg: "h-10 rounded-md px-8",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}

export function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  return <button className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}
