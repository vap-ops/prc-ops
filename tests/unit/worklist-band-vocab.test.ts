import { describe, expect, it } from "vitest";
import { WORKLIST_BAND_TERM } from "@/lib/purchasing/worklist-band-vocab";
import { PROCUREMENT_BAND_LABEL } from "@/lib/purchasing/procurement-pipeline";
import { REQUEST_BAND_LABEL } from "@/lib/purchasing/request-bands";

// Spec 211 (cross-engine reconcile) — the site worklist (request-bands, for
// site_admin/PM/super) and the procurement pipeline (procurement-pipeline, for
// procurement) are two band engines over one table (audit critic gap X2). A user
// only ever sees ONE engine, so there is no same-screen contradiction (that was
// U7); the risk is DRIFT — the terms the two engines genuinely share were
// duplicated literals. Guard: those shared terms come from ONE SSOT
// (WORKLIST_BAND_TERM), while the deliberate per-view differences are preserved.

describe("cross-engine worklist band vocab SSOT (spec 211)", () => {
  it("procurement engine sources its shared band terms from the SSOT", () => {
    expect(PROCUREMENT_BAND_LABEL.awaiting_approval).toBe(WORKLIST_BAND_TERM.awaiting_approval);
    expect(PROCUREMENT_BAND_LABEL.to_order).toBe(WORKLIST_BAND_TERM.to_order);
    expect(PROCUREMENT_BAND_LABEL.in_transit).toBe(WORKLIST_BAND_TERM.in_transit);
  });

  it("site engine sources its shared band terms from the SSOT (to_order prefixes the core)", () => {
    expect(REQUEST_BAND_LABEL.awaiting_approval).toBe(WORKLIST_BAND_TERM.awaiting_approval);
    expect(REQUEST_BAND_LABEL.in_transit).toBe(WORKLIST_BAND_TERM.in_transit);
    expect(REQUEST_BAND_LABEL.to_order).toContain(WORKLIST_BAND_TERM.to_order);
  });

  it("preserves the exact rendered strings (behaviour-preserving)", () => {
    expect(PROCUREMENT_BAND_LABEL.awaiting_approval).toBe("รออนุมัติ");
    expect(PROCUREMENT_BAND_LABEL.to_order).toBe("รอสั่งซื้อ");
    expect(PROCUREMENT_BAND_LABEL.in_transit).toBe("กำลังจัดส่ง");
    expect(REQUEST_BAND_LABEL.awaiting_approval).toBe("รออนุมัติ");
    expect(REQUEST_BAND_LABEL.to_order).toBe("อนุมัติแล้ว รอสั่งซื้อ");
    expect(REQUEST_BAND_LABEL.in_transit).toBe("กำลังจัดส่ง");
  });

  it("keeps the deliberate per-view differences (NOT forced to agree)", () => {
    // Terminal band: the site frames it as done/closed (the requester's view);
    // procurement frames it as received (the buyer's view). Both are correct for
    // their audience and must stay distinct.
    expect(REQUEST_BAND_LABEL.done).toBe("เสร็จแล้ว");
    expect(PROCUREMENT_BAND_LABEL.received).toBe("ได้รับแล้ว");
    expect(REQUEST_BAND_LABEL.done).not.toBe(PROCUREMENT_BAND_LABEL.received);
  });
});
