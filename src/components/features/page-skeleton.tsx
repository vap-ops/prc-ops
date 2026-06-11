import { Skeleton } from "@/components/ui/skeleton";

// Shared route-level loading state (spec 15 item E). Server component;
// purely presentational. Mirrors the common page anatomy — header strip,
// section label, list rows — on the app's white ground so the swap to
// real content doesn't flash. Explicit zinc tones override the shadcn
// Skeleton's theme-token default (the screens hardcode the light palette).
export function PageSkeleton() {
  return (
    <main className="min-h-screen bg-white">
      <p className="sr-only">กำลังโหลด…</p>
      <header className="border-b border-zinc-300 px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20 bg-zinc-200" />
            <Skeleton className="h-5 w-44 bg-zinc-200" />
          </div>
          <Skeleton className="h-8 w-28 bg-zinc-200" />
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-5 py-6">
        <Skeleton className="mb-4 h-4 w-28 bg-zinc-200" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg bg-zinc-200" />
          ))}
        </div>
      </div>
    </main>
  );
}
