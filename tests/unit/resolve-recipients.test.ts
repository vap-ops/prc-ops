import { describe, expect, it } from "vitest";
import { resolveRecipients } from "@/lib/notifications/resolve-recipients";
import type { NotificationEventType } from "@/lib/notifications/compose-notification";

const PM_A = "aaaaaaaa-0000-4000-8000-000000000001";
const PM_B = "aaaaaaaa-0000-4000-8000-000000000002";
const SA_1 = "bbbbbbbb-0000-4000-8000-000000000001";
const SA_2 = "bbbbbbbb-0000-4000-8000-000000000002";
const SU_1 = "cccccccc-0000-4000-8000-000000000001";
const SU_2 = "cccccccc-0000-4000-8000-000000000002";
const DIR_1 = "dddddddd-0000-4000-8000-000000000001";
const PROC_1 = "eeeeeeee-0000-4000-8000-000000000001";

// Spec 318 U5 — the PM-approval events are project-scoped: the event's own
// project PMs + the org-wide PD/super pool. eventProjectPmIds === null means
// the project could NOT be resolved (pre-318 queue rows, WP-less PRs) →
// legacy full-pool fallback so nothing is dropped mid-transition.
const ctx = {
  eventProjectPmIds: [PM_A] as ReadonlyArray<string> | null,
  orgWidePmIds: [DIR_1, SU_1],
  legacyPmPoolIds: [PM_A, PM_B, DIR_1, SU_1],
  wpUploaderIds: [SA_1, SA_2],
  superIds: [SU_1, SU_2],
  siteIssueProjectPmIds: [],
  siteIssueRolePoolIds: [],
};

describe("resolveRecipients", () => {
  it("sends wp_pending_approval to the event project's PMs + the org-wide PD/super pool", () => {
    expect(resolveRecipients("wp_pending_approval", {}, ctx)).toEqual([PM_A, DIR_1, SU_1]);
  });

  it("wp_pending_approval does NOT reach a PM scoped to another project", () => {
    expect(resolveRecipients("wp_pending_approval", {}, ctx)).not.toContain(PM_B);
  });

  it("falls back to the legacy full pool when the project is unresolvable (null)", () => {
    expect(
      resolveRecipients("wp_pending_approval", {}, { ...ctx, eventProjectPmIds: null }),
    ).toEqual([PM_A, PM_B, DIR_1, SU_1]);
  });

  it("zero-PM project ([]) still alerts the org-wide pool", () => {
    expect(resolveRecipients("wp_pending_approval", {}, { ...ctx, eventProjectPmIds: [] })).toEqual(
      [DIR_1, SU_1],
    );
  });

  it("sends pr_created to the project's PMs + org pool but never the requester", () => {
    expect(resolveRecipients("pr_created", { requestedBy: PM_A }, ctx)).toEqual([DIR_1, SU_1]);
  });

  it("pr_created falls back to the legacy pool (minus requester) when unresolvable", () => {
    expect(
      resolveRecipients("pr_created", { requestedBy: PM_A }, { ...ctx, eventProjectPmIds: null }),
    ).toEqual([PM_B, DIR_1, SU_1]);
  });

  it("sends wp_decision to the WP's photo uploaders, excluding the decider", () => {
    expect(resolveRecipients("wp_decision", { decidedBy: SA_2 }, ctx)).toEqual([SA_1]);
  });

  it("sends wp_reopened to the WP's photo uploaders, excluding the reopener (spec 218)", () => {
    expect(resolveRecipients("wp_reopened", { reopenedBy: SA_2 }, ctx)).toEqual([SA_1]);
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
        {
          eventProjectPmIds: [],
          orgWidePmIds: [],
          legacyPmPoolIds: [],
          wpUploaderIds: [SA_1, SA_1, SA_2],
          superIds: [],
          siteIssueProjectPmIds: [],
          siteIssueRolePoolIds: [],
        },
      ),
    ).toEqual([SA_1, SA_2]);
  });

  it("sends feedback_submitted to every super_admin (the operator pool) — spec 201 A4", () => {
    expect(resolveRecipients("feedback_submitted", {}, ctx)).toEqual([SU_1, SU_2]);
  });

  it("excludes a super_admin who filed their own feedback (no self-ping)", () => {
    expect(resolveRecipients("feedback_submitted", { submittedBy: SU_1 }, ctx)).toEqual([SU_2]);
  });

  // Spec 277 P1a — a serious site issue alerts the project's PM (lead + PM members,
  // resolved in the drain) PLUS the role-wide project_director + procurement_manager
  // pool. Deduped; the reporter is excluded (no self-ping).
  describe("site_issue_reported (spec 277 P1a)", () => {
    it("alerts the project PMs and the director/procurement pool", () => {
      expect(
        resolveRecipients(
          "site_issue_reported",
          {},
          {
            ...ctx,
            siteIssueProjectPmIds: [PM_A],
            siteIssueRolePoolIds: [DIR_1, PROC_1],
          },
        ),
      ).toEqual([PM_A, DIR_1, PROC_1]);
    });

    it("dedupes a project lead who is also in the role pool (PD == project lead)", () => {
      expect(
        resolveRecipients(
          "site_issue_reported",
          {},
          {
            ...ctx,
            siteIssueProjectPmIds: [DIR_1],
            siteIssueRolePoolIds: [DIR_1, PROC_1],
          },
        ),
      ).toEqual([DIR_1, PROC_1]);
    });

    it("still alerts the director + procurement pool when the project has no PM (zero-PM fallback)", () => {
      expect(
        resolveRecipients(
          "site_issue_reported",
          {},
          {
            ...ctx,
            siteIssueProjectPmIds: [],
            siteIssueRolePoolIds: [DIR_1, PROC_1],
          },
        ),
      ).toEqual([DIR_1, PROC_1]);
    });

    it("excludes the reporter who filed the issue (no self-ping)", () => {
      expect(
        resolveRecipients(
          "site_issue_reported",
          { reportedBy: PM_A },
          {
            ...ctx,
            siteIssueProjectPmIds: [PM_A],
            siteIssueRolePoolIds: [DIR_1],
          },
        ),
      ).toEqual([DIR_1]);
    });
  });

  // Hardening (2026-07-11) — an event type the compiled code predates (a DB enum
  // value written to the outbox ahead of this deploy) must resolve to NO
  // recipients: a safe skip, never `undefined` that crashes the shared drain
  // loop for every other notification. The switch stays exhaustive for KNOWN
  // events at compile time (a new union member breaks the build); the default
  // only catches runtime values the compiled code predates.
  it("returns no recipients for an unrecognized (future) event type", () => {
    expect(
      resolveRecipients("some_future_event" as unknown as NotificationEventType, {}, ctx),
    ).toEqual([]);
  });
});
