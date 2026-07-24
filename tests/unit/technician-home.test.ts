// Writing failing test first.
//
// Spec 264 G3 / ADR 0072 §8 — the new minimal /technician home, the anti-dead-end
// landing an approved technician reaches (roleHome('technician') → /technician,
// pinned in role-home.test.ts). Source-scan pins (mirrors
// registrations-gate-parity.test.ts): the page must gate to the technician role
// ONLY, read its data on the RLS session (never the admin client — the applicant
// reads its own row), reuse the shipped EmployeeCard + own-registration resolver,
// and carry the assigned-WPs surface (spec 264 placeholder → spec 350 real card).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app");
const read = (...segs: string[]) => readFileSync(join(APP, ...segs), "utf8");

describe("/technician home (spec 264 G3)", () => {
  const page = read("technician", "page.tsx");

  it("gates to the technician role only", () => {
    expect(page).toContain('requireRole(["technician"])');
  });

  it("reads on the RLS session client, never the admin client", () => {
    expect(page).toContain('from "@/lib/db/server"');
    expect(page).not.toContain('from "@/lib/db/admin"');
    expect(page).not.toContain("createAdminClient");
  });

  it("reuses the shipped e-card + own-registration read (no re-roll)", () => {
    expect(page).toContain("EmployeeCard");
    // The own-row read helper + the card-photo resolver are reused, not re-rolled.
    expect(page).toContain("getOwnTechnicianRegistration");
    expect(page).toContain("resolveCardPhoto");
  });

  it("wires the assigned-work card, retiring the coming-soon placeholder (spec 350)", () => {
    // The room-to-grow slot is now the real card (get_my_assigned_work → view → card).
    expect(page).toContain("AssignedWorkCard");
    expect(page).toContain("buildAssignedWorkView");
    expect(page).not.toContain("ComingSoonBadge");
  });

  it("is a role-home destination — no DetailHeader back chip (spec 63 nav rule)", () => {
    // Like /portal and /client, /technician is a primary landing, not a drill-down.
    expect(page).not.toContain("DetailHeader");
  });
});
