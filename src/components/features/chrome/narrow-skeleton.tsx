import { LoadingAnnouncement } from "@/components/features/chrome/loading-announcement";
import { PageShell } from "@/components/features/chrome/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

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
//   • card — centred on bg-card: /login (max-w-sm card) and /coming-soon (its
//     unserved-role arm is variant="card", its super_admin OperatorHub arm is
//     bare+bg-card; both are a max-w-md column on the card ground);
//   • app  — top-aligned on bg-page: /profile, which is an app-variant page with
//     a narrow max-w-md column, so a centred card frame would be a NEW mismatch.
//
// /profile is also the reason this unit is not card-only: /login and
// /coming-soon are both in the telemetry EXCLUDED_PREFIXES, so their usage is
// unmeasurable, while /profile is measurably alive (91 route views / 73 sessions
// / 9 roles in 60 days). A card-only fix would have landed entirely on surfaces
// whose value cannot be observed.
export function NarrowSkeleton({ variant }: { variant: "app" | "card" }) {
  const column =
    variant === "card"
      ? "w-full max-w-md space-y-6 text-center"
      : "mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-10";

  return (
    <PageShell variant={variant}>
      <LoadingAnnouncement />
      <div className={column}>
        <Skeleton className="bg-sunk mx-auto h-8 w-48" />
        <Skeleton className="bg-sunk mx-auto h-4 w-64" />
        <Skeleton className="rounded-control bg-sunk h-12 w-full" />
        <Skeleton className="rounded-control bg-sunk h-12 w-full" />
      </div>
    </PageShell>
  );
}
