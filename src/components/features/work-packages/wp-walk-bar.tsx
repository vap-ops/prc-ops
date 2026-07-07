// Spec 278 U1 — the "งานถัดไป" walk bar on the WP detail. A slim strip under the
// header (the screen bottom is the capture shutter) that steps the SA to the
// prev/next work package without a trip back to the list — the loop telemetry
// shows they run 80+ times a week. Each neighbour link preserves the ?from
// referrer so the WP back chip still returns to wherever they came from. Renders
// nothing when the WP has no walkable neighbours. Server component (pure Links).

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { workPackageHref } from "@/lib/nav/project-paths";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import type { WpWalk } from "@/lib/work-packages/wp-walk";

const STEP =
  "text-meta text-ink-secondary hover:bg-sunk focus-visible:ring-action inline-flex h-9 items-center gap-1 rounded-control px-3 font-medium transition-colors focus:outline-none focus-visible:ring-2";
const STEP_OFF = "text-meta text-ink-muted inline-flex h-9 items-center gap-1 px-3 font-medium";

export function WpWalkBar({
  projectId,
  walk,
  from,
}: {
  projectId: string;
  walk: WpWalk;
  from?: string | undefined;
}) {
  if (!walk.prev && !walk.next) return null;

  const href = (id: string) => {
    const base = workPackageHref(projectId, id);
    return from ? `${base}?from=${encodeURIComponent(from)}` : base;
  };

  return (
    <div className="border-edge bg-card border-b px-5 py-2">
      <nav
        aria-label="เดินไปงานถัดไป"
        className={`mx-auto ${PAGE_MAX_W} flex items-center justify-between gap-2`}
      >
        {walk.prev ? (
          <Link href={href(walk.prev.id)} className={STEP}>
            <ChevronLeft aria-hidden className="size-4 shrink-0" />
            ก่อนหน้า
          </Link>
        ) : (
          <span className={STEP_OFF}>
            <ChevronLeft aria-hidden className="size-4 shrink-0" />
            ก่อนหน้า
          </span>
        )}

        {walk.index >= 0 ? (
          <span className="text-meta text-ink-muted shrink-0 font-mono tabular-nums">
            {walk.index + 1}/{walk.total}
          </span>
        ) : null}

        {walk.next ? (
          <Link href={href(walk.next.id)} className={`${STEP} text-ink font-semibold`}>
            งานถัดไป
            <ChevronRight aria-hidden className="size-4 shrink-0" />
          </Link>
        ) : (
          <span className={STEP_OFF}>
            งานถัดไป
            <ChevronRight aria-hidden className="size-4 shrink-0" />
          </span>
        )}
      </nav>
    </div>
  );
}
