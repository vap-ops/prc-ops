// Writing failing test first.
//
// Spec 264 G3 / ADR 0072 §8 — the /coming-soon page revamp. Source-scan pins that
// the page routes a `visitor` through the PURE comingSoonDecision (tested
// exhaustively in visitor-router.test.ts) rather than re-implementing the branch,
// reads the visitor's staff_registration on the RLS SESSION (own-row policy,
// never the admin client), and preserves the existing non-visitor bounces
// (site_admin / project_manager / project_director) — the change must not break
// other roles. The redirect-loop invariant is proven at the pure-function layer;
// here we pin that the page delegates to it and only ever redirects a visitor to
// the register workspace.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app");
const read = (...segs: string[]) => readFileSync(join(APP, ...segs), "utf8");

describe("/coming-soon visitor router (spec 264 G3)", () => {
  const page = read("coming-soon", "page.tsx");

  it("routes the visitor arm through the pure comingSoonDecision (no re-implemented branch)", () => {
    expect(page).toContain("comingSoonDecision");
    expect(page).toContain('from "@/lib/auth/visitor-router"');
  });

  it("reads the visitor's staff_registration on the RLS session, never the admin client", () => {
    // The applicant reads its OWN row via the reused own-registration helper.
    expect(page).toContain("getOwnTechnicianRegistration");
    expect(page).not.toContain('from "@/lib/db/admin"');
    expect(page).not.toContain("createAdminClient");
  });

  it("keeps the existing non-visitor bounces (must not break other roles)", () => {
    expect(page).toContain('if (role === "site_admin") redirect("/projects")');
    expect(page).toContain('if (role === "project_manager") redirect("/review")');
    expect(page).toContain('if (role === "project_director") redirect("/review")');
  });

  it("delegates the bare-visitor landing to the shared VisitorLanding (spec 286 U1)", () => {
    // The organic CTA(s) + invite note now live in the extracted, unit-tested
    // VisitorLanding component (visitor-landing.test.tsx pins both self-onboard
    // doors + the invite note) — the page just renders it for the visitor arm.
    expect(page).toContain("VisitorLanding");
    expect(page).toContain('from "@/components/features/register/visitor-landing"');
  });

  it("only ever redirects a visitor via the pure decision (loop-safe)", () => {
    // The visitor arm's sole redirect uses the pure module's decision (whose only
    // redirect target is REGISTER_WORKSPACE_PATH, proven loop-safe in
    // visitor-router.test.ts) — never a hard-coded /coming-soon or /login.
    expect(page).toContain("redirect(decision.to)");
  });
});
