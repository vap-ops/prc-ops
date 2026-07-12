import { describe, it, expect } from "vitest";
import { SETTINGS_SECTIONS, visibleEntries, type SettingsEntry } from "@/app/settings/sections";
import type { UserRole } from "@/lib/db/enums";

function linkHrefsFor(role: UserRole): string[] {
  return SETTINGS_SECTIONS.flatMap((s) => visibleEntries(s, role))
    .filter((e): e is Extract<SettingsEntry, { kind: "link" }> => e.kind === "link")
    .map((e) => e.href);
}

describe("spec 310 — company-card registry settings entry", () => {
  it("exposes /settings/cards to super_admin", () => {
    expect(linkHrefsFor("super_admin")).toContain("/settings/cards");
  });

  it("hides /settings/cards from procurement", () => {
    expect(linkHrefsFor("procurement")).not.toContain("/settings/cards");
  });

  it("hides /settings/cards from accounting", () => {
    expect(linkHrefsFor("accounting")).not.toContain("/settings/cards");
  });
});
