// PageShell (spec 64): THE page scroller. The body is locked
// (h-full overflow-hidden in the root layout); this <main> is the only
// thing that scrolls. Sticky headers stick to it crisply on iOS, and
// fixed chrome (tab bar, queue banner, scrims) anchors a viewport that
// can no longer rubber-band — drift is impossible by construction.
//
// Spec-63 consolidation rule: every route renders PageShell;
// hand-rolling a <main> is a review reject (ui-conventions §5).

type PageShellVariant = "app" | "card" | "bare";

const SHELL_BASE = "h-full overflow-y-auto overscroll-y-contain text-ink";

const VARIANT_CLASSES: Record<PageShellVariant, string> = {
  /** Content pages: zinc wash + phone tab-bar clearance. */
  app: "bg-page pb-20 sm:pb-0",
  /** Single-card screens (login, landing, error, not-found). */
  card: "flex items-center justify-center bg-card px-6",
  /** Caller supplies the rest (profile, coming-soon hub). */
  bare: "",
};

interface PageShellProps {
  variant?: PageShellVariant;
  className?: string;
  children: React.ReactNode;
}

export function PageShell({ variant = "app", className, children }: PageShellProps) {
  return (
    // height tracks the iOS visual viewport (spec 95 AppHeightTracker publishes
    // --app-vh); falls back to 100% (h-full) before JS / off iOS. This is what
    // shrinks the scroller above the on-screen keyboard and restores it on close.
    <main
      className={`${SHELL_BASE} ${VARIANT_CLASSES[variant]} ${className ?? ""}`.trim()}
      style={{ height: "var(--app-vh, 100%)" }}
    >
      {children}
    </main>
  );
}
