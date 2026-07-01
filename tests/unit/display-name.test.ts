// Writing failing test first.
//
// Feedback bc6df601 (procurement): the projects-list client filter showed a raw
// UUID pill instead of a client name. That role can't read `public.clients`, so
// the loader's name map missed the id and the chip fell back to the id itself
// (`clientNames.get(key) ?? key`). The CLASS: any "resolve a display name from an
// id" site that falls back to the raw id leaks an internal UUID into the UI
// (siblings: the ทะเบียนวัสดุ category/subcategory section labels). displayName()
// is the single guard — a name-or-neutral-fallback that NEVER echoes an id.

import { describe, it, expect } from "vitest";

import { displayName } from "@/lib/i18n/display-name";
import { UNKNOWN_NAME_LABEL } from "@/lib/i18n/labels";

describe("displayName (feedback bc6df601)", () => {
  it("returns the resolved name unchanged when present", () => {
    expect(displayName("Build All")).toBe("Build All");
    expect(displayName("บ้านคุณกฤษณ์")).toBe("บ้านคุณกฤษณ์");
  });

  it("falls back to a neutral label when the name is missing", () => {
    expect(displayName(undefined)).toBe(UNKNOWN_NAME_LABEL);
    expect(displayName(null)).toBe(UNKNOWN_NAME_LABEL);
    expect(displayName("")).toBe(UNKNOWN_NAME_LABEL);
    expect(displayName("   ")).toBe(UNKNOWN_NAME_LABEL);
  });

  it("never returns a UUID-shaped string (the id must never leak to the UI)", () => {
    // The whole point of the class fix: an unresolved lookup returns undefined,
    // and displayName must not echo whatever id the caller was resolving.
    expect(displayName(undefined)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});
