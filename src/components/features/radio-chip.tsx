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
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-blue-700 ${
        checked
          ? "border-slate-900 bg-slate-900 font-semibold text-white"
          : "border-zinc-300 bg-white font-medium text-zinc-700 hover:bg-zinc-50"
      } ${className ?? ""}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {label}
    </label>
  );
}
