// Feedback 1d648880 + 7d9d2c2b — the projects-hub filter bar. Server-safe
// presentational component (no 'use client', no handlers): every chip is a plain
// deep-linkable <Link>, mirroring the procurement worklist chips
// (worklist-status-chips.tsx). Two facets — status and client; sorting was
// retired (feedback 7d9d2c2b: "remove all sorting, default sort, focus on
// filtering"). The descriptors come from list-view.ts so the logic stays
// unit-tested.

import Link from "next/link";

import type { ProjectStatusChip, ProjectClientChip } from "@/lib/projects/list-view";

interface ProjectsFilterBarProps {
  statusChips: ProjectStatusChip[];
  clientChips: ProjectClientChip[];
}

const CHIP_BASE =
  "focus-visible:ring-action inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px";
const CHIP_ON = "border-fill bg-fill text-on-fill font-semibold";
const CHIP_OFF = "border-edge-strong bg-card text-ink-secondary hover:bg-sunk";

function FilterChip({ chip }: { chip: ProjectStatusChip | ProjectClientChip }) {
  return (
    <Link
      href={chip.href}
      aria-pressed={chip.active}
      className={`${CHIP_BASE} ${chip.active ? CHIP_ON : CHIP_OFF}`}
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
  );
}

// -mx-5 px-5 bleeds the scroll row to the screen edges.
const ROW =
  "-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export function ProjectsFilterBar({ statusChips, clientChips }: ProjectsFilterBarProps) {
  return (
    <div className="mb-4 flex flex-col gap-2.5">
      {/* Status filter — archived is hidden under "ทั้งหมด" and reachable only
          via its own chip. */}
      <div role="group" aria-label="กรองตามสถานะ" className={ROW}>
        {statusChips.map((chip) => (
          <FilterChip key={chip.key} chip={chip} />
        ))}
      </div>

      {/* Client filter — "ทั้งหมด", a chip per client present, and a no-client
          bucket when any project lacks one. */}
      <div role="group" aria-label="กรองตามลูกค้า" className={ROW}>
        {clientChips.map((chip) => (
          <FilterChip key={chip.key} chip={chip} />
        ))}
      </div>
    </div>
  );
}
