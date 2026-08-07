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
  /**
   * Content pages: zinc wash + phone tab-bar clearance.
   *
   * The clearance COMPOSES the safe-area inset because the bar it clears does:
   * `bottom-tab-bar` is `h-16` (64px) + `border-t` (1px) +
   * `pb-[env(safe-area-inset-bottom)]`. On a notched iPhone that inset is 34px,
   * so the bar stands 99px tall — a flat `pb-20` reserved only 80 and left the
   * last 19px of every content page behind it. Every other bottom-fixed element
   * in the app already composes the inset (toast-provider, phase-uploader,
   * muster-cockpit, phone-po-basket); this was the one site that hardcoded it.
   */
  app: "bg-page pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0",
  /**
   * Single-card screens (login, landing, error, not-found, /coming-soon).
   *
   * Centred with AUTO MARGINS, not `items-center`: on a scrolling flex
   * container, `align-items: center` centres overflowing content by pushing its
   * top above the scrollable area, where no scroll position can reach it.
   * Measured 2026-08-06 in a real browser — a 900px child in a 600px scroller
   * sat at top −150 with scrollHeight 750 and maxScroll 150, so 150px was
   * unreachable. Auto margins centre identically while free space is positive
   * and collapse to 0 when it is not, so a tall card simply scrolls
   * (same child: top 0, scrollHeight 900, maxScroll 300).
   *
   * /coming-soon's OperatorHub arm used to render `bare` + `bg-card px-6 py-10`,
   * which left that page's three arms disagreeing about vertical alignment and
   * its loading fallback unable to match all three. (It was NOT a deliberate
   * opt-out from this trap — `git show 9248267c` shows a hand-rolled <main> from
   * before PageShell existed, ported 1:1 in e600c4ed. The trap is real; that
   * arm's history is not evidence of it.) With centring made safe, the arm now
   * uses this variant and the three agree.
   *
   * ⚠️ `[&>*]:m-auto` is emitted LAST at equal specificity, so it beats every
   * margin utility a child sets — `mx-auto` (same result), `.sr-only`'s
   * `margin:-1px`, and any future `mt-*`/`m-0`. A card child that needs its own
   * margin must set it on an inner element.
   */
  card: "flex items-start justify-center bg-card px-6 [&>*]:m-auto",
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
