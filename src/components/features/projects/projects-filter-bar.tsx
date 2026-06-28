// Feedback 1d648880 — the projects-hub filter + sort bar. Server-safe
// presentational component (no 'use client', no handlers): every chip/sort is a
// plain deep-linkable <Link>, mirroring the procurement worklist chips
// (worklist-status-chips.tsx). The descriptors (labels, counts, hrefs, active)
// come from list-view.ts so the logic stays unit-tested.

import Link from "next/link";

import type { ProjectStatusChip, ProjectSortOption } from "@/lib/projects/list-view";

interface ProjectsFilterBarProps {
  statusChips: ProjectStatusChip[];
  sortOptions: ProjectSortOption[];
}

export function ProjectsFilterBar({ statusChips, sortOptions }: ProjectsFilterBarProps) {
  return (
    <div className="mb-4 flex flex-col gap-2.5">
      {/* Status filter — archived is hidden under "ทั้งหมด" and reachable only via
          its own chip. -mx-5 px-5 bleeds the scroll row to the screen edges. */}
      <div
        role="group"
        aria-label="กรองตามสถานะ"
        className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {statusChips.map((chip) => (
          <Link
            key={chip.key}
            href={chip.href}
            aria-pressed={chip.active}
            className={`focus-visible:ring-action inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px ${
              chip.active
                ? "border-fill bg-fill text-on-fill font-semibold"
                : "border-edge-strong bg-card text-ink-secondary hover:bg-sunk"
            }`}
          >
            <span className="text-sm">{chip.label}</span>
            <span
              className={`text-meta inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-extrabold ${
                chip.active ? "bg-on-fill/20 text-on-fill" : "bg-sunk text-ink-secondary"
              }`}
            >
              {chip.count}
            </span>
          </Link>
        ))}
      </div>

      {/* Sort */}
      <div role="group" aria-label="เรียงลำดับ" className="flex items-center gap-2">
        <span className="text-meta text-ink-muted shrink-0 font-semibold">เรียง</span>
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sortOptions.map((opt) => (
            <Link
              key={opt.key}
              href={opt.href}
              aria-pressed={opt.active}
              className={`focus-visible:ring-action inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 ${
                opt.active
                  ? "border-attn bg-attn-soft text-attn-ink font-semibold"
                  : "border-edge bg-card text-ink-secondary hover:bg-sunk"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
