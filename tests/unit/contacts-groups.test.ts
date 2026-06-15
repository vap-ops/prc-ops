// Spec 99 — Contacts split into three groups. The pure tab-map is the testable
// seam (ContactsTabs renders from it; the group pages fetch per group).

import { describe, expect, it } from "vitest";
import { CONTACT_GROUP_TABS, STATUS_TABS } from "@/lib/contacts/groups";

describe("contact groups", () => {
  it("maps each group to its ordered tabs", () => {
    expect(CONTACT_GROUP_TABS.customers).toEqual(["clients"]);
    expect(CONTACT_GROUP_TABS.vendors).toEqual(["suppliers", "service"]);
    expect(CONTACT_GROUP_TABS.crews).toEqual(["contractors", "dc"]);
  });

  it("covers every contact tab exactly once across the three groups", () => {
    const all = [
      ...CONTACT_GROUP_TABS.customers,
      ...CONTACT_GROUP_TABS.vendors,
      ...CONTACT_GROUP_TABS.crews,
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
