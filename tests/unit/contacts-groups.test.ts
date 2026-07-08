// Spec 99 — Contacts split into groups. The pure tab-map is the testable seam
// (ContactsTabs renders from it; the group pages fetch per group).
// Spec 168 — the crews group split into separate subcontractors + dc pages.
// ADR 0062 U5 (2026-06-23) — DC is a WORKER (no DC firm), managed under ทีมงาน
// (/workers); the /contacts/dc party group + its 'dc' tab are removed, so the
// contacts groups no longer carry 'dc'.

import { describe, expect, it } from "vitest";
import { CONTACT_GROUP_TABS, STATUS_TABS } from "@/lib/contacts/groups";

describe("contact groups", () => {
  it("maps each group to its ordered tabs", () => {
    expect(CONTACT_GROUP_TABS.customers).toEqual(["clients"]);
    expect(CONTACT_GROUP_TABS.vendors).toEqual(["suppliers", "service"]);
    expect(CONTACT_GROUP_TABS.subcontractors).toEqual(["contractors"]);
    // Spec 101: procurement's suppliers-only subset of vendors.
    expect(CONTACT_GROUP_TABS.suppliers).toEqual(["suppliers"]);
  });

  it("has no merged crews group, and no DC group (ADR 0062 U5 removed it)", () => {
    expect("crews" in CONTACT_GROUP_TABS).toBe(false);
    expect("dc" in CONTACT_GROUP_TABS).toBe(false);
  });

  it("covers every contact tab exactly once across the content groups", () => {
    const all = [
      ...CONTACT_GROUP_TABS.customers,
      ...CONTACT_GROUP_TABS.vendors,
      ...CONTACT_GROUP_TABS.subcontractors,
    ];
    expect(all.sort()).toEqual(["clients", "contractors", "service", "suppliers"]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("flags exactly the statused tabs (contractors/service/suppliers)", () => {
    // Spec 280 P2: suppliers gained contact_status (spec 275 U0) — the blacklist is
    // now wired into the contacts UI, so the suppliers tab carries the status filter.
    expect([...STATUS_TABS].sort()).toEqual(["contractors", "service", "suppliers"]);
    expect(STATUS_TABS.has("clients")).toBe(false);
    expect(STATUS_TABS.has("suppliers")).toBe(true);
  });
});
