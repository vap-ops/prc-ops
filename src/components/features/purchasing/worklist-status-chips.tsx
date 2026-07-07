// Spec 138 U3 — the scrollable status-chip filter. A horizontally-scrollable row of band
// pills (ทั้งหมด / อนุมัติแล้ว / กำลังจัดส่ง / เกินกำหนด), each with a live count, replacing the
// procurement status <select>. Server-safe presentational component — no 'use client', no
// handlers; each pill is a plain <Link> (deep-linkable, same as the spec-137 site chips).
// Field-First tokens only — mirrors the page's worklistChipClass (fill active / card idle).

import Link from "next/link";

import type { WorklistStatusChip } from "@/lib/purchasing/worklist-status-chips";

interface WorklistStatusChipsProps {
  chips: WorklistStatusChip[];
}

export function WorklistStatusChips({ chips }: WorklistStatusChipsProps) {
  return (
    // -mx-5 px-5 lets the row bleed to the screen edges on phone so the overflow scroll feels
    // native; the page section's own px-5 is cancelled here and restored as inner padding.
    <div
      role="group"
      aria-label="กรองตามสถานะ"
      className="-mx-5 flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((chip) => (
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
          <chip.icon aria-hidden className="size-4 shrink-0" />
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
  );
}
