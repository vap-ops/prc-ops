// Spec 99 — Contacts split into groups. The pure tab-map is the testable seam
// (ContactsTabs renders from it; the group pages fetch per group).
// Spec 168 — the crews group split into separate subcontractors + dc pages, so
// ผู้รับเหมาช่วง and DC are no longer managed on one screen.

import { describe, expect, it } from "vitest";
import { CONTACT_GROUP_TABS, STATUS_TABS } from "@/lib/contacts/groups";

describe("contact groups", () => {
  it("maps each group to its ordered tabs", () => {
    expect(CONTACT_GROUP_TABS.customers).toEqual(["clients"]);
    expect(CONTACT_GROUP_TABS.vendors).toEqual(["suppliers", "service"]);
    // Spec 168: subcontractor and DC are now their own single-type groups.
    expect(CONTACT_GROUP_TABS.subcontractors).toEqual(["contractors"]);
    expect(CONTACT_GROUP_TABS.dc).toEqual(["dc"]);
    // Spec 101: procurement's suppliers-only subset of vendors.
    expect(CONTACT_GROUP_TABS.suppliers).toEqual(["suppliers"]);
  });

  it("has no merged crews group (spec 168 split it)", () => {
    expect("crews" in CONTACT_GROUP_TABS).toBe(false);
  });

  it("covers every contact tab exactly once across the content groups", () => {
    const all = [
      ...CONTACT_GROUP_TABS.customers,
      ...CONTACT_GROUP_TABS.vendors,
      ...CONTACT_GROUP_TABS.subcontractors,
      ...CONTACT_GROUP_TABS.dc,
    ];
    expect(all.sort()).toEqual(["clients", "contractors", "dc", "service", "suppliers"]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("flags exactly the statused tabs (contractors/dc/service)", () => {
    expect([...STATUS_TABS].sort()).toEqual(["contractors", "dc", "service"]);
    expect(STATUS_TABS.has("clients")).toBe(false);
    expect(STATUS_TABS.has("suppliers")).toBe(false);
  });
});
