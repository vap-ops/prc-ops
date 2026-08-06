import { LoadingAnnouncement } from "@/components/features/chrome/loading-announcement";
import { PageShell } from "@/components/features/chrome/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

// The route-loading frame for the app's SINGLE-COLUMN screens (spec 41's
// recorded width exceptions): /login, /coming-soon and /profile. Server
// component, purely presentational — the sibling of page-skeleton.tsx, which
// mirrors a CONTENT page (header strip + list rows at PAGE_MAX_W).
//
// Why it exists, measured rather than assumed. All three of those screens used
// to fall back to PageSkeleton, and #985's review asked which surfaces that made
// worse. On /coming-soon at 1280×800, with the streamed fallback and the
// resolved page both present in one DOM: the fallback's container was 1240px on
// bg-page, the page's 448px on bg-card. Width is the smaller half of that — the
// GROUND flips too, so the whole screen flashes grey→white at the swap.
//
// The variant is PageShell's own vocabulary, and both arms have a real caller:
//   • card — centred on bg-card, NO header: /login (a max-w-sm card) and
//     /coming-soon (three arms — the unserved-role card, the VisitorLanding
//     card, and the super_admin OperatorHub at bare+bg-card; all a max-w-md
//     column on the card ground);
//   • app  — top-aligned on bg-page WITH a sticky-header placeholder: /profile,
//     which renders DetailHeader above a max-w-md column, so a headerless
//     centred frame would be a NEW mismatch on the vertical axis.
//
// Two residual jumps, disclosed rather than papered over (both far smaller than
// the ~792px this replaced) — one closed, one open:
//   • ~~/login's card is max-w-sm against a fixed max-w-md column~~ CLOSED
//     2026-08-06: the width is per-screen now, and each boundary's is pinned
//     against the width its own PAGE declares, so it cannot drift back;
//   • /coming-soon's super_admin arm is TOP-aligned (variant="bare") while the
//     card variant centres, so that one arm still shifts vertically. The other
//     two arms of that page are centred, so `card` is the majority match.
//
// /profile is also the reason this is not card-only: /login and /coming-soon are
// both in the telemetry EXCLUDED_PREFIXES, so their usage is unmeasurable, while
// /profile is measurably alive (91 route views / 73 sessions / 9 roles in 60
// days). A card-only fix would have landed entirely on surfaces whose value
// cannot be observed.
export type NarrowWidth = "sm" | "md";

// Literal class strings, never `max-w-${width}` — Tailwind generates utilities by
// scanning source for whole candidates, so an interpolated name is not guaranteed
// to exist in the stylesheet. Both values do happen to be emitted from elsewhere in
// src/ today (login/page.tsx, confirm-dialog.tsx) — which is exactly the kind of
// accident that stops being true the day those files change.
const COLUMN_WIDTH: Record<NarrowWidth, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
};

export function NarrowSkeleton({
  variant,
  width,
}: {
  variant: "app" | "card";
  width: NarrowWidth;
}) {
  return (
    <PageShell variant={variant}>
      <LoadingAnnouncement />
      {/* The app arm stands in for a page that has a sticky DetailHeader; the
          card arm's screens have no header at all. Same classes as
          detail-header.tsx so the strip does not resize at the swap. */}
      {variant === "app" ? (
        <header className="border-edge bg-card border-b px-5 py-4">
          <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3`}>
            <Skeleton className="bg-sunk h-11 w-11 rounded-full" />
            <div className="flex items-center gap-4">
              <Skeleton className="bg-sunk h-16 w-16 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="bg-sunk h-6 w-40" />
                <Skeleton className="bg-sunk h-4 w-28" />
              </div>
            </div>
          </div>
        </header>
      ) : null}
      <div
        className={
          variant === "card"
            ? `w-full ${COLUMN_WIDTH[width]} space-y-6 text-center`
            : `mx-auto flex w-full ${COLUMN_WIDTH[width]} flex-col gap-6 px-6 py-10`
        }
      >
        <Skeleton className="bg-sunk mx-auto h-8 w-48" />
        <Skeleton className="bg-sunk mx-auto h-4 w-64" />
        <Skeleton className="rounded-control bg-sunk h-12 w-full" />
        <Skeleton className="rounded-control bg-sunk h-12 w-full" />
      </div>
    </PageShell>
  );
}
