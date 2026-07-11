import { describe, expect, it } from "vitest";

import {
  SEED_PERSONAS,
  SEED_PROJECTS,
  SEED_SITE_ISSUES,
  SEED_WORKERS,
  buildLaborPlan,
  buildPhotoPlan,
  buildWorkPackages,
} from "@/lib/sandbox/seed-data";

// Spec 294: the sandbox demo dataset is pure data — these tests pin the
// invariants the applier script (scripts/seed-sandbox.ts) relies on.

const VALID_ROLES = new Set([
  "super_admin",
  "site_admin",
  "project_manager",
  "project_director",
  "project_coordinator",
  "procurement",
  "procurement_manager",
  "accounting",
  "hr",
  "technician",
  "legal",
  "subcon_manager",
]);

const VALID_WP_STATUSES = new Set([
  "not_started",
  "in_progress",
  "pending_approval",
  "rework",
  "complete",
  "on_hold",
]);

const VALID_PHASES = new Set(["before", "during", "after", "defect", "after_fix"]);

describe("sandbox seed dataset (spec 294)", () => {
  it("personas: unique emails, valid roles, exactly one super_admin", () => {
    const emails = SEED_PERSONAS.map((p) => p.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const p of SEED_PERSONAS) {
      expect(VALID_ROLES.has(p.role), `role ${p.role}`).toBe(true);
      expect(p.fullName.length).toBeGreaterThan(0);
    }
    expect(SEED_PERSONAS.filter((p) => p.role === "super_admin")).toHaveLength(1);
    // one site_admin per seeded project so /sa has a primary site each
    expect(SEED_PERSONAS.filter((p) => p.role === "site_admin").length).toBeGreaterThanOrEqual(2);
  });

  it("projects: two known codes matching supabase/seed.sql", () => {
    expect(SEED_PROJECTS.map((p) => p.code)).toEqual(["PRC-2026-001", "PRC-2026-002"]);
  });

  it("work packages: >=24, unique codes per project, status spread, real category codes", () => {
    const wps = buildWorkPackages();
    expect(wps.length).toBeGreaterThanOrEqual(24);
    for (const project of SEED_PROJECTS) {
      const codes = wps.filter((w) => w.projectCode === project.code).map((w) => w.code);
      expect(codes.length).toBeGreaterThanOrEqual(10);
      expect(new Set(codes).size).toBe(codes.length);
    }
    const statuses = new Set(wps.map((w) => w.status));
    expect(statuses.size).toBeGreaterThanOrEqual(4);
    for (const w of wps) {
      expect(VALID_WP_STATUSES.has(w.status), `status ${w.status}`).toBe(true);
      // W-prefixed hierarchical codes exist in work_categories (migration-seeded)
      expect(w.categoryCode).toMatch(/^W\d{2,4}$/);
      expect(w.name.length).toBeGreaterThan(0);
    }
  });

  it("workers: 8+, positive day rates, valid pay types", () => {
    expect(SEED_WORKERS.length).toBeGreaterThanOrEqual(8);
    for (const w of SEED_WORKERS) {
      expect(w.dayRate).toBeGreaterThan(0);
      expect(["daily", "monthly"]).toContain(w.payType);
    }
  });

  it("site issues reference seeded projects and valid types", () => {
    const projectCodes = new Set(SEED_PROJECTS.map((p) => p.code));
    expect(SEED_SITE_ISSUES.length).toBeGreaterThanOrEqual(4);
    for (const issue of SEED_SITE_ISSUES) {
      expect(projectCodes.has(issue.projectCode)).toBe(true);
      expect(["safety", "weather", "access", "equipment", "other"]).toContain(issue.issueType);
    }
  });

  it("labor plan references seeded workers and WPs, dates within window", () => {
    const wps = buildWorkPackages();
    const base = new Date("2026-07-01T00:00:00Z");
    const rows = buildLaborPlan(base);
    expect(rows.length).toBeGreaterThanOrEqual(15);
    const wpCodes = new Set(wps.map((w) => `${w.projectCode}:${w.code}`));
    for (const row of rows) {
      // labor_logs_tombstone_is_correction: live rows need day_fraction (enum)
      expect(["full", "half"]).toContain(row.dayFraction);
      expect(row.workerIndex).toBeGreaterThanOrEqual(0);
      expect(row.workerIndex).toBeLessThan(SEED_WORKERS.length);
      expect(wpCodes.has(`${row.projectCode}:${row.wpCode}`)).toBe(true);
      const d = new Date(row.workDate);
      const diffDays = (base.getTime() - d.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThanOrEqual(0);
      expect(diffDays).toBeLessThanOrEqual(30);
    }
  });

  it("photo plan references existing WPs with valid phases", () => {
    const wps = buildWorkPackages();
    const wpCodes = new Set(wps.map((w) => `${w.projectCode}:${w.code}`));
    const photos = buildPhotoPlan();
    expect(photos.length).toBeGreaterThanOrEqual(12);
    for (const p of photos) {
      expect(wpCodes.has(`${p.projectCode}:${p.wpCode}`)).toBe(true);
      expect(VALID_PHASES.has(p.phase), `phase ${p.phase}`).toBe(true);
      expect(p.colorHex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
