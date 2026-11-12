import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";

/** Pop-up notifications, styled as a small paper slip. */
export function Toaster(props: ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        style: {
          background: "var(--paper)",
          color: "var(--ink)",
          border: "1.5px solid var(--ink)",
          borderRadius: "2px",
          boxShadow: "4px 4px 0 var(--ink)",
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
        },
        classNames: {
          toast: "group toast",
          description: "group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
