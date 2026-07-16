"use client";

// Spec 323 U2 — the universal cross-project lens chip row.
//
// 'use client' is justified: the component reads usePathname() + useSearchParams()
// so ANY procurement surface mounts <ProjectLens projects={…} /> and gets a
// param-preserving cross-project filter with ZERO per-page href wiring — it
// self-derives the active project from the URL and rebuilds each chip's href off
// the live query string (spec 311 U1's /requests row needed the page to thread a
// bespoke reqHref; this one doesn't). The chips stay plain <Link>s so navigation
// is still deep-linkable and needs no client handler. Collapses to nothing at ≤1
// named project (single-project world unchanged). Field-First tokens only —
// mirrors spec 311 U1's SiteProjectChips (fill active / card idle).
//
// ⚠ CONSUMER CONTRACT (U4): useSearchParams() opts the nearest route segment out
// of static prerendering. Mount this ONLY on a dynamically-rendered route — every
// procurement lens surface qualifies (they all await requireRole() → cookies →
// dynamic) — OR wrap the mount in <Suspense>. On a statically-prerendered route
// with no Suspense boundary, `next build` hard-errors. This is the deliberate
// trade for the zero-wiring reusability the spec asked for (311 stayed server-
// rendered precisely to avoid this, at the cost of page-threaded hrefs).

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { PROJECT_FILTER_ARIA } from "@/lib/i18n/labels";
import {
  buildProjectLensChips,
  projectLensHref,
  type ProjectLensOption,
} from "@/lib/nav/project-lens";

interface ProjectLensProps {
  /** The named-and-unnamed project options the current rows span (unnamed dropped inside). */
  projects: ReadonlyArray<ProjectLensOption>;
}

export function ProjectLens({ projects }: ProjectLensProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const activeProjectId = searchParams.get("project");

  const chips = buildProjectLensChips({
    projects,
    activeProjectId,
    hrefFor: (projectId) => projectLensHref(pathname, search, projectId),
  });
  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={PROJECT_FILTER_ARIA}
      className="flex flex-wrap items-center gap-1 text-xs"
    >
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          aria-current={chip.active ? "true" : undefined}
          className={`focus-visible:ring-action inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px ${
            chip.active
              ? "border-fill bg-fill text-on-fill font-semibold"
              : "border-edge-strong bg-card text-ink-secondary hover:bg-sunk"
          }`}
        >
          {chip.label}
        </Link>
      ))}
    </div>
  );
}
