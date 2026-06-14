// Byte-pin guard for the canonical UI class constants (spec 65).
//
// Unit 1 (revised), test path (b): the Field-First redesign deliberately
// changes class output, so these pins are REWRITTEN to match the new
// token-driven strings in src/lib/ui/classes.ts. The mechanism is
// unchanged — each constant must equal its exact string; only the
// expected literals moved. A hand-edit that drifts a constant still
// fails here.

import { describe, expect, it } from "vitest";
import {
  BANNER_ERROR,
  BUTTON_CAPTURE,
  BUTTON_PRIMARY,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY,
  BUTTON_SECONDARY_COMPACT,
  BUTTON_SECONDARY_MUTED,
  CARD,
  CRITICAL_BADGE,
  DETAIL_TITLE,
  FIELD_INPUT,
  FIELD_SELECT,
  FIELD_STACKED,
  ICON_CHIP,
  ICON_CHIP_MUTED,
  INLINE_ALERT_TEXT,
  INLINE_ERROR,
  SECTION_HEADING,
  TOAST_ERROR,
  TOAST_SUCCESS,
} from "@/lib/ui/classes";

describe("ui class constants (spec 65) — Field-First pins", () => {
  it("BUTTON_PRIMARY", () => {
    expect(BUTTON_PRIMARY).toBe(
      "inline-flex h-11 items-center justify-center rounded-control bg-fill px-4 text-body font-semibold text-on-fill shadow-card transition-colors hover:bg-fill-press focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-edge disabled:text-ink-muted",
    );
  });

  it("BUTTON_SECONDARY", () => {
    expect(BUTTON_SECONDARY).toBe(
      "inline-flex h-11 items-center justify-center rounded-control border border-edge bg-card px-4 text-body font-semibold text-ink shadow-input transition-colors hover:bg-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:text-ink-muted",
    );
  });

  it("BUTTON_CAPTURE (Field-First hero action)", () => {
    expect(BUTTON_CAPTURE).toBe(
      "inline-flex h-16 w-full items-center justify-center gap-3 rounded-card bg-attn text-lg font-extrabold text-on-attn shadow-card transition-[transform,background-color] hover:bg-attn-press hover:text-on-fill focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-0.5",
    );
  });

  it("ICON_CHIP", () => {
    expect(ICON_CHIP).toBe(
      "inline-flex h-11 w-11 items-center justify-center rounded-control border border-edge bg-card text-ink shadow-card transition-colors hover:bg-sunk active:bg-sunk active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-action",
    );
  });

  it("ICON_CHIP_MUTED", () => {
    expect(ICON_CHIP_MUTED).toBe(
      "inline-flex h-11 w-11 items-center justify-center rounded-control border border-edge bg-card text-ink-secondary shadow-card transition-colors hover:bg-sunk hover:text-ink active:bg-sunk active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-action",
    );
  });

  it("INLINE_ERROR", () => {
    expect(INLINE_ERROR).toBe(
      "rounded-md border border-danger-edge bg-danger-soft px-3 py-2 text-meta text-danger-ink",
    );
  });

  it("CARD", () => {
    expect(CARD).toBe("rounded-card border border-edge bg-card px-4 py-3 shadow-card");
  });

  it("SECTION_HEADING", () => {
    expect(SECTION_HEADING).toBe("mb-3 text-section font-semibold text-ink");
  });

  it("DETAIL_TITLE (display tier; carries a leading- class)", () => {
    expect(DETAIL_TITLE).toBe(
      "text-display leading-snug font-extrabold tracking-tight break-words",
    );
  });

  it("FIELD_INPUT", () => {
    expect(FIELD_INPUT).toBe(
      "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-3 text-body text-ink shadow-input placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-action",
    );
  });

  it("FIELD_SELECT", () => {
    expect(FIELD_SELECT).toBe(
      "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-body text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action",
    );
  });

  it("FIELD_STACKED", () => {
    expect(FIELD_STACKED).toBe(
      "mt-1 w-full rounded-control border border-edge-strong bg-card px-3 py-2 text-body text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-action",
    );
  });

  it("BUTTON_PRIMARY_COMPACT", () => {
    expect(BUTTON_PRIMARY_COMPACT).toBe(
      "inline-flex min-h-11 items-center justify-center rounded-control bg-fill px-4 py-2 text-body font-medium text-on-fill shadow-input transition-colors hover:bg-fill-press active:translate-y-px disabled:opacity-50",
    );
  });

  it("BUTTON_SECONDARY_COMPACT", () => {
    expect(BUTTON_SECONDARY_COMPACT).toBe(
      "inline-flex min-h-11 items-center justify-center rounded-control border border-edge bg-card px-4 py-2 text-body font-medium text-ink-secondary transition-colors hover:bg-sunk",
    );
  });

  it("BUTTON_SECONDARY_MUTED", () => {
    expect(BUTTON_SECONDARY_MUTED).toBe(
      "inline-flex h-11 items-center justify-center rounded-control border border-edge bg-card px-3 text-body font-medium text-ink shadow-input transition-colors hover:bg-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:opacity-60",
    );
  });

  it("INLINE_ALERT_TEXT", () => {
    expect(INLINE_ALERT_TEXT).toBe("text-meta font-medium text-danger");
  });

  it("BANNER_ERROR", () => {
    expect(BANNER_ERROR).toBe(
      "rounded border border-danger-edge bg-danger-soft px-4 py-3 text-body text-danger-ink",
    );
  });

  it("CRITICAL_BADGE (reserved — isCritical engine)", () => {
    expect(CRITICAL_BADGE).toBe(
      "inline-flex items-center gap-1 rounded-full border border-danger-ink bg-danger px-2 py-0.5 text-meta font-extrabold text-on-fill",
    );
  });

  it("TOAST_SUCCESS", () => {
    expect(TOAST_SUCCESS).toBe("border-done bg-done/10 text-done-strong");
  });

  it("TOAST_ERROR", () => {
    expect(TOAST_ERROR).toBe("border-danger-edge bg-danger-soft text-danger-ink");
  });
});
