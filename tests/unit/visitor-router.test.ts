// Writing failing test first.
//
// Spec 264 G3 / ADR 0072 §8 — the /coming-soon page becomes role-aware. For a
// `visitor` it is a context-aware router; for every other (still-unbuilt) role it
// stays the static "tools not ready" landing. The routing decision is a PURE
// function (role + whether the caller has a staff_registration → a discriminated
// outcome), tested here in isolation so the page shell can render/redirect off it
// without a redirect loop.
//
// Feasibility note (spec doc §"Homes / routing"): a visitor's pending STAFF
// registration IS detectable (staff_registrations.user_id = the visitor), but a
// pending contractor/client INVITE is NOT (invites are token-held, unbound to the
// visitor's user_id until claimed). So the router has TWO real arms + a default —
// it never attempts to detect an invite (the invited person already holds their
// claim link).

import { describe, expect, it } from "vitest";

import { comingSoonDecision, type ComingSoonDecision } from "@/lib/auth/visitor-router";
import type { UserRole } from "@/lib/db/enums";

describe("comingSoonDecision (spec 264 G3)", () => {
  it("routes a visitor WITH a staff_registration to their register workspace", () => {
    const d = comingSoonDecision("visitor", true);
    expect(d).toEqual<ComingSoonDecision>({
      kind: "redirect",
      to: "/register/technician",
    });
  });

  it("renders the organic CTA landing for a visitor with NO staff_registration", () => {
    const d = comingSoonDecision("visitor", false);
    expect(d).toEqual<ComingSoonDecision>({ kind: "visitor-landing" });
  });

  // hasStaffRegistration is only ever true for a visitor whose own row exists; a
  // non-visitor role never carries a pending staff_registration that changes its
  // destination here (it has a real role/home already). But even if the flag were
  // somehow set, a non-visitor unbuilt role must NOT be redirected into the
  // register flow — it renders the static "tools not ready" page. Pinned so the
  // visitor arm can never leak to another role.
  it("keeps a non-visitor unbuilt role on the static landing regardless of the flag", () => {
    for (const role of ["hr", "subcon_manager", "site_owner", "auditor"] as const) {
      expect(comingSoonDecision(role, false)).toEqual<ComingSoonDecision>({
        kind: "static",
      });
      expect(comingSoonDecision(role, true)).toEqual<ComingSoonDecision>({
        kind: "static",
      });
    }
  });

  // Redirect-loop safety: the ONLY redirect this function ever emits is a visitor
  // WITH a registration → /register/technician. An organic visitor RENDERS
  // (visitor-landing), never redirects — otherwise /coming-soon (the visitor home
  // of roleHome) would bounce back into the login/home cycle. This test states the
  // invariant directly: no decision redirects a visitor to /coming-soon or /login.
  it("never redirects a visitor back into the /coming-soon or /login cycle", () => {
    const decisions: ComingSoonDecision[] = [
      comingSoonDecision("visitor", true),
      comingSoonDecision("visitor", false),
    ];
    for (const d of decisions) {
      if (d.kind === "redirect") {
        expect(d.to).not.toBe("/coming-soon");
        expect(d.to).not.toBe("/login");
      }
    }
  });

  // The register workspace itself renders the pending/approved/rejected state and
  // does its own approved→home redirect — so the router sends a visitor there for
  // ANY registration status (it does not branch on status).
  it("sends a visitor with a registration to /register/technician for any status", () => {
    // The flag encodes "a row exists" (any status); the page reads the status.
    expect(comingSoonDecision("visitor", true)).toEqual<ComingSoonDecision>({
      kind: "redirect",
      to: "/register/technician",
    });
  });

  it("only a visitor is ever router-eligible (the union is exhaustive)", () => {
    // A compile-time-adjacent runtime check: the function accepts any UserRole and
    // always returns one of the three kinds; visitor is the only role that can
    // yield a non-static outcome.
    const nonVisitor: UserRole = "hr";
    expect(comingSoonDecision(nonVisitor, false).kind).toBe("static");
    expect(comingSoonDecision("visitor", false).kind).toBe("visitor-landing");
  });
});
