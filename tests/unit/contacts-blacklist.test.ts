// Spec 261 / ADR 0070 item 4 — the blacklist boundary predicate the contractor
// server action gates on (manager-tier only to cross into/out of 'blacklisted').
import { describe, expect, it } from "vitest";

import { crossesBlacklistBoundary } from "@/lib/contacts/blacklist";

describe("crossesBlacklistBoundary (spec 261 item 4)", () => {
  it("is true when ENTERING blacklist (incl. create-as-blacklisted)", () => {
    expect(crossesBlacklistBoundary("active", "blacklisted")).toBe(true);
    expect(crossesBlacklistBoundary("probation", "blacklisted")).toBe(true);
    expect(crossesBlacklistBoundary(null, "blacklisted")).toBe(true);
    expect(crossesBlacklistBoundary(undefined, "blacklisted")).toBe(true);
  });

  it("is true when LEAVING blacklist (unblacklist)", () => {
    expect(crossesBlacklistBoundary("blacklisted", "active")).toBe(true);
    expect(crossesBlacklistBoundary("blacklisted", "probation")).toBe(true);
  });

  it("is false for ordinary status moves and the blacklist no-op", () => {
    expect(crossesBlacklistBoundary("active", "probation")).toBe(false);
    expect(crossesBlacklistBoundary("probation", "active")).toBe(false);
    expect(crossesBlacklistBoundary("active", "active")).toBe(false);
    expect(crossesBlacklistBoundary("blacklisted", "blacklisted")).toBe(false);
    expect(crossesBlacklistBoundary(null, "active")).toBe(false);
  });
});
