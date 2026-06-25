import { describe, expect, it } from "vitest";
import { resolveRecipients } from "@/lib/notifications/resolve-recipients";

const PM_A = "aaaaaaaa-0000-4000-8000-000000000001";
const PM_B = "aaaaaaaa-0000-4000-8000-000000000002";
const SA_1 = "bbbbbbbb-0000-4000-8000-000000000001";
const SA_2 = "bbbbbbbb-0000-4000-8000-000000000002";
const SU_1 = "cccccccc-0000-4000-8000-000000000001";
const SU_2 = "cccccccc-0000-4000-8000-000000000002";

const ctx = { pmIds: [PM_A, PM_B], wpUploaderIds: [SA_1, SA_2], superIds: [SU_1, SU_2] };

describe("resolveRecipients", () => {
  it("sends wp_pending_approval to every PM/super", () => {
    expect(resolveRecipients("wp_pending_approval", {}, ctx)).toEqual([PM_A, PM_B]);
  });

  it("sends pr_created to PMs but never to the requester (self-notification)", () => {
    expect(resolveRecipients("pr_created", { requestedBy: PM_A }, ctx)).toEqual([PM_B]);
  });

  it("sends wp_decision to the WP's photo uploaders, excluding the decider", () => {
    expect(resolveRecipients("wp_decision", { decidedBy: SA_2 }, ctx)).toEqual([SA_1]);
  });

  it("sends pr_decision to the requester", () => {
    expect(resolveRecipients("pr_decision", { requestedBy: SA_1, decidedBy: PM_A }, ctx)).toEqual([
      SA_1,
    ]);
  });

  it("drops pr_decision entirely when the requester decided their own request", () => {
    expect(resolveRecipients("pr_decision", { requestedBy: PM_A, decidedBy: PM_A }, ctx)).toEqual(
      [],
    );
  });

  it("sends pr_progress to the requester", () => {
    expect(resolveRecipients("pr_progress", { requestedBy: SA_1 }, ctx)).toEqual([SA_1]);
  });

  it("sends pr_cancelled to the requester, excluding the canceller", () => {
    expect(
      resolveRecipients("pr_cancelled", { requestedBy: SA_1, cancelledBy: PM_A }, ctx),
    ).toEqual([SA_1]);
    expect(
      resolveRecipients("pr_cancelled", { requestedBy: SA_1, cancelledBy: SA_1 }, ctx),
    ).toEqual([]);
  });

  it("returns no recipients when the requester is unknown", () => {
    expect(resolveRecipients("pr_progress", {}, ctx)).toEqual([]);
  });

  it("deduplicates recipients", () => {
    expect(
      resolveRecipients(
        "wp_decision",
        {},
        { pmIds: [], wpUploaderIds: [SA_1, SA_1, SA_2], superIds: [] },
      ),
    ).toEqual([SA_1, SA_2]);
  });

  it("sends feedback_submitted to every super_admin (the operator pool) — spec 201 A4", () => {
    expect(resolveRecipients("feedback_submitted", {}, ctx)).toEqual([SU_1, SU_2]);
  });

  it("excludes a super_admin who filed their own feedback (no self-ping)", () => {
    expect(resolveRecipients("feedback_submitted", { submittedBy: SU_1 }, ctx)).toEqual([SU_2]);
  });
});
