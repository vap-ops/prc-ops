import { describe, expect, it } from "vitest";
import { deliveryOrdinalLabel } from "@/lib/purchasing/po-deliveries";

// Spec 211 U10 — a PO ships in installments ("งวด"). A bare "งวดที่ N" collides with
// "งวดงาน" (the billing/work milestone, e.g. on the schedule gantt + deliverables),
// so the PO delivery installment is qualified as "งวดจัดส่งที่ N" wherever it is
// labelled (the section list, the per-งวด tracker, the delivery detail title).
describe("deliveryOrdinalLabel (spec 211 U10)", () => {
  it("qualifies a PO delivery installment as งวดจัดส่งที่ N", () => {
    expect(deliveryOrdinalLabel(1)).toBe("งวดจัดส่งที่ 1");
    expect(deliveryOrdinalLabel(12)).toBe("งวดจัดส่งที่ 12");
  });
});
