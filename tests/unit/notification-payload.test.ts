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

  it("maps the wp_reopened snapshot fields — round + reopened_by (spec 218 U5)", () => {
    expect(parseNotificationPayload({ code: "WP-014", round: 2, reopened_by: "uuid-sa" })).toEqual({
      code: "WP-014",
      round: 2,
      reopenedBy: "uuid-sa",
    });
  });

  it("maps the feedback_submitted snapshot fields (spec 201 A4)", () => {
    expect(
      parseNotificationPayload({
        feedback_id: "fb-1",
        feedback_type: "bug",
        feedback_title: "รูปอัปโหลดไม่ขึ้น",
        role_snapshot: "site_admin",
        submitted_by: "uuid-sa",
      }),
    ).toEqual({
      feedbackId: "fb-1",
      feedbackType: "bug",
      feedbackTitle: "รูปอัปโหลดไม่ขึ้น",
      roleSnapshot: "site_admin",
      submittedBy: "uuid-sa",
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
