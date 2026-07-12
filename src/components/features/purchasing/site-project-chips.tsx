// Spec 311 U1 — the SITE worklist project chip row. At 2+ concurrent active
// projects the non-procurement /requests bands merge every visible project's
// rows; these chips are the disambiguator (ทุกโครงการ + one per project).
// Server-safe presentational component — no 'use client', plain <Link>s
// (deep-linkable, same as the spec-137 view/mine chips). Field-First tokens
// only — mirrors the page's worklistChipClass (fill active / card idle).

import Link from "next/link";

import { PROJECT_FILTER_ARIA } from "@/lib/i18n/labels";
import type { SiteProjectChip } from "@/lib/purchasing/site-project-chips";

interface SiteProjectChipsProps {
  chips: SiteProjectChip[];
}

export function SiteProjectChips({ chips }: SiteProjectChipsProps) {
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
