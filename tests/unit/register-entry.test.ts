// Spec 286 U1 — the office-role self-onboard door. The staff self-registration
// flow (form, docs, queue, approve RPC) is already role-neutral (spec 263/264);
// only the FRONT DOOR is technician-branded. This pure module is the single
// source for the two entry variants' copy + paths, so the two thin route pages
// and the /coming-soon visitor landing all agree.

import { describe, it, expect } from "vitest";
import {
  staffRegisterCopy,
  registerLoginNext,
  VISITOR_REGISTER_ENTRIES,
  REGISTER_FIELD_PATH,
  REGISTER_OFFICE_PATH,
  officeInviteParams,
} from "@/lib/register/register-entry";
import { technicianOnboardUrl } from "@/lib/register/onboard-link";
import { safeNextPath } from "@/lib/auth/next-path";
import { REGISTER_FIELD_HEADING, REGISTER_OFFICE_HEADING } from "@/lib/i18n/labels";
import { REGISTER_WORKSPACE_PATH } from "@/lib/auth/visitor-router";

const PROJECT = "123e4567-e89b-12d3-a456-426614174000";
const BY = "223e4567-e89b-12d3-a456-426614174000";
const CONTRACTOR = "323e4567-e89b-12d3-a456-426614174000";

describe("staffRegisterCopy", () => {
  it("field variant → the on-site (technician) door", () => {
    const c = staffRegisterCopy("field");
    expect(c.heading).toBe(REGISTER_FIELD_HEADING);
    expect(c.path).toBe("/register/technician");
  });

  it("office variant → the office door", () => {
    const c = staffRegisterCopy("office");
    expect(c.heading).toBe(REGISTER_OFFICE_HEADING);
    expect(c.path).toBe("/register/office");
  });
});

