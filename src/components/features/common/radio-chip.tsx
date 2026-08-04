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
  /** Spec 394 U3 — an option that exists but cannot be chosen yet. Disabling
   *  beats hiding: a hidden option teaches nobody that the mode exists. The
   *  NATIVE disabled attribute is what carries this to assistive tech, so the
   *  label must also say why (the caller supplies that in `label`). */
  disabled?: boolean;
}

export function RadioChip({ name, label, checked, onSelect, className, disabled }: RadioChipProps) {
  return (
    <label
      // shrink-0 + whitespace-nowrap live in the BASE class (feedback bc6df601 /
      // #235): a chip in an overflow-x-auto strip that can shrink wraps its label
      // and stacks the strip vertically — no call site may opt out of the guard.
      className={`rounded-control has-[input:focus-visible]:ring-action inline-flex min-h-11 shrink-0 items-center justify-center border px-3 text-sm whitespace-nowrap transition-colors has-[input:focus-visible]:ring-2 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer active:translate-y-px"
      } ${
        checked
          ? "border-fill bg-fill text-on-fill font-semibold"
          : "border-edge-strong bg-card text-ink-secondary font-medium"
      } ${!checked && !disabled ? "hover:bg-page active:bg-sunk" : ""} ${className ?? ""}`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        disabled={disabled ?? false}
        className="sr-only"
      />
      {label}
    </label>
  );
}
