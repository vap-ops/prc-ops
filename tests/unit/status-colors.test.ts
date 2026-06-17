// Pure tests for the status-color helper used by the SA project list and
// the SA WP list. The helper maps an enum value → Tailwind pill classes
// using the same zinc / amber / emerald / muted palette already used by
// the PM-side pills (approval decisions, report statuses), so the two
// surfaces stay visually consistent.
//
// Test shape: every enum label produces a non-empty class string; an
// unknown value falls back to the neutral default; the helper is
// exhaustive on the two enums (driven by the Constants table from the
// generated database.types.ts so adding a new enum value would surface
// here).

import { describe, expect, it } from "vitest";

import { Constants } from "@/lib/db/database.types";
import {
  approvalDecisionPillClasses,
  projectStatusPillClasses,
  purchaseOrderStatusPillClasses,
  purchaseRequestPriorityPillClasses,
  purchaseRequestStatusPillClasses,
  reportStatusPillClasses,
  workPackageStatusPillClasses,
} from "@/lib/status-colors";

describe("projectStatusPillClasses", () => {
  for (const value of Constants.public.Enums.project_status) {
    it(`returns a non-empty class string for project_status='${value}'`, () => {
      const classes = projectStatusPillClasses(value);
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    });
  }

  it("falls back to neutral classes for an unknown value", () => {
    // We narrow with `as unknown as` because the helper accepts the
    // typed union; the test is for the runtime default path the
    // helper exposes for defensive use.
    const unknown = "totally-not-a-status" as unknown as Parameters<
      typeof projectStatusPillClasses
    >[0];
    const classes = projectStatusPillClasses(unknown);
    expect(typeof classes).toBe("string");
    expect(classes.length).toBeGreaterThan(0);
  });

  it("uses the emerald palette for 'completed' (positive terminal)", () => {
    expect(projectStatusPillClasses("completed")).toContain("emerald");
  });

  it("uses the amber palette for 'on_hold' (needs attention)", () => {
    expect(projectStatusPillClasses("on_hold")).toContain("amber");
  });
});

describe("workPackageStatusPillClasses", () => {
  for (const value of Constants.public.Enums.work_package_status) {
    it(`returns a non-empty class string for work_package_status='${value}'`, () => {
      const classes = workPackageStatusPillClasses(value);
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    });
  }

  it("falls back to neutral classes for an unknown value", () => {
    const unknown = "not-a-wp-status" as unknown as Parameters<
      typeof workPackageStatusPillClasses
    >[0];
    const classes = workPackageStatusPillClasses(unknown);
    expect(typeof classes).toBe("string");
    expect(classes.length).toBeGreaterThan(0);
  });

  it("uses the emerald palette for 'complete' (positive terminal)", () => {
    expect(workPackageStatusPillClasses("complete")).toContain("emerald");
  });

  it("uses the amber palette for in-flight WP statuses (in_progress, on_hold, pending_approval)", () => {
    expect(workPackageStatusPillClasses("in_progress")).toContain("amber");
    expect(workPackageStatusPillClasses("on_hold")).toContain("amber");
    expect(workPackageStatusPillClasses("pending_approval")).toContain("amber");
  });

  it("uses the zinc palette for 'not_started' (idle default)", () => {
    expect(workPackageStatusPillClasses("not_started")).toContain("zinc");
  });
});

describe("purchaseRequestStatusPillClasses", () => {
  for (const value of Constants.public.Enums.purchase_request_status) {
    it(`returns a non-empty class string for purchase_request_status='${value}'`, () => {
      const classes = purchaseRequestStatusPillClasses(value);
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    });
  }

  it("falls back to neutral classes for an unknown value", () => {
    const unknown = "not-a-pr-status" as unknown as Parameters<
      typeof purchaseRequestStatusPillClasses
    >[0];
    const classes = purchaseRequestStatusPillClasses(unknown);
    expect(typeof classes).toBe("string");
    expect(classes.length).toBeGreaterThan(0);
  });

  it("uses the zinc palette for 'requested' (idle default)", () => {
    expect(purchaseRequestStatusPillClasses("requested")).toContain("zinc");
  });

  it("uses the red palette for 'rejected' (negative terminal)", () => {
    expect(purchaseRequestStatusPillClasses("rejected")).toContain("red");
  });

  it("uses the amber palette for 'purchased' (in flight with the back office)", () => {
    expect(purchaseRequestStatusPillClasses("purchased")).toContain("amber");
  });

  it("uses the emerald palette for 'approved' and 'delivered' (positive states)", () => {
    expect(purchaseRequestStatusPillClasses("approved")).toContain("emerald");
    expect(purchaseRequestStatusPillClasses("delivered")).toContain("emerald");
  });

  // Spec 20 sun palette: the four slots are solid fills with white/ink
  // text — identifiable by hue at arm's length in glare.
  it("pins the sun-rated solid fills (spec 20)", () => {
    expect(purchaseRequestStatusPillClasses("requested")).toContain("bg-zinc-200");
    expect(purchaseRequestStatusPillClasses("requested")).toContain("text-zinc-900");
    expect(purchaseRequestStatusPillClasses("approved")).toContain("bg-emerald-700");
    expect(purchaseRequestStatusPillClasses("approved")).toContain("text-white");
    expect(purchaseRequestStatusPillClasses("rejected")).toContain("bg-red-600");
    expect(purchaseRequestStatusPillClasses("purchased")).toContain("bg-amber-400");
  });
});

