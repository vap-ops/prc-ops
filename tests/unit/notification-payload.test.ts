import { describe, expect, it } from "vitest";
import { parseNotificationPayload } from "@/lib/notifications/payload";

describe("parseNotificationPayload", () => {
  it("maps every snake_case trigger field to its camelCase view", () => {
    expect(
      parseNotificationPayload({
        code: "WP-001",
        name: "งานเทพื้น",
        decision: "approved",
        comment: "ผ่าน",
        decided_by: "uuid-pm",
        item_description: "ปูน",
        quantity: 10,
        unit: "ถุง",
        requested_by: "uuid-sa",
        pr_number: 7,
        transition: ["requested", "approved"],
        decision_comment: "อนุมัติ",
        cancelled_by: "uuid-pm-2",
        cancellation_reason: "ไม่ต้องการแล้ว",
      }),
    ).toEqual({
      code: "WP-001",
      name: "งานเทพื้น",
      decision: "approved",
      comment: "ผ่าน",
      decidedBy: "uuid-pm",
      itemDescription: "ปูน",
      quantity: 10,
      unit: "ถุง",
      requestedBy: "uuid-sa",
      prNumber: 7,
      transition: ["requested", "approved"],
      decisionComment: "อนุมัติ",
      cancelledBy: "uuid-pm-2",
      cancellationReason: "ไม่ต้องการแล้ว",
    });
  });

  it("drops wrongly-typed fields instead of passing them through", () => {
    expect(
      parseNotificationPayload({
        pr_number: "7",
        quantity: "10",
        comment: 42,
        transition: ["requested"],
      }),
    ).toEqual({});
  });

  it("drops a transition whose elements are not strings", () => {
    expect(parseNotificationPayload({ transition: [1, 2] })).toEqual({});
  });

  it("returns an empty payload for null, arrays, and non-objects", () => {
    expect(parseNotificationPayload(null)).toEqual({});
    expect(parseNotificationPayload(["a"])).toEqual({});
    expect(parseNotificationPayload("x")).toEqual({});
    expect(parseNotificationPayload(7)).toEqual({});
  });
});
