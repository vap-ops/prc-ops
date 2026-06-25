import { Skeleton } from "@/components/ui/skeleton";

// Shared route-level loading state (spec 15 item E). Server component;
// purely presentational. Mirrors the common page anatomy — header strip,
// section label, list rows — on the app's white ground so the swap to
// real content doesn't flash. Explicit zinc tones override the shadcn
// Skeleton's theme-token default (the screens hardcode the light palette).
export function PageSkeleton() {
  return (
    <main className="bg-page min-h-screen overflow-x-clip">
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
    </main>
  );
}
