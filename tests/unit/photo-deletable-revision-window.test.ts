// Writing failing test first.
//
// Spec 291 amendment (feedback f2096ee4) — the ให้แก้ไข window. isPhotoWpDeletable
// keeps its original status-only meaning; isRevisionWindowOpen is the second arm
// and mirrors photo_removal_allowed() (migration 075831) minus the per-photo
// uploader check, which only the action and RLS can make.
//
// The window closes on ANSWER, not on a new decision: resubmit_work_package_evidence
// writes an audit row and no approvals row, so a rule keyed on the decision alone
// would leave the set mutable while the reviewer re-reviews it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canDeleteWpPhotos,
  isPhotoWpDeletable,
  isRevisionWindowOpen,
} from "@/lib/photos/deletable";
import type { Database } from "@/lib/db/database.types";

type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];
type ApprovalDecision = Database["public"]["Enums"]["approval_decision"];

describe("isPhotoWpDeletable — unchanged status-only arm", () => {
  it("admits the editable statuses", () => {
    expect(isPhotoWpDeletable("not_started")).toBe(true);
    expect(isPhotoWpDeletable("in_progress")).toBe(true);
    expect(isPhotoWpDeletable("on_hold")).toBe(true);
    expect(isPhotoWpDeletable("rework")).toBe(true);
  });

  it("still freezes a submitted or complete WP", () => {
    expect(isPhotoWpDeletable("pending_approval")).toBe(false);
    expect(isPhotoWpDeletable("complete")).toBe(false);
  });
});

describe("isRevisionWindowOpen — the ให้แก้ไข window", () => {
  const base = { status: "pending_approval", latestDecision: "needs_revision" } as const;

  it("opens while an unanswered needs_revision is the latest word", () => {
    expect(isRevisionWindowOpen({ ...base, revisionAnswered: false })).toBe(true);
  });

  it("closes once the SA answered it with ส่งตรวจอีกครั้ง", () => {
    expect(isRevisionWindowOpen({ ...base, revisionAnswered: true })).toBe(false);
  });

  it("stays shut while the WP awaits its first decision", () => {
    expect(
      isRevisionWindowOpen({
        status: "pending_approval",
        latestDecision: null,
        revisionAnswered: false,
      }),
    ).toBe(false);
  });

  it("stays shut once a later decision supersedes the ask", () => {
    for (const latestDecision of ["approved", "rejected"] as const) {
      expect(
        isRevisionWindowOpen({
          status: "pending_approval",
          latestDecision,
          revisionAnswered: false,
        }),
      ).toBe(false);
    }
  });

  it("never opens on a complete WP carrying a needs_revision decision", () => {
    expect(
      isRevisionWindowOpen({
        status: "complete",
        latestDecision: "needs_revision",
        revisionAnswered: false,
      }),
    ).toBe(false);
  });
});

// canDeleteWpPhotos is the WHOLE WP-level rule, so the page carries no logic of
// its own. Assert the matrix on the function (behaviour, not source text), then
// keep one cheap pin that the page still routes through it — a page that
// re-inlined `isPhotoWpDeletable(wp.status)` would keep every case above green.
describe("canDeleteWpPhotos — the matrix the WP-detail page uses", () => {
  const cases: ReadonlyArray<[WorkPackageStatus, ApprovalDecision | null, boolean, boolean]> = [
    // status, latestDecision, revisionAnswered, expected
    ["in_progress", null, false, true],
    ["rework", "approved", false, true],
    ["not_started", null, true, true],
    ["pending_approval", null, false, false],
    ["pending_approval", "needs_revision", false, true],
    ["pending_approval", "needs_revision", true, false],
    ["pending_approval", "approved", false, false],
    ["pending_approval", "rejected", false, false],
    ["complete", "needs_revision", false, false],
    ["complete", null, false, false],
  ];

  it.each(cases)("%s + %s (answered=%s) → %s", (status, latestDecision, revisionAnswered, want) => {
    expect(canDeleteWpPhotos({ status, latestDecision, revisionAnswered })).toBe(want);
  });
});

describe("the WP-detail page routes canDelete through that one function", () => {
  const pageSrc = readFileSync(
    join(process.cwd(), "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx"),
    "utf8",
  );

  it("calls canDeleteWpPhotos and derives revisionAnswered from the resubmit rows", () => {
    expect(pageSrc.replace(/\s+/g, " ")).toContain(
      "canDelete={canDeleteWpPhotos({ status: wp.status, latestDecision: latestDecision?.decision ?? null,",
    );
    expect(pageSrc).toContain(
      "revisionAnswered: latestDecision ? answeredDecisionIds.has(latestDecision.id) : false,",
    );
  });

  it("keeps no delete rule of its own", () => {
    expect(pageSrc).not.toContain("isPhotoWpDeletable(");
    expect(pageSrc).not.toContain("isRevisionWindowOpen(");
  });
});
