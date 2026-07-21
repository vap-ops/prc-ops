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

  // Spec 277 P1a — site_issue_reported snapshot fields (project_id, issue_type,
  // reported_by) map to camelCase.
  it("parses the site_issue_reported snapshot fields", () => {
    expect(
      parseNotificationPayload({
        project_id: "51700000-0000-4000-8000-000000000001",
        issue_type: "safety",
        reported_by: "51700000-0000-4000-8000-000000000003",
      }),
    ).toEqual({
      projectId: "51700000-0000-4000-8000-000000000001",
      issueType: "safety",
      reportedBy: "51700000-0000-4000-8000-000000000003",
    });
  });

  // Spec 337 U1 — wp_evidence_resubmitted snapshot: the answered decision's
  // decider (the recipient) plus the SA who resubmitted (the self-ping exclusion).
  it("parses the wp_evidence_resubmitted snapshot fields", () => {
    expect(
      parseNotificationPayload({
        code: "W05-03",
        name: "งานฉาบผนัง",
        project_id: "33700000-0000-4000-8000-000000000001",
        decided_by: "33700000-0000-4000-8000-000000000002",
        resubmitted_by: "33700000-0000-4000-8000-000000000003",
      }),
    ).toEqual({
      code: "W05-03",
      name: "งานฉาบผนัง",
      projectId: "33700000-0000-4000-8000-000000000001",
      decidedBy: "33700000-0000-4000-8000-000000000002",
      resubmittedBy: "33700000-0000-4000-8000-000000000003",
    });
  });
});
