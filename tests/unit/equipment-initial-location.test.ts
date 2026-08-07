// Spec 367 Q1 — the initial location of a newly registered equipment item.
//
// Why this exists: location on /equipment is derived PURELY from the latest
// `equipment_movements` row (`current-location.ts` → `equipment-location-label.ts`),
// and the add flow wrote no movement — so every item registered rendered `—`.
// That is what left 63 of 64 items blank before the 2026-07-30 reset, and the
// registry is about to be filled by hand again. Spec 367 §Q1 asked whether a
// movement-less item should READ as "at คลัง"; this answers it the honest way
// instead: record a real event at registration, so the label never has to guess.
//
// The helper is pure so both halves can be pinned without a DB: the picker's
// value is either the store sentinel or a project id, and the DB CHECK
// (`project_id IS NOT NULL) = (kind = 'deployed')`) is mirrored here as the
// return shape — a caller cannot build a row the CHECK would reject.

import { describe, expect, it } from "vitest";

import { resolveInitialMovement, STORE_LOCATION } from "@/lib/equipment/initial-location";

const PROJECT_ID = "a88af871-019b-4eca-a7aa-f05244c83e5d";

describe("resolveInitialMovement", () => {
  it("maps the store sentinel to a received movement carrying NO project", () => {
    const result = resolveInitialMovement({
      location: STORE_LOCATION,
      tracking: "unit",
      quantity: null,
    });

    expect(result).toEqual({ ok: true, value: { kind: "received", projectId: null, quantity: 1 } });
  });

  it("maps a project id to a deployed movement carrying that project", () => {
    const result = resolveInitialMovement({
      location: PROJECT_ID,
      tracking: "unit",
      quantity: null,
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: "deployed", projectId: PROJECT_ID, quantity: 1 },
    });
  });

  it("moves a bulk item's WHOLE quantity, not one", () => {
    const result = resolveInitialMovement({
      location: STORE_LOCATION,
      tracking: "bulk",
      quantity: 200,
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: "received", projectId: null, quantity: 200 },
    });
  });

  it("refuses an unpicked location — the whole point is that no item starts unlocated", () => {
    const result = resolveInitialMovement({ location: "", tracking: "unit", quantity: null });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("อยู่ที่ไหน");
  });

  it("refuses a crafted location that is neither the sentinel nor a uuid", () => {
    const result = resolveInitialMovement({
      location: "'; drop table equipment_items; --",
      tracking: "unit",
      quantity: null,
    });

    expect(result.ok).toBe(false);
  });

  it("refuses a bulk item with no usable quantity — the DB CHECK demands qty >= 1", () => {
    for (const quantity of [null, 0, -3, 2.5]) {
      const result = resolveInitialMovement({
        location: STORE_LOCATION,
        tracking: "bulk",
        quantity,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("never returns a project on a received movement, whatever the tracking", () => {
    // The DB CHECK is `(project_id IS NOT NULL) = (kind = 'deployed')`, so a
    // received row carrying a project is a 23514 the user would meet as a
    // generic failure AFTER their item was already saved.
    const store = resolveInitialMovement({
      location: STORE_LOCATION,
      tracking: "bulk",
      quantity: 4,
    });
    expect(store.ok && store.value.projectId).toBe(null);
  });
});
