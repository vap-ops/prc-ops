import { describe, expect, it } from "vitest";
import { rowHealth, rowHealthLabel } from "@/lib/purchasing/row-health";

// Spec 112 — band-relative row health (the buyer's time pressure). Pure, TDD-first.
// today fixed; red MEANS a different thing per band.

const TODAY = "2026-06-15";

describe("rowHealth", () => {
  it("awaiting approval is the PM's move, not the buyer's → waiting", () => {
    expect(rowHealth("requested", null, "2026-06-01", TODAY)).toBe("waiting");
  });

  it("rejected / cancelled → waiting (no buyer action)", () => {
    expect(rowHealth("rejected", null, null, TODAY)).toBe("waiting");
    expect(rowHealth("cancelled", null, null, TODAY)).toBe("waiting");
  });

  describe("to_order (approved, not yet ordered) — pressure = needed_by", () => {
    it("past due and not ordered → late", () => {
      expect(rowHealth("approved", null, "2026-06-10", TODAY)).toBe("late");
    });
    it("due within the soon window → at_risk", () => {
      expect(rowHealth("approved", null, "2026-06-20", TODAY)).toBe("at_risk");
    });
    it("due far out → on_track", () => {
      expect(rowHealth("approved", null, "2026-07-30", TODAY)).toBe("on_track");
    });
    it("no needed_by → on_track (no deadline to assess)", () => {
      expect(rowHealth("approved", null, null, TODAY)).toBe("on_track");
    });
    it("soon-window boundary: exactly +7 days is at_risk, +8 is on_track", () => {
      expect(rowHealth("approved", null, "2026-06-22", TODAY)).toBe("at_risk");
      expect(rowHealth("approved", null, "2026-06-23", TODAY)).toBe("on_track");
    });
  });

  describe("in_transit (already ordered) — pressure = will it arrive in time", () => {
    it("ETA past today → late (chase the delivery)", () => {
      expect(rowHealth("purchased", "2026-06-10", "2026-06-30", TODAY)).toBe("late");
      expect(rowHealth("on_route", "2026-06-10", null, TODAY)).toBe("late");
    });
    it("ETA after needed_by → at_risk (will land late)", () => {
      expect(rowHealth("on_route", "2026-06-25", "2026-06-20", TODAY)).toBe("at_risk");
    });
    it("ETA on or before needed_by → on_track", () => {
      expect(rowHealth("purchased", "2026-06-18", "2026-06-20", TODAY)).toBe("on_track");
    });
    it("no ETA → on_track (not flagged)", () => {
      expect(rowHealth("purchased", null, "2026-06-20", TODAY)).toBe("on_track");
    });
    it("request urgency is irrelevant once ordered (no priority input at all)", () => {
      // on-time delivery is green even though the original request may have been urgent
      expect(rowHealth("on_route", "2026-06-16", "2026-06-20", TODAY)).toBe("on_track");
    });
  });

  it("received → on_track (done)", () => {
    expect(rowHealth("delivered", "2026-06-10", "2026-06-20", TODAY)).toBe("on_track");
    expect(rowHealth("site_purchased", null, null, TODAY)).toBe("on_track");
  });
});

describe("rowHealthLabel", () => {
  it("gives a Thai reason for each health", () => {
    expect(rowHealthLabel("late")).toMatch(/\S/);
    expect(rowHealthLabel("at_risk")).toMatch(/\S/);
    expect(rowHealthLabel("on_track")).toMatch(/\S/);
    expect(rowHealthLabel("waiting")).toMatch(/\S/);
  });
});
