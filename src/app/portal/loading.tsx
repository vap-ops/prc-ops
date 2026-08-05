// Spec 130 U3 — portal loading parity (PM pages all ship a loading.tsx).
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export default function PortalLoading() {
  return (
    <PageShell>
      {/* Parity with PageSkeleton (UX-audit G8 follow-up): every other loading.tsx
          delegates to it and inherits its announcement, so this bespoke skeleton is
          the one boundary that would load in silence. Same wording on purpose — the
          term is shared with the 38 PageSkeleton boundaries. */}
      <p className="sr-only">กำลังโหลด…</p>
      <div className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto ${PAGE_MAX_W}`}>
          <div className="bg-sunk h-6 w-40 animate-pulse rounded" />
        </div>
      </div>
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-3 px-5 py-6`}>
        <div className="bg-sunk h-28 animate-pulse rounded-xl" />
        <div className="bg-sunk h-20 animate-pulse rounded-xl" />
        <div className="bg-sunk h-20 animate-pulse rounded-xl" />
      </section>
    </PageShell>
  );
}
