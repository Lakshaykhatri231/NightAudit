import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { KeyTag } from "@/components/desk/KeyTag";
import { Stamp } from "@/components/desk/Stamp";
import { HOTELS, USERS } from "@/lib/audit/directory";
import { useAudit } from "@/lib/audit/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Night Audit — the front desk for hotel social reports" },
      {
        name: "description",
        content:
          "Sign in, upload Harbourlight or Pinecrest social numbers, and get a checked monthly report written by fixed rules, not AI.",
      },
      { property: "og:title", content: "Night Audit — the front desk for hotel social reports" },
      {
        property: "og:description",
        content: "Every figure checked five ways. Every report countersigned. Every action logged.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FrontDesk,
});

/** The six steps of the workflow: [stage, what happens, who does it]. */
const STEPS = [
  ["Check-in", "The analyst uploads the month's Instagram, Facebook and TikTok numbers as a CSV.", "Analyst"],
  ["Inspection", "Every row is checked. Impossible or malformed rows are turned away, each with a reason.", "The desk"],
  ["The ledger", "Totals and rates are calculated, then five accuracy checks re-add them in SQL, by platform and by day.", "The desk"],
  ["The write-up", "Plain English from fixed rules: a verdict, wins, watch-outs and next steps. No language model.", "The desk"],
  ["Countersign", "A different person, the hotel's reviewer, approves or returns it with a note. Never the author.", "Reviewer"],
  ["Checkout", "Only approved reports can leave the building, as HTML, CSV or JSON, with a SHA-256 fingerprint.", "Same hotel only"],
] as const;

