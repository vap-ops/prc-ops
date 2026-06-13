// Spec 65 §B — pins for the new canonical chrome constants. Every value
// here is byte-identical to the hand-rolled string it replaced; a change
// to any of them is a deliberate design decision, not a refactor.
import { describe, expect, it } from "vitest";

import {
  BANNER_ERROR,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  BUTTON_SECONDARY_MUTED,
  CARD,
  DETAIL_TITLE,
  FIELD_INPUT,
  FIELD_SELECT,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
  SECTION_HEADING,
} from "@/lib/ui/classes";

describe("spec 65 chrome constants (byte pins)", () => {
  it("CARD is unchanged (spec 63 value)", () => {
    expect(CARD).toBe("rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm");
  });

  it("SECTION_HEADING", () => {
    expect(SECTION_HEADING).toBe("mb-3 text-base font-semibold text-zinc-900");
  });

  it("DETAIL_TITLE", () => {
    // Spec 67: carries leading-snug (Thai wrapping-heading leading).
    expect(DETAIL_TITLE).toBe("text-2xl leading-snug font-bold tracking-tight break-words");
  });

  it("FIELD_INPUT", () => {
    expect(FIELD_INPUT).toBe(
      "h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700",
    );
  });

  it("FIELD_SELECT", () => {
    expect(FIELD_SELECT).toBe(
      "h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-2 text-sm text-zinc-900 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700",
    );
  });

  it("FIELD_STACKED", () => {
    expect(FIELD_STACKED).toBe(
      "mt-1 w-full rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700",
    );
  });

  it("BUTTON_PRIMARY_COMPACT", () => {
    expect(BUTTON_PRIMARY_COMPACT).toBe(
      "inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-slate-800 active:translate-y-px disabled:opacity-50",
    );
  });

  it("BUTTON_SECONDARY_COMPACT", () => {
    expect(BUTTON_SECONDARY_COMPACT).toBe(
      "inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50",
    );
  });

  it("BUTTON_SECONDARY_MUTED", () => {
    expect(BUTTON_SECONDARY_MUTED).toBe(
      "inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 shadow-xs transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:opacity-60",
    );
  });

  it("INLINE_ALERT_TEXT", () => {
    expect(INLINE_ALERT_TEXT).toBe("text-xs font-medium text-red-700");
  });

  it("BANNER_ERROR", () => {
    expect(BANNER_ERROR).toBe(
      "rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900",
    );
  });
});
