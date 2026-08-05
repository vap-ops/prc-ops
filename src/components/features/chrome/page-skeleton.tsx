import { PageShell } from "@/components/features/chrome/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

// Shared route-level loading state (spec 15 item E). Server component;
// purely presentational. Mirrors the common page anatomy — header strip,
// section label, list rows — on the app's white ground so the swap to
// real content doesn't flash. Explicit zinc tones override the shadcn
// Skeleton's theme-token default (the screens hardcode the light palette).
//
// It renders PageShell, like every other route (spec 63/64, ui-conventions §5)
// — 38 of the app's 39 loading.tsx files delegate here, so this one line is 38
// boundaries' scroller. It used to hand-roll `<main class="bg-page min-h-screen
// overflow-x-clip">`, which is not a scroller: the root layout locks the body
// (h-full overflow-hidden), so a min-h-screen <main> grows PAST the viewport and
// the overflow is clipped with no gesture that can reach it. Measured in a real
// browser 2026-08-06 (jsdom has no layout engine and cannot see this): at phone
// landscape 812×375 the skeleton's own 433px of content had its last row cut at
// y=409 with ZERO user-scrollable ancestors, and the same wrapper with tall
// content put 29 of 40 rows permanently out of reach — while the identical
// content inside PageShell scrolled normally.
export function PageSkeleton() {
  return (
    <PageShell variant="app">
      <p className="sr-only">กำลังโหลด…</p>
      <header className="border-edge bg-card border-b px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="bg-sunk h-3 w-20" />
            <Skeleton className="bg-sunk h-5 w-44" />
          </div>
          <Skeleton className="bg-sunk h-8 w-28" />
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-5 py-6">
        <Skeleton className="bg-sunk mb-4 h-4 w-28" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="rounded-control bg-sunk h-16 w-full" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
