// Unit tests for the project-settings validators (spec 58 / ADR 0042).
// The RPC re-validates server-side; this is the form's fast feedback.

import { describe, it, expect } from "vitest";

import {
  PROJECT_NAME_MAX,
  validateProjectName,
  isValidProjectStatus,
  SITE_ADDRESS_MAX,
  validateSiteAddress,
  validateBudgetAmount,
  validatePlannedCompletionDate,
  validateProjectDates,
  validateGmapUrl,
  GMAP_URL_MAX,
  isValidProjectType,
  PROJECT_TYPES,
  PROJECT_TYPE_LABEL,
} from "@/lib/projects/validate-settings";

describe("validateProjectName", () => {
  it("trims surrounding whitespace and accepts a normal name", () => {
    const r = validateProjectName("  TFG Lam Sonthi  ");
    expect(r).toEqual({ ok: true, name: "TFG Lam Sonthi" });
  });

  it("rejects blank / whitespace-only with a Thai message", () => {
    for (const raw of ["", "   ", "\n\t"]) {
      const r = validateProjectName(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("accepts exactly PROJECT_NAME_MAX chars, rejects one more (post-trim)", () => {
    expect(validateProjectName("ก".repeat(PROJECT_NAME_MAX)).ok).toBe(true);
    expect(validateProjectName("ก".repeat(PROJECT_NAME_MAX + 1)).ok).toBe(false);
    // Whitespace padding around an at-cap name still passes — cap applies
    // to the trimmed value.
    expect(validateProjectName(`  ${"ก".repeat(PROJECT_NAME_MAX)}  `).ok).toBe(true);
  });
});

describe("isValidProjectStatus", () => {
  it("accepts exactly the four enum values", () => {
    for (const v of ["active", "on_hold", "completed", "archived"]) {
      expect(isValidProjectStatus(v)).toBe(true);
    }
  });

  it("rejects junk and non-strings", () => {
    for (const v of ["deleted", "ACTIVE", "", null, undefined, 7, {}]) {
      expect(isValidProjectStatus(v)).toBe(false);
    }
  });
});

// ---- Spec 79: project metadata + client ----

describe("validateSiteAddress (optional, ≤255)", () => {
  it("blank/whitespace is allowed and normalizes to null (optional field)", () => {
    for (const raw of ["", "   ", "\n"]) {
      expect(validateSiteAddress(raw)).toEqual({ ok: true, value: null });
    }
  });

  it("trims and accepts a normal address", () => {
    expect(validateSiteAddress("  123 ถนนสุขุมวิท  ")).toEqual({
      ok: true,
      value: "123 ถนนสุขุมวิท",
    });
  });

  it("accepts exactly SITE_ADDRESS_MAX chars, rejects one more (post-trim)", () => {
    expect(validateSiteAddress("ก".repeat(SITE_ADDRESS_MAX)).ok).toBe(true);
    const over = validateSiteAddress("ก".repeat(SITE_ADDRESS_MAX + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.length).toBeGreaterThan(0);
  });
});

// ---- Spec 174: project Google-Maps link (precise pin, pasted share URL) ----
describe("validateGmapUrl (optional Google-Maps link)", () => {
  it("blank/whitespace is allowed and normalizes to null", () => {
    for (const raw of ["", "   ", "\n"]) {
      expect(validateGmapUrl(raw)).toEqual({ ok: true, value: null });
    }
  });

  it("accepts Google-Maps share + place links (trimmed)", () => {
    for (const url of [
      "https://maps.app.goo.gl/AbCdEf123",
      "https://goo.gl/maps/XyZ",
      "https://www.google.com/maps/place/Site/@13.7,100.5,17z",
      "https://maps.google.com/?q=13.7,100.5",
      "https://www.google.co.th/maps?q=13.7,100.5",
    ]) {
      expect(validateGmapUrl(`  ${url}  `)).toEqual({ ok: true, value: url });
    }
  });

  it("rejects non-Google hosts, non-https, and look-alike domains", () => {
    for (const bad of [
      "http://www.google.com/maps", // not https
      "https://evil.com/maps",
      "https://google.com.evil.com/maps", // look-alike (registrable domain is evil.com)
      "javascript:alert(1)",
      "not a url",
      "ftp://maps.google.com",
    ]) {
      const r = validateGmapUrl(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("rejects an over-length URL", () => {
    const tooLong = `https://maps.app.goo.gl/${"a".repeat(GMAP_URL_MAX)}`;
    expect(validateGmapUrl(tooLong).ok).toBe(false);
  });
});

describe("validateBudgetAmount (money, optional, ≥0)", () => {
  it("blank is allowed → null", () => {
    expect(validateBudgetAmount("")).toEqual({ ok: true, value: null });
    expect(validateBudgetAmount("   ")).toEqual({ ok: true, value: null });
  });

  it("accepts a positive amount and rounds to 2 decimals", () => {
    expect(validateBudgetAmount("1500000")).toEqual({ ok: true, value: 1500000 });
    expect(validateBudgetAmount("1234.567")).toEqual({ ok: true, value: 1234.57 });
  });

  it("rejects negative, non-numeric, and over-cap with Thai messages", () => {
    for (const raw of ["-1", "abc", "1e500"]) {
      const r = validateBudgetAmount(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });
});

describe("validatePlannedCompletionDate (optional, not past relative to a given today)", () => {
  it("null/blank is allowed", () => {
    expect(validatePlannedCompletionDate(null, "2026-06-13").ok).toBe(true);
    expect(validatePlannedCompletionDate("", "2026-06-13").ok).toBe(true);
  });

  it("today and future are accepted; past is rejected", () => {
    expect(validatePlannedCompletionDate("2026-06-13", "2026-06-13").ok).toBe(true);
    expect(validatePlannedCompletionDate("2026-12-31", "2026-06-13").ok).toBe(true);
    const past = validatePlannedCompletionDate("2026-06-12", "2026-06-13");
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.error.length).toBeGreaterThan(0);
  });
});

describe("validateProjectDates (completion ≥ start)", () => {
  it("passes when either is null or completion ≥ start", () => {
    expect(validateProjectDates(null, null).ok).toBe(true);
    expect(validateProjectDates("2026-01-01", null).ok).toBe(true);
    expect(validateProjectDates(null, "2026-01-01").ok).toBe(true);
    expect(validateProjectDates("2026-01-01", "2026-06-01").ok).toBe(true);
    expect(validateProjectDates("2026-06-01", "2026-06-01").ok).toBe(true);
  });

  it("rejects completion before start", () => {
    const r = validateProjectDates("2026-06-01", "2026-01-01");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

describe("project_type enum helpers", () => {
  it("PROJECT_TYPES has the six operator-chosen values", () => {
    expect([...PROJECT_TYPES]).toEqual([
      "new_building",
      "renovation",
      "factory_warehouse",
      "infrastructure",
      "systems",
      "other",
    ]);
  });

  it("every value has a non-empty Thai label", () => {
    for (const t of PROJECT_TYPES) {
      expect(PROJECT_TYPE_LABEL[t].length).toBeGreaterThan(0);
    }
  });

  it("isValidProjectType accepts the enum values, rejects junk/non-strings", () => {
    for (const v of PROJECT_TYPES) expect(isValidProjectType(v)).toBe(true);
    for (const v of ["building", "NEW_BUILDING", "", null, undefined, 3, {}]) {
      expect(isValidProjectType(v)).toBe(false);
    }
  });
});
