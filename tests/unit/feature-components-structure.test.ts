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
  "photos",
  "labor",
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
  // Spec 192 U4b: the site-admin daily home (/sa) feature components (DailyHero).
  "sa",
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
