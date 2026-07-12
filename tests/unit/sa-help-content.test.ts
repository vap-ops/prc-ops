// Writing failing test first.
//
// Spec 299 — the /sa/help hub content, kept as typed data (HELP_CARDS) so copy edits
// never touch layout. Cards are ordered by daily-use frequency (photos → muster →
// add-crew → manage), per sa-real-usage-photos-2026-07. The add-crew card (U2) documents
// spec 298's now-live onboarding front door. This guards the structure + anchor-id uniqueness.

import { describe, it, expect } from "vitest";

import { HELP_CARDS } from "@/lib/sa/help-content";

describe("HELP_CARDS — spec 299", () => {
  it("ships the four day-to-day cards, ordered by daily use", () => {
    expect(HELP_CARDS.map((c) => c.id)).toEqual(["photos", "muster", "add-crew", "manage"]);
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
