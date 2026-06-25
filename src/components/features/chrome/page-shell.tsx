// PageShell (spec 64): THE page scroller. The body is locked
// (h-full overflow-hidden in the root layout); this <main> is the only
// thing that scrolls. Sticky headers stick to it crisply on iOS, and
// fixed chrome (tab bar, queue banner, scrims) anchors a viewport that
// can no longer rubber-band — drift is impossible by construction.
//
// Spec-63 consolidation rule: every route renders PageShell;
// hand-rolling a <main> is a review reject (ui-conventions §5).

type PageShellVariant = "app" | "card" | "bare";

// overflow-x-clip is the app-wide guard against the "page scrolls left-right"
// bug (feedback 887ab7d8): overflow-y-auto coerces an unset overflow-x to auto,
// so any over-wide child (a non-shrinking flex row, a wide table) would make
// THIS scroller pan horizontally. clip pins the x-axis — it never becomes
// user- or programmatically-scrollable — while overflow-y-auto keeps the
// vertical scroll. Every route renders PageShell, so this one line contains the
// whole class. Children that legitimately need a horizontal scroll (chip/tab
// strips) carry their own overflow-x-auto and scroll within themselves.
const SHELL_BASE = "h-full overflow-x-clip overflow-y-auto overscroll-y-contain text-ink";

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
    <main className={`${SHELL_BASE} ${VARIANT_CLASSES[variant]} ${className ?? ""}`.trim()}>
      {children}
    </main>
  );
}
