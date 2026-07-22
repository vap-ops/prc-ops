// Writing failing test first.
//
// Spec 299 — the /sa/help hub content, kept as typed data (HELP_CARDS) so copy edits
// never touch layout. Cards are ordered by daily-use frequency (photos → muster →
// add-crew → manage), per sa-real-usage-photos-2026-07. The add-crew card (U2) documents
// spec 298's now-live onboarding front door. This guards the structure + anchor-id uniqueness.

import { describe, it, expect } from "vitest";

import { HELP_CARDS } from "@/lib/sa/help-content";

describe("HELP_CARDS — spec 299", () => {
  // Spec 339 U1: the cold-restart card is troubleshooting, not a daily task, so it
  // sits AFTER the daily-use block rather than joining its frequency ordering. It
  // is text-only and points at /settings → เกี่ยวกับ, which carries the illustrated
  // version (that page is reachable by every role; /sa/help is site_admin-gated).
  it("ships the four day-to-day cards in daily-use order, then troubleshooting", () => {
    expect(HELP_CARDS.map((c) => c.id)).toEqual([
      "photos",
      "muster",
      "add-crew",
      "manage",
      "cold-restart",
    ]);
  });

  it("the cold-restart card sends the reader to the illustrated card on /settings", () => {
    const card = HELP_CARDS.find((c) => c.id === "cold-restart");
    expect(card).toBeDefined();
    expect(`${card?.tip ?? ""}${card?.steps.join(" ")}`).toMatch(/ตั้งค่า/);
  });

  it("every card has a title, a when-to-use, and non-empty steps", () => {
    for (const c of HELP_CARDS) {
      expect(c.title.trim().length).toBeGreaterThan(0);
      expect(c.whenToUse.trim().length).toBeGreaterThan(0);
      expect(c.steps.length).toBeGreaterThan(0);
      expect(c.steps.every((s) => s.trim().length > 0)).toBe(true);
    }
  });

  it("has unique anchor ids", () => {
    expect(new Set(HELP_CARDS.map((c) => c.id)).size).toBe(HELP_CARDS.length);
  });
});