function FrontDesk() {
  const { signIn, user, sessionLoaded } = useAudit();
  const navigate = useNavigate();

  const signInAs = async (id: string) => {
    try {
      const u = await signIn(id);
      toast(`Key ${u.room} issued to ${u.name}`, { description: "Signed in by the Python server. This has been logged." });
      if (u.role === "reviewer") navigate({ to: "/review" });
      else navigate({ to: "/hotels/$hotelId", params: { hotelId: u.hotel } });
    } catch (e) {
      toast.error("The desk is closed", { description: `${(e as Error).message}. Is python3 app.py running?` });
    }
  };

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-16 pt-14 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="eyebrow">Social reporting for Harbourlight &amp; Pinecrest</p>
          <h1 className="font-display mt-6 text-[clamp(3rem,7.5vw,6.4rem)] font-medium leading-[0.88] tracking-[-0.03em]">
            Every figure
            <br />
            gets a{" "}
            <span className="relative inline-block italic">
              night audit.
              <svg className="absolute -bottom-3 left-0 w-full text-stamp" viewBox="0 0 300 14" fill="none" preserveAspectRatio="none" aria-hidden>
                <path d="M2 9c40-6 90-7 140-3s110 4 156-4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p className="mt-10 max-w-xl text-lg leading-relaxed text-ink-soft">
            Upload a hotel's social numbers. Bad rows are turned away at the door, five checks run on what's left,
            and the monthly report is written in plain English by fixed rules. A second person signs it off before
            anyone can take a copy home.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <Stamp tone="stamp" rotate={-5}>No AI-written text</Stamp>
            <Stamp tone="ink" rotate={3}>Always reproducible</Stamp>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="relative pt-2">
            <p className="eyebrow mb-3 text-center">Take a key to sign in</p>
            <div className="mx-6 h-2 rounded-full border border-ink bg-gradient-to-b from-brass to-brass-deep" aria-hidden />
            <div className="-mt-1 flex justify-center gap-2 sm:gap-3">
              {USERS.map((u) => (
                <KeyTag key={u.id} user={u} onClick={() => signInAs(u.id)} active={sessionLoaded && user?.id === u.id} />
              ))}
            </div>
            <p className="mt-6 text-center font-mono text-[0.78rem] uppercase tracking-[0.16em] text-ink-faint">
              Demo accounts · an analyst and a reviewer per hotel · password demo123
            </p>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y-[1.5px] border-ink">
        <div className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-4">
          {[
            ["05", "accuracy checks on every report"],
            ["02", "hotel vaults, sealed from each other"],
            ["00", "words written by a language model"],
            ["38", "passing tests in the Python core"],
          ].map(([n, l], i) => (
            <div key={l} className={`px-6 py-8 ${i > 0 ? "md:border-l-[1.5px] md:border-ink" : ""} ${i % 2 ? "border-l-[1.5px] border-ink md:border-l-[1.5px]" : ""} ${i > 1 ? "border-t-[1.5px] border-ink md:border-t-0" : ""}`}>
              <div className="font-display text-6xl font-light leading-none tracking-tight">{n}</div>
              <div className="mt-3 max-w-[14rem] text-sm text-ink-soft">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow table */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex items-end justify-between gap-6">
          <h2 className="font-display text-4xl md:text-5xl">The house rules</h2>
          <p className="eyebrow hidden md:block">Guest register · page 1 of 1</p>
        </div>
        <div className="sheet-lifted mt-8 overflow-hidden">
          <div className="grid grid-cols-[3.5rem_1fr] border-b-[1.5px] border-ink bg-paper-deep md:grid-cols-[4rem_12rem_1fr_9rem]">
            <span className="eyebrow px-4 py-3">No.</span>
            <span className="eyebrow px-4 py-3">Stage</span>
            <span className="eyebrow hidden px-4 py-3 md:block">What happens</span>
            <span className="eyebrow hidden px-4 py-3 md:block">Who</span>
          </div>
          {STEPS.map(([stage, what, who], i) => (
            <div
              key={stage}
              className="group grid grid-cols-[3.5rem_1fr] border-b border-border last:border-b-0 hover:bg-highlight/40 md:grid-cols-[4rem_12rem_1fr_9rem]"
            >
              <span className="figure-mono px-4 py-5 text-sm text-ink-faint group-hover:text-stamp">{String(i + 1).padStart(2, "0")}</span>
              <div className="px-4 py-5 md:contents">
                <span className="font-display text-2xl italic md:px-4 md:py-4">{stage}</span>
                <span className="mt-1 block text-ink-soft md:mt-0 md:px-4 md:py-5">{what}</span>
                <span className="mt-2 block font-mono text-[0.82rem] uppercase tracking-[0.14em] md:mt-0 md:px-4 md:py-5">{who}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How the report text is written */}
      <section className="bg-ink text-paper">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1fr_22rem]">
          <div>
            <p className="font-mono text-[0.8rem] uppercase tracking-[0.18em] text-brass">How the words get written</p>
            <blockquote className="font-display mt-6 text-3xl leading-snug md:text-[2.6rem] md:leading-[1.15]">
              “TikTok <span className="underline decoration-brass decoration-wavy decoration-2 underline-offset-8">had the highest engagement rate</span>{" "}
              (<span className="figure-mono rounded-sm bg-brass px-1.5 text-[0.8em] text-ink">8.28%</span>) with{" "}
              <span className="figure-mono rounded-sm bg-brass px-1.5 text-[0.8em] text-ink">46,815</span> engagements.”
            </blockquote>
            <p className="mt-4 font-mono text-[0.8rem] uppercase tracking-[0.16em] text-paper/60">From Pinecrest's October report</p>
          </div>
          <div className="space-y-6 border-l border-paper/25 pl-6 font-mono text-xs leading-relaxed text-paper/80">
            <p>
              <span className="text-brass">RULE</span> Rank platforms by engagements ÷ reach and name the leader with its own figures.
            </p>
            <p>
              <span className="text-brass">RULE</span> A change under ±2% is written as “about the same”, never as a rise or a fall.
            </p>
            <p>
              <span className="text-brass">CHECK 1</span> SQLite re-adds every total on its own; the report cannot be submitted if one differs.
            </p>
          </div>
        </div>
      </section>

      {/* The two hotels */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-4xl md:text-5xl">Two properties. No door between them.</h2>
        <p className="mt-3 max-w-2xl text-ink-soft">
          Each hotel's numbers live in their own SQLite file. Ask for the other hotel's file and the server answers 403, then writes your name down.
        </p>
        <div className="mt-10 grid items-stretch gap-6 md:grid-cols-[1fr_auto_1fr]">
          {[HOTELS.harbourlight, HOTELS.pinecrest].map((h, i) => (
            <div key={h.id} className="contents">
              {i === 1 && (
                <div className="hidden flex-col items-center justify-center gap-3 md:flex" aria-hidden>
                  <div className="hatch w-6 flex-1 border-x-[1.5px] border-ink" />
                  <span className="font-mono text-[0.74rem] uppercase tracking-[0.2em] [writing-mode:vertical-rl]">Sealed wall</span>
                  <div className="hatch w-6 flex-1 border-x-[1.5px] border-ink" />
                </div>
              )}
              <Link
                to="/hotels/$hotelId"
                params={{ hotelId: h.id }}
                className={`tone-${h.tone} sheet group block p-6 transition-transform hover:-translate-y-1`}
              >
                <img
                  src={h.image}
                  alt={`Engraving of the ${h.name} hotel`}
                  width={1024}
                  height={768}
                  loading="lazy"
                  className="etching aspect-[4/3] w-full object-cover"
                />
                <div className="mt-4 flex items-baseline justify-between border-t-[1.5px] border-ink pt-4">
                  <h3 className="font-display text-tone text-4xl">{h.name}</h3>
                  <span className="figure-mono text-xs text-ink-soft">{h.code}</span>
                </div>
                <p className="mt-1 italic text-ink-soft">{h.place}</p>
                <p className="figure-mono mt-4 inline-block border border-dashed border-ink px-2 py-1 text-[0.82rem]">{h.vault}</p>
                <span className="mt-4 block font-mono text-[0.82rem] uppercase tracking-[0.16em] group-hover:text-stamp">Open the vault →</span>
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
