import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Spec 122: feature components must live in domain subfolders, never loose in
// the features root. This is the structural guard — it fails until every
// component has been moved into one of the allowed domains.

const FEATURES_DIR = join(process.cwd(), "src", "components", "features");

const ALLOWED_DOMAINS = [
  "purchasing",
  "work-packages",
  // Spec 330: the per-project team map (ทีมงานโครงการ) feature components.
  "team-map",
  "photos",
  "labor",
  // Spec 329: the company documents library (เอกสารบริษัท).
  "company-docs",
  // Spec 320: the temporary payout-nominee PM surface (form + clear button).
  "payroll",
  "contacts",
  "chrome",
  "common",
  "portal",
  "equipment",
  "nova",
  // Spec 175: the item catalog (storage / inventory) feature components.
  "catalog",
  // Spec 176: the supply plan (PM material planning) feature components.
  "supply-plan",
  // Spec 177: the on-site store (stock-in / on-hand) feature components.
  "store",
  // Spec 183: the ภาพรวม dashboard feature components (pending-approvals card).
  "dashboard",
  // Spec 193: the in-app feedback (bug/feature report) form.
  "feedback",
  // Spec 192 U4 / 273 / 277 P0: the site-admin daily home (/sa) feature components
  // (daily-plan worklist, muster strip, tools grid, camera FAB, action section).
  "sa",
  // Spec 212: the SA daily report (LINE Flex preview button, capture screen).
  "daily-report",
  // Spec 306 U3: the morning-talk muster cockpit (team forming + scan/tap
  // check-in/out) and its BarcodeDetector QR camera layer.
  "muster",
  // Spec 318 U2: notification readiness (OA add-friend banner, preferences UI).
  "notifications",
  // Feedback 1d648880: the projects-hub filter/sort bar.
  "projects",
  // Spec 220 (G63): the super_admin role-admin controls.
  "roles",
  // Spec 233 / ADR 0067: the temporary client progress portal (PD invite block).
  "client-portal",
  // Spec 237 (ADR 0066 S10): the BOQ estimate authoring components (template + line).
  "boq",
  // Spec 244 (ADR 0068 Tier B): the SA usage-telemetry provider + consent notice.
  "telemetry",
  // Spec 263 U2: the technician self-registration workspace (e-card, progressive
  // form, document uploads, Web Share button).
  "register",
  // Spec 263 U3: the back-office approval queue + review detail (approve/reject
  // control, read-only document viewer, queue list rows) — shared by the
  // procurement_manager/project_director/super_admin queue AND the SA read-only
  // view (site_owner is a forward seam, not yet a reachable surface).
  "registrations",
  // Spec 265 U2: the shared super_admin LINE-identity verification block
  // (LineIdentityBlock) reused by /registrations/[id] and /settings/roles/[id].
  "identity",
  // Spec 284 U5 / ADR 0080: the Legal department surfaces (home cards, contract
  // create form, void control, document-decision form).
  "legal",
  // Spec 291 U2: the /profile digital employee-ID card.
  "profile",
  // Spec 310: non-WP office expenses (card registry + expense form/list/queue).
  "expenses",
] as const;

describe("feature components are grouped into domain folders", () => {
  it("has no .tsx file directly in the features root", () => {
    const looseTsx = readdirSync(FEATURES_DIR).filter((e) => e.endsWith(".tsx"));
    expect(looseTsx).toEqual([]);
  });

  it("contains only known domain subfolders", () => {
    const dirs = readdirSync(FEATURES_DIR).filter((e) =>
      statSync(join(FEATURES_DIR, e)).isDirectory(),
    );
    for (const dir of dirs) {
      expect(ALLOWED_DOMAINS).toContain(dir as (typeof ALLOWED_DOMAINS)[number]);
    }
  });

  it("every domain folder exists and holds at least one component", () => {
    const dirs = readdirSync(FEATURES_DIR).filter((e) =>
      statSync(join(FEATURES_DIR, e)).isDirectory(),
    );
    for (const domain of ALLOWED_DOMAINS) {
      expect(dirs).toContain(domain);
      const files = readdirSync(join(FEATURES_DIR, domain)).filter((f) => f.endsWith(".tsx"));
      expect(files.length).toBeGreaterThan(0);
    }
  });
});
