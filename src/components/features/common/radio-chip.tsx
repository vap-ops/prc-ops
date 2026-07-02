"use client";

// Accessible segmented-control / radio chip (spec 67). A label-wrapped
// NATIVE radio (sr-only) — so arrow-key navigation and screen-reader
// semantics come from the browser, not a hand-rolled role="radio" on a
// <button> that announces a keyboard contract it never honoured. 44px
// target (min-h-11, §7 floor); solid slate fill when selected; focus ring
// driven by the inner input. One radiogroup = one shared `name`.
//
// Extracted from generate-report-button's RadioChip and adopted by the
// WP-list view filter and the worker-type picker (which were fake
// role="radio" buttons).

import type { ReactNode } from "react";

interface RadioChipProps {
  /** Shared across the group — native radios with one name form the group. */
  name: string;
  label: ReactNode;
  checked: boolean;
  onSelect: () => void;
  className?: string;
}

export function RadioChip({ name, label, checked, onSelect, className }: RadioChipProps) {
  return (
    <label
      // shrink-0 + whitespace-nowrap live in the BASE class (feedback bc6df601 /
      // #235): a chip in an overflow-x-auto strip that can shrink wraps its label
      // and stacks the strip vertically — no call site may opt out of the guard.
      className={`rounded-control has-[input:focus-visible]:ring-action inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center border px-3 text-sm whitespace-nowrap transition-colors active:translate-y-px has-[input:focus-visible]:ring-2 ${
        checked
          ? "border-fill bg-fill text-on-fill font-semibold"
          : "border-edge-strong bg-card text-ink-secondary hover:bg-page active:bg-sunk font-medium"
      } ${className ?? ""}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {label}
    </label>
  );
}
