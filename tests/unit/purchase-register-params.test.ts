// Register drill param guard (chip task_9ed7562b lineage) — a hand-typed
// /requests/reports/register?dim=<any>&key=<non-uuid> used to flow raw into
// loadPurchaseRegister's uuid-typed predicates and 500 the page (project /
// supplier / purchaser; the category path swallowed its error and rendered
// a wrong, silently-empty list instead). parseRegisterSlice is the
// page's extracted param parse: non-UUID non-empty keys resolve to the
// unfiltered window (the /expenses spec-323-U4 posture), while key="" keeps
// meaning the report's unassigned/is-null bucket.

import { describe, expect, it } from "vitest";

import { parseRegisterSlice } from "@/lib/purchasing/purchase-register-params";

const UUID = "8d0b3c1e-5f2a-4b6c-9d7e-1a2b3c4d5e6f";

describe("parseRegisterSlice", () => {
  it("dim=project with a valid uuid key filters by project", () => {
    expect(parseRegisterSlice({ dim: "project", key: UUID })).toEqual({
      projectId: UUID,
    });
  });

  it.each(["supplier", "category", "purchaser"] as const)(
    "dim=%s with a valid uuid key returns that slice",
    (dim) => {
      expect(parseRegisterSlice({ dim, key: UUID })).toEqual({
        slice: { dimension: dim, key: UUID },
      });
    },
  );

  it("accepts an uppercase uuid key (regex is case-insensitive)", () => {
    expect(parseRegisterSlice({ dim: "project", key: UUID.toUpperCase() })).toEqual({
      projectId: UUID.toUpperCase(),
    });
  });

  // The fix: hand-typed garbage keys must mean "no filter", not a 22P02 500.
  it("dim=project with a non-uuid key renders unfiltered", () => {
    expect(parseRegisterSlice({ dim: "project", key: "garbage" })).toEqual({});
  });

  it.each(["supplier", "category", "purchaser"] as const)(
    "dim=%s with a non-uuid key renders unfiltered",
    (dim) => {
      expect(parseRegisterSlice({ dim, key: "not-a-uuid" })).toEqual({});
    },
  );

  it("a near-uuid key (wrong length) renders unfiltered", () => {
    expect(parseRegisterSlice({ dim: "supplier", key: UUID.slice(0, -1) })).toEqual({});
  });

  // key="" is MEANINGFUL — the report's unassigned/is-null bucket.
  it('key="" keeps meaning the unassigned bucket for slice dimensions', () => {
    expect(parseRegisterSlice({ dim: "supplier", key: "" })).toEqual({
      slice: { dimension: "supplier", key: "" },
    });
  });

  it("unassigned=1 forces the unassigned bucket even alongside a garbage key", () => {
    expect(parseRegisterSlice({ dim: "purchaser", key: "garbage", unassigned: "1" })).toEqual({
      slice: { dimension: "purchaser", key: "" },
    });
  });

  it("dim=project with an empty key applies no project filter", () => {
    expect(parseRegisterSlice({ dim: "project", key: "" })).toEqual({});
  });

  it("a missing key behaves like the unassigned bucket (page's key ?? '')", () => {
    expect(parseRegisterSlice({ dim: "supplier" })).toEqual({
      slice: { dimension: "supplier", key: "" },
    });
  });

  it("an unknown dim applies no filter even with a valid uuid key", () => {
    expect(parseRegisterSlice({ dim: "garbage", key: UUID })).toEqual({});
  });

  it("no dim at all applies no filter", () => {
    expect(parseRegisterSlice({})).toEqual({});
  });
});
