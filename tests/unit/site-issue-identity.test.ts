import { describe, it, expect } from "vitest";
import { SITE_ISSUE_TYPES, SITE_ISSUE_TYPE_ICON } from "@/lib/site-issues/identity";
import { SITE_ISSUE_TYPE_LABEL } from "@/lib/i18n/labels";
import { Constants } from "@/lib/db/database.types";

// The DB enum is the SSOT for the set of types (spec 277 P1a).
const ENUM_TYPES = Constants.public.Enums.site_issue_type;

describe("site-issue identity", () => {
  it("SITE_ISSUE_TYPES lists exactly the DB enum values", () => {
    expect([...SITE_ISSUE_TYPES].sort()).toEqual([...ENUM_TYPES].sort());
  });

  it("every type has a non-empty Thai label", () => {
    for (const t of ENUM_TYPES) {
      expect(SITE_ISSUE_TYPE_LABEL[t]).toBeTruthy();
      expect(typeof SITE_ISSUE_TYPE_LABEL[t]).toBe("string");
    }
  });

  it("every type has an icon (exhaustive map)", () => {
    for (const t of ENUM_TYPES) {
      expect(SITE_ISSUE_TYPE_ICON[t]).toBeTruthy();
    }
  });
});
