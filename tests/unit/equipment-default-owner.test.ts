// Writing failing test first.
//
// Operator ask 2026-07-30: "owner defaults to PRI (Preston International Co.,
// Ltd.) as selection". The default is DATA, not a code constant — a company
// name hardcoded in the bundle would be wrong the day the fleet changes hands
// (which is exactly what spec 367 §3 is about). `equipment_owners.is_default`
// carries it; this helper is the only place the flag is read into a form value.
//
// The empty-string return is load-bearing: it is the ADD form's "— เลือกเจ้าของ —"
// sentinel, and the submit button is disabled while ownerId === "". So "no row
// is flagged" must degrade to "the user picks", never to an arbitrary owner.

import { describe, expect, it } from "vitest";
import { pickDefaultOwnerId, type OwnerOption } from "@/lib/equipment/default-owner";

const PRC: OwnerOption = { id: "o1", name: "Preston Construction Co., Ltd." };
const PRI: OwnerOption = { id: "o2", name: "Preston International Co., Ltd.", isDefault: true };

describe("pickDefaultOwnerId", () => {
  it("returns the flagged owner, not the first one in the list", () => {
    expect(pickDefaultOwnerId([PRC, PRI])).toBe("o2");
  });

  it("returns the flagged owner wherever it sits in the list", () => {
    expect(pickDefaultOwnerId([PRI, PRC])).toBe("o2");
  });

  it("returns the picker sentinel when no owner is flagged", () => {
    expect(pickDefaultOwnerId([PRC])).toBe("");
  });

  it("returns the picker sentinel for an empty roster", () => {
    expect(pickDefaultOwnerId([])).toBe("");
  });

  it("treats an explicit isDefault:false as not the default", () => {
    expect(pickDefaultOwnerId([{ ...PRC, isDefault: false }])).toBe("");
  });
});