describe("registerLoginNext", () => {
  function parseNext(loginUrl: string): URL {
    expect(loginUrl.startsWith("/login?next=")).toBe(true);
    const next = decodeURIComponent(loginUrl.slice("/login?next=".length));
    return new URL(next, "https://prc.invalid");
  }

  it("no params → byte-identical to the historical static path", () => {
    expect(registerLoginNext("field")).toBe("/login?next=%2Fregister%2Ftechnician");
    expect(registerLoginNext("office")).toBe("/login?next=%2Fregister%2Foffice");
  });

  it("carries all five QR attribution params through the round-trip", () => {
    const parsed = parseNext(
      registerLoginNext("field", {
        project: PROJECT,
        site: "TFM โพธิ์ทอง",
        by: BY,
        contractor: CONTRACTOR,
        firm: "ช่างอวย",
      }),
    );
    expect(parsed.pathname).toBe("/register/technician");
    expect(parsed.searchParams.get("project")).toBe(PROJECT);
    expect(parsed.searchParams.get("site")).toBe("TFM โพธิ์ทอง");
    expect(parsed.searchParams.get("by")).toBe(BY);
    expect(parsed.searchParams.get("contractor")).toBe(CONTRACTOR);
    expect(parsed.searchParams.get("firm")).toBe("ช่างอวย");
  });

  it("the produced next value passes the login return-path guard unchanged", () => {
    const loginUrl = registerLoginNext("field", {
      project: PROJECT,
      site: "TFM โพธิ์ทอง",
      by: BY,
      contractor: CONTRACTOR,
      firm: "ช่างอวย",
    });
    const next = decodeURIComponent(loginUrl.slice("/login?next=".length));
    expect(safeNextPath(next)).toBe(next);
  });

  it("a slash label (the one content the guard rejects) drops labels, keeps uuid bindings", () => {
    const parsed = parseNext(
      registerLoginNext("field", {
        project: PROJECT,
        site: "โพธิ์ทอง",
        by: BY,
        contractor: CONTRACTOR,
        firm: "a/b",
      }),
    );
    expect(parsed.searchParams.get("project")).toBe(PROJECT);
    expect(parsed.searchParams.get("by")).toBe(BY);
    expect(parsed.searchParams.get("contractor")).toBe(CONTRACTOR);
    expect(parsed.searchParams.get("site")).toBeNull();
    expect(parsed.searchParams.get("firm")).toBeNull();
  });

  it("an '@' in a label is percent-encoded and survives (guard never sees a raw '@')", () => {
    const parsed = parseNext(registerLoginNext("field", { project: PROJECT, site: "evil@label" }));
    expect(parsed.searchParams.get("project")).toBe(PROJECT);
    expect(parsed.searchParams.get("site")).toBe("evil@label");
  });

  it("a non-uuid binding param is dropped; clean labels survive", () => {
    const parsed = parseNext(
      registerLoginNext("field", {
        project: "not-a-uuid",
        site: "โพธิ์ทอง",
        firm: "ช่างอวย",
      }),
    );
    expect(parsed.searchParams.get("project")).toBeNull();
    expect(parsed.searchParams.get("site")).toBe("โพธิ์ทอง");
    expect(parsed.searchParams.get("firm")).toBe("ช่างอวย");
  });

  it("every param minted by technicianOnboardUrl survives into the login next", () => {
    const qr = new URL(
      technicianOnboardUrl("https://app.example", {
        projectId: PROJECT,
        siteLabel: "TFM โพธิ์ทอง",
        inviterId: BY,
        contractorId: CONTRACTOR,
        firmLabel: "ช่างอวย",
      }),
    );
    const parsed = parseNext(
      registerLoginNext("field", {
        project: qr.searchParams.get("project") ?? undefined,
        site: qr.searchParams.get("site") ?? undefined,
        by: qr.searchParams.get("by") ?? undefined,
        contractor: qr.searchParams.get("contractor") ?? undefined,
        firm: qr.searchParams.get("firm") ?? undefined,
      }),
    );
    for (const key of ["project", "site", "by", "contractor", "firm"]) {
      expect(parsed.searchParams.get(key)).toBe(qr.searchParams.get(key));
    }
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

// Spec 342 U2.1 — the office invite parse + the role's login round-trip.
// `role` joins the BINDINGS group of registerLoginNext (not the droppable
// label group): a role key is neither a uuid nor display text, and it must
// survive the label-dropping fallback. The logged-out leg is the historically
// fragile one — the static next-path silently orphaned all 18 real
// registrations' attribution (0/18 invited_by, PR #677).
describe("officeInviteParams", () => {
  const BY = "223e4567-e89b-12d3-a456-426614174000";

  it("accepts a uuid inviter + onboardable role", () => {
    expect(officeInviteParams({ by: BY, role: "accounting" })).toEqual({
      by: BY,
      role: "accounting",
    });
  });

  it("rejects missing/malformed by, missing/prose/non-onboardable role", () => {
    expect(officeInviteParams({ role: "accounting" })).toBeNull();
    expect(officeInviteParams({ by: "not-a-uuid", role: "accounting" })).toBeNull();
    expect(officeInviteParams({ by: BY })).toBeNull();
    expect(officeInviteParams({ by: BY, role: "จัดซื้อ" })).toBeNull();
    expect(officeInviteParams({ by: BY, role: "super_admin" })).toBeNull();
  });
});

describe("registerLoginNext — office invite role threading", () => {
  const BY = "223e4567-e89b-12d3-a456-426614174000";

  it("keeps by + role across the round trip", () => {
    const next = registerLoginNext("office", { by: BY, role: "hr" });
    const decoded = decodeURIComponent(next.slice("/login?next=".length));
    const parsed = new URL(decoded, "https://prc.invalid");
    expect(parsed.pathname).toBe("/register/office");
    expect(parsed.searchParams.get("by")).toBe(BY);
    expect(parsed.searchParams.get("role")).toBe("hr");
  });

  it("drops a garbage role but keeps the by binding", () => {
    const next = registerLoginNext("office", { by: BY, role: "<script>" });
    const decoded = decodeURIComponent(next.slice("/login?next=".length));
    const parsed = new URL(decoded, "https://prc.invalid");
    expect(parsed.searchParams.get("by")).toBe(BY);
    expect(parsed.searchParams.get("role")).toBeNull();
  });
});
