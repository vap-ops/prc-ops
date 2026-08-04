// Writing failing test first.
//
// Spec 396 U2 — the identity-resolution rules behind "whose record is this".
// These live in a pure module precisely because /workers is a Server Component
// the suite cannot render, and these decisions (what counts as a name, what a
// lookup miss means) are the part worth pinning.

import { describe, expect, it } from "vitest";

import { boundOwnerLabel, boundUserIdsOf, mapBoundOwnerNames } from "@/lib/workers/bound-owner";

describe("boundOwnerLabel", () => {
  it("uses the registered full name", () => {
    expect(
      boundOwnerLabel({ id: "u1", full_name: "เอมอร ฮามศรีพรม", line_display_name: null }),
    ).toBe("เอมอร ฮามศรีพรม");
  });

  it("NEVER falls back to the LINE display name", () => {
    // The load-bearing rule. A LINE handle is self-chosen — a nickname, an
    // emoji — and this line exists to answer "is this the person I mean?".
    // Presenting a handle as registered identity answers it WRONGLY, which is
    // worse than answering nothing. Live holders on 2026-08-04 included "ภา",
    // "เอ้ รี" and "เจมส์", so this is the common case, not a corner.
    expect(boundOwnerLabel({ id: "u1", full_name: null, line_display_name: "🐰 เอ้" })).toBeNull();
  });

  it("treats a blank or whitespace name as no name", () => {
    expect(boundOwnerLabel({ id: "u1", full_name: "   ", line_display_name: "x" })).toBeNull();
    expect(boundOwnerLabel({ id: "u1", full_name: "", line_display_name: "x" })).toBeNull();
  });

  it("trims a padded name rather than rendering the padding", () => {
    expect(boundOwnerLabel({ id: "u1", full_name: "  สร้อย มุก  ", line_display_name: null })).toBe(
      "สร้อย มุก",
    );
  });

  it("survives a missing user row", () => {
    expect(boundOwnerLabel(undefined)).toBeNull();
    expect(boundOwnerLabel(null)).toBeNull();
  });
});

describe("mapBoundOwnerNames", () => {
  it("indexes only the users that have a usable name", () => {
    const map = mapBoundOwnerNames([
      { id: "u1", full_name: "เอมอร ฮามศรีพรม", line_display_name: null },
      { id: "u2", full_name: null, line_display_name: "nickname only" },
      { id: "u3", full_name: "  ", line_display_name: null },
    ]);
    expect(map.get("u1")).toBe("เอมอร ฮามศรีพรม");
    // Absent, not empty-string — the caller renders the neutral form, and a
    // lookup miss can never be mistaken for "this record is unowned" (that is
    // derived from workers.user_id independently).
    expect(map.has("u2")).toBe(false);
    expect(map.has("u3")).toBe(false);
    expect(map.size).toBe(1);
  });

  it("is empty for an empty input", () => {
    expect(mapBoundOwnerNames([]).size).toBe(0);
  });
});

describe("boundUserIdsOf", () => {
  it("returns the distinct non-null ids", () => {
    expect(
      boundUserIdsOf([
        { user_id: "u1" },
        { user_id: null },
        { user_id: "u1" },
        { user_id: "u2" },
      ]).sort(),
    ).toEqual(["u1", "u2"]);
  });

  it("returns nothing when no worker is bound — the caller then skips the query", () => {
    expect(boundUserIdsOf([{ user_id: null }, { user_id: null }])).toEqual([]);
  });
});
