// Feedback f625f04d — "Deliverables and client portal settings sounds like
// something that should not be on the wp list page." The project page IS the
// WP list; per-project CONFIG (งวดงาน manager, หมวดงาน manager, client-portal
// access) lives on the settings page behind the gear chip. Static composition
// guard so a future unit doesn't drift the config blocks back onto the list
// page (they accreted there one spec at a time: 164, 207, 233, 234).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app");
const read = (...segs: string[]) => readFileSync(join(APP, ...segs), "utf8");

const CONFIG_BLOCKS = [
  "DeliverablesManager",
  "CategoriesManager",
  "ClientInviteBlock",
  "ClientGrantExisting",
];

describe("project config placement (feedback f625f04d)", () => {
  it("the project page (WP list) renders none of the config blocks", () => {
    const src = read("projects", "[projectId]", "page.tsx");
    for (const block of CONFIG_BLOCKS) {
      expect(src, `${block} must not sit on the WP list page — it moved to settings`).not.toContain(
        block,
      );
    }
  });

  it("the project settings page renders all four config blocks", () => {
    const src = read("projects", "[projectId]", "settings", "page.tsx");
    for (const block of CONFIG_BLOCKS) {
      expect(src, `${block} must render on the settings page`).toContain(`<${block}`);
    }
  });

  // Spec 233 pin: PM must NOT issue client logins — the page-level
  // requireRole(PM_ROLES) admits PM, so the client blocks need their own
  // CLIENT_ISSUER_ROLES (PD + super) gate inside the settings page.
  it("client blocks stay behind the CLIENT_ISSUER_ROLES gate on settings", () => {
    const src = read("projects", "[projectId]", "settings", "page.tsx");
    expect(src).toContain("CLIENT_ISSUER_ROLES");
  });

  it("the onboarding deliverables step deep-links to the settings page", () => {
    const src = read("projects", "[projectId]", "onboarding-checklist.tsx");
    expect(src).toMatch(/projectSettingsHref\(projectId\)\}#deliverables/);
  });
});