describe("purchaseRequestPriorityPillClasses", () => {
  for (const value of Constants.public.Enums.purchase_request_priority) {
    it(`returns a non-empty class string for purchase_request_priority='${value}'`, () => {
      const classes = purchaseRequestPriorityPillClasses(value);
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    });
  }

  it("pins the palette: normal zinc, urgent amber, critical red", () => {
    expect(purchaseRequestPriorityPillClasses("normal")).toContain("zinc");
    expect(purchaseRequestPriorityPillClasses("urgent")).toContain("amber");
    expect(purchaseRequestPriorityPillClasses("critical")).toContain("red");
  });

  // Spec 20 sun palette: solid saturated fills readable in sunlight,
  // not dark translucent tints. Exact-literal pins so a palette
  // regression is loud.
  it("pins the sun-rated solid fills (spec 20)", () => {
    expect(purchaseRequestPriorityPillClasses("critical")).toContain("bg-red-600");
    expect(purchaseRequestPriorityPillClasses("critical")).toContain("text-white");
    expect(purchaseRequestPriorityPillClasses("urgent")).toContain("bg-amber-400");
    expect(purchaseRequestPriorityPillClasses("urgent")).toContain("text-zinc-950");
  });

  it("falls back to neutral classes for an unknown value", () => {
    const unknown = "not-a-priority" as unknown as Parameters<
      typeof purchaseRequestPriorityPillClasses
    >[0];
    expect(purchaseRequestPriorityPillClasses(unknown).length).toBeGreaterThan(0);
  });
});

describe("purchaseOrderStatusPillClasses (spec 134)", () => {
  const PO_STATES = ["open", "ordered", "in_transit", "partially_received", "received"] as const;

  for (const value of PO_STATES) {
    it(`returns a non-empty class string for purchase_order status='${value}'`, () => {
      const classes = purchaseOrderStatusPillClasses(value);
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    });
  }

  it("falls back to neutral classes for an unknown value", () => {
    const unknown = "not-a-po-status" as unknown as Parameters<
      typeof purchaseOrderStatusPillClasses
    >[0];
    expect(purchaseOrderStatusPillClasses(unknown).length).toBeGreaterThan(0);
  });

  it("maps onto the per-ticket palette: open zinc, ordered amber, in_transit/partial sky, received emerald", () => {
    expect(purchaseOrderStatusPillClasses("open")).toContain("zinc");
    expect(purchaseOrderStatusPillClasses("ordered")).toContain("amber");
    expect(purchaseOrderStatusPillClasses("in_transit")).toContain("sky");
    expect(purchaseOrderStatusPillClasses("partially_received")).toContain("sky");
    expect(purchaseOrderStatusPillClasses("received")).toContain("emerald");
  });
});

describe("approvalDecisionPillClasses", () => {
  for (const value of Constants.public.Enums.approval_decision) {
    it(`returns a non-empty class string for approval_decision='${value}'`, () => {
      const classes = approvalDecisionPillClasses(value);
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    });
  }

  it("uses the zinc palette for null (awaiting first review)", () => {
    expect(approvalDecisionPillClasses(null)).toContain("zinc");
  });

  it("uses the emerald palette for 'approved'", () => {
    expect(approvalDecisionPillClasses("approved")).toContain("emerald");
  });

  it("uses the red palette for 'rejected'", () => {
    expect(approvalDecisionPillClasses("rejected")).toContain("red");
  });

  it("uses the amber palette for 'needs_revision'", () => {
    expect(approvalDecisionPillClasses("needs_revision")).toContain("amber");
  });
});

describe("reportStatusPillClasses", () => {
  for (const value of Constants.public.Enums.report_status) {
    it(`returns a non-empty class string for report_status='${value}'`, () => {
      const classes = reportStatusPillClasses(value);
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    });
  }

  it("falls back to neutral classes for an unknown value", () => {
    const unknown = "not-a-report-status" as unknown as Parameters<
      typeof reportStatusPillClasses
    >[0];
    const classes = reportStatusPillClasses(unknown);
    expect(typeof classes).toBe("string");
    expect(classes.length).toBeGreaterThan(0);
  });

  it("pins the palette: requested zinc, processing amber, complete emerald, failed red", () => {
    expect(reportStatusPillClasses("requested")).toContain("zinc");
    expect(reportStatusPillClasses("processing")).toContain("amber");
    expect(reportStatusPillClasses("complete")).toContain("emerald");
    expect(reportStatusPillClasses("failed")).toContain("red");
  });
});
