// Spec 286 U1 — the office-role self-onboard door. The staff self-registration
// flow (form, docs, queue, approve RPC) is already role-neutral (spec 263/264);
// only the FRONT DOOR is technician-branded. This pure module is the single
// source for the two entry variants' copy + paths, so the two thin route pages
// and the /coming-soon visitor landing all agree.

import { describe, it, expect } from "vitest";
import {
  staffRegisterCopy,
  VISITOR_REGISTER_ENTRIES,
  REGISTER_FIELD_PATH,
  REGISTER_OFFICE_PATH,
} from "@/lib/register/register-entry";
import { REGISTER_FIELD_HEADING, REGISTER_OFFICE_HEADING } from "@/lib/i18n/labels";
import { REGISTER_WORKSPACE_PATH } from "@/lib/auth/visitor-router";

describe("staffRegisterCopy", () => {
  it("field variant → the on-site (technician) door", () => {
    const c = staffRegisterCopy("field");
    expect(c.heading).toBe(REGISTER_FIELD_HEADING);
    expect(c.path).toBe("/register/technician");
    expect(c.loginNext).toBe("/login?next=%2Fregister%2Ftechnician");
  });

  it("office variant → the office door", () => {
    const c = staffRegisterCopy("office");
    expect(c.heading).toBe(REGISTER_OFFICE_HEADING);
    expect(c.path).toBe("/register/office");
    expect(c.loginNext).toBe("/login?next=%2Fregister%2Foffice");
  });
});

describe("register entry paths", () => {
  it("the on-site door equals the shared post-submit workspace path", () => {
    // comingSoonDecision redirects every registered visitor to
    // REGISTER_WORKSPACE_PATH, so the on-site door MUST be that same path.
    expect(REGISTER_FIELD_PATH).toBe(REGISTER_WORKSPACE_PATH);
    expect(REGISTER_FIELD_PATH).toBe("/register/technician");
    expect(REGISTER_OFFICE_PATH).toBe("/register/office");
  });
});

describe("VISITOR_REGISTER_ENTRIES", () => {
  it("offers the on-site door first, then the office door", () => {
    expect(VISITOR_REGISTER_ENTRIES.map((e) => e.path)).toEqual([
      "/register/technician",
      "/register/office",
    ]);
  });

  it("labels each door with its variant heading", () => {
    expect(VISITOR_REGISTER_ENTRIES[0]?.label).toBe(REGISTER_FIELD_HEADING);
    expect(VISITOR_REGISTER_ENTRIES[1]?.label).toBe(REGISTER_OFFICE_HEADING);
  });
});
