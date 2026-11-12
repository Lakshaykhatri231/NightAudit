import { HOTELS } from "@/lib/audit/directory";
import type { User } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

const tagColour = (u: User) => `keytag-${HOTELS[u.hotel].tone}`;

/** A hotel room key on a hook. Clicking it signs in as that demo user. */
export function KeyTag({ user, onClick, active }: { user: User; onClick?: () => void; active?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      {/* hook and ring */}
      <div className="h-6 w-px bg-ink" />
      <div className="-mt-1 h-5 w-5 rounded-full border-2 border-brass-deep" />
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "keytag -mt-2 flex h-60 w-[6.6rem] flex-col items-center px-2 pb-4 pt-12 text-center focus-visible:outline-none sm:w-28",
          tagColour(user),
          active && "ring-4 ring-brass ring-offset-4 ring-offset-paper",
        )}
        aria-label={`Sign in as ${user.name}, ${user.title}`}
      >
        <span className="keytag-hole" />
        <span className="font-mono text-[0.74rem] uppercase tracking-[0.3em] opacity-80">Room</span>
        <span className="font-display text-4xl font-semibold leading-none">{user.room}</span>
        <span className={cn("mt-2 rounded-full px-2 py-0.5 font-mono text-[0.72rem] uppercase tracking-[0.16em]", user.role === "reviewer" ? "bg-brass text-ink" : "border border-current")}>{user.role}</span>
        <span className="mt-auto block w-full border-t border-current pt-3 font-display text-base italic leading-tight">
          {user.name}
        </span>
        <span className="mt-1 font-mono text-[0.72rem] uppercase tracking-[0.14em] opacity-85">{HOTELS[user.hotel].name}</span>
      </button>
    </div>
  );
}

/** Small key badge for the header: room number and first name. */
export function MiniKey({ user }: { user: User }) {
  return (
    <span className={cn("inline-flex h-8 items-center gap-2 rounded-full border-[1.5px] border-ink pl-1.5 pr-3", tagColour(user))}>
      <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-ink bg-paper" />
      <span className="font-mono text-[0.78rem] uppercase tracking-[0.14em]">
        {user.room} · {user.name.split(" ")[0]}
      </span>
    </span>
  );
}
