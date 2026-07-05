// Writing failing test first.
//
// Spec 265 U2 — the two LINE-identity view surfaces. Source-scan pins (mirrors
// registrations-gate-parity.test.ts's style):
//   1. The approval identity block rides /registrations/[id]'s existing
//      STAFF_APPROVAL_ROLES gate (all three approvers), reading the applicant's
//      LINE fields via the ADMIN-client helper scoped to registration.user_id —
//      never a broad users read, never conditional on ctx.role (O1 = show to all
//      three approvers).
//   2. /settings/roles/[id] is a NEW super_admin-ONLY detail route reusing the
//      shared LineIdentityBlock on an RLS-session read (no admin client), reached
//      from the /settings/roles list.
// Both surfaces reuse the single LineIdentityBlock component — the anti-drift
// point of the shared block.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const read = (...segs: string[]) => readFileSync(join(SRC, ...segs), "utf8");

describe("LINE-identity approval surface — /registrations/[id] (spec 265 U2)", () => {
  const page = read("app", "registrations", "[id]", "page.tsx");

  it("renders the shared LineIdentityBlock for the applicant", () => {
    expect(page).toContain("LineIdentityBlock");
  });

  it("reads the applicant's LINE fields via the admin-scoped helper on registration.user_id", () => {
    expect(page).toContain("getLineIdentityByUserId(registration.user_id)");
  });

  it("keeps the page's STAFF_APPROVAL_ROLES gate (block visible to all three approvers)", () => {
    // The block is NOT wrapped in a super_admin-only conditional — the page gate
    // (STAFF_APPROVAL_ROLES) is the whole visibility gate (O1 resolved: all three).
    expect(page).toContain("requireRole(STAFF_APPROVAL_ROLES)");
    // No per-role narrowing of the identity block on this page.
    expect(page).not.toContain('=== "super_admin"');
  });

  it("does NOT use next/image for the LINE avatar (external LINE-CDN URL, plain <img>)", () => {
    const block = read("components", "features", "identity", "line-identity-block.tsx");
    expect(block).not.toContain("next/image");
    expect(block).toContain('referrerPolicy="no-referrer"');
  });
});

describe("LINE-identity employee detail — /settings/roles/[id] (spec 265 U2)", () => {
  const page = read("app", "settings", "roles", "[id]", "page.tsx");

  it("is gated super_admin only", () => {
    expect(page).toContain('requireRole(["super_admin"])');
  });

  it("reads the target user's LINE fields on the RLS session client (no admin client)", () => {
    expect(page).toContain('from("users")');
    expect(page).toContain("line_display_name");
    expect(page).toContain("line_synced_at");
    expect(page).not.toContain("db/admin");
  });

  it("renders the shared LineIdentityBlock beside the app name + role", () => {
    expect(page).toContain("LineIdentityBlock");
    expect(page).toContain("USER_ROLE_LABEL");
  });

  it("carries a DetailHeader back to /settings/roles", () => {
    expect(page).toContain("DetailHeader");
    expect(page).toContain('backHref="/settings/roles"');
  });

  it("is reachable from the /settings/roles list (each row links to its detail)", () => {
    const list = read("components", "features", "roles", "role-admin-list.tsx");
    expect(list).toContain("/settings/roles/${user.id}");
  });
});
