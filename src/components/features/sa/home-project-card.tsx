// Spec 375 U2 — the SA home's project block: the door to her own project.
//
// First thing in the home body, above the worklist, because it is the destination
// 395 of ~810 home visits were reaching the long way round (/sa → /projects → the
// hub). One large tap target, not a text link — this is the single most-taken
// path off the page after a work package.
//
// Server-component safe: a pure Link, no client state. Renders nothing when the
// SA has no resolved visible project (`buildHomeProjectCard` returns null), which
// is the conditional-section idiom the rest of this page already uses.

import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { projectHref } from "@/lib/nav/project-paths";
import { MY_PROJECT_LABEL, openWorkCountLabel } from "@/lib/i18n/labels";
import type { HomeProjectCardView } from "@/lib/sa/home-project-card";

export function HomeProjectCard({ card }: { card: HomeProjectCardView | null }) {
  if (!card) return null;

  return (
    <Link
      href={projectHref(card.projectId)}
      className="rounded-card border-edge bg-card shadow-card focus-visible:ring-action hover:bg-sunk flex min-h-16 items-center gap-3 border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2"
    >
      <Building2 aria-hidden className="text-action size-6 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-meta text-ink-muted">{MY_PROJECT_LABEL}</span>
        <span className="text-body text-ink font-semibold break-words">{card.name}</span>
        {/* The count is deliberately NOT suppressed at zero: an SA whose work is
            all done still needs the door, and this is the only one on the home. */}
        <span className="text-meta text-ink-secondary">
          {card.code} · {openWorkCountLabel(card.openCount)}
        </span>
      </span>
      <ChevronRight aria-hidden className="text-ink-muted size-5 shrink-0" />
    </Link>
  );
}
