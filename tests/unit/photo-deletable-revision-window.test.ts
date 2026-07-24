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
  canCaptureAfterFix,
  canDeleteWpPhotos,
  canRemoveInRevisionWindow,
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
    // The DELETE decision routes through canDeleteWpPhotos (pinned above), so the
    // page never re-implements it via isPhotoWpDeletable. Spec 353: the page DOES
    // call isRevisionWindowOpen now — but to feed the after_fix CAPTURE gate
    // (canCaptureAfterFix), a different rule pinned by its own test below; the
    // positive canDelete pin above is what proves delete still routes correctly.
    expect(pageSrc).not.toContain("isPhotoWpDeletable(");
  });
});

// ============================================================================
// Spec 340 U1 — who may remove inside the window.
//
// 291's rule: the reviewer asks, the uploader fixes — an approver must not alter
// the evidence they are judging. That left nobody able to help when the uploader
// cannot (off site, phone lost). Operator call 2026-07-22: super_admin bypasses
// the UPLOADER check only. The FREEZE is a state rule, not a role rule, and stays
// — which is why this predicate is about the window's OWNER, never its status.
// ============================================================================
describe("canRemoveInRevisionWindow — spec 340 U1", () => {
  it("admits the uploader whatever their role", () => {
    expect(canRemoveInRevisionWindow({ isUploader: true, role: "site_admin" })).toBe(true);
    expect(canRemoveInRevisionWindow({ isUploader: true, role: null })).toBe(true);
  });

  it("admits super_admin acting for someone else", () => {
    expect(canRemoveInRevisionWindow({ isUploader: false, role: "super_admin" })).toBe(true);
  });

  it("refuses every other non-uploader, including the roles that can judge the WP", () => {
    for (const role of ["site_admin", "project_manager", "project_director"] as const) {
      expect(canRemoveInRevisionWindow({ isUploader: false, role })).toBe(false);
    }
  });

  it("fails closed on an unknown role", () => {
    expect(canRemoveInRevisionWindow({ isUploader: false, role: null })).toBe(false);
  });

  it("says nothing about WP status — the freeze is enforced separately", () => {
    // A regression here would mean someone folded a status test into the owner
    // test and quietly handed super_admin a delete on submitted evidence.
    //
    // The first draft of this sliced to `fn.indexOf("}")`, which lands on the
    // brace closing the DESTRUCTURING PATTERN — 66 characters that never reach
    // the body, so the very regression named above stayed green. Slice to the
    // `}` in column 0 that ends the declaration instead, and assert the slice
    // actually contains the return so a future refactor cannot silently empty it.
    const src = readFileSync(join(process.cwd(), "src/lib/photos/deletable.ts"), "utf8");
    const start = src.indexOf("export function canRemoveInRevisionWindow");
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start);
    // "\n}" alone is still not enough — it first matches the `}` of `}: {` that
    // closes the destructuring TYPE. The declaration ends at a brace on its own
    // line: "\n}\n".
    const body = rest.slice(0, rest.indexOf("\n}\n") + 3);
    expect(body).toContain("return isUploader");
    expect(body).not.toMatch(/status|pending_approval|complete/);
  });
});

// ============================================================================
// Spec 353 — WHEN the หลังแก้ไข (after_fix) CAPTURE affordance is offered.
//
// after_fix is a WP's completion evidence exactly when it is a rework cycle
// (rework_round > 0), and only while its photos are mutable: actively curing
// (rework) OR a reworked WP the reviewer bounced for evidence (the revision
// window). Round-0 WPs (evidence = `after`) and completed WPs never offer it —
// the read-only history strip carries the past photos instead.
// ============================================================================
describe("canCaptureAfterFix — after_fix is capturable only inside a rework cycle", () => {
  const cases: ReadonlyArray<[WorkPackageStatus, number, boolean, boolean]> = [
    // status, reworkRound, revisionWindowOpen, expected
    ["rework", 1, false, true], // actively curing
    ["rework", 3, false, true], // a later round, still curing
    ["pending_approval", 1, true, true], // reworked WP bounced for evidence — re-shoot after_fix
    ["pending_approval", 1, false, false], // reworked WP awaiting first review — wait
    ["pending_approval", 0, true, false], // round-0 revision window → evidence is `after`, not after_fix
    ["pending_approval", 0, false, false], // round-0 first submit
    ["complete", 1, false, false], // reworked then completed — history only
    ["complete", 0, false, false], // the 20 legacy leaked WPs
    ["in_progress", 0, false, false], // never reworked
  ];

  it.each(cases)("%s round=%s window=%s → %s", (status, reworkRound, revisionWindowOpen, want) => {
    expect(canCaptureAfterFix({ status, reworkRound, revisionWindowOpen })).toBe(want);
  });
});

describe("the WP-detail page derives the after_fix capture flag from the predicate", () => {
  const pageSrc = readFileSync(
    join(process.cwd(), "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx"),
    "utf8",
  );

  it("computes showAfterFixCapture via canCaptureAfterFix and history via length", () => {
    expect(pageSrc.replace(/\s+/g, " ")).toContain(
      "canCaptureAfterFix({ status: wp.status, reworkRound: wp.rework_round,",
    );
    expect(pageSrc).toContain("const showAfterFixHistory = photosByPhase.after_fix.length > 0;");
  });

  it("retires the conflated showAfterFix boolean on both the detail and review pages", () => {
    expect(pageSrc).not.toContain("const showAfterFix =");
    // The review surface (src/app/review/…) is read-only — no capture — so it keeps
    // only the history gate; it must not carry a second copy of the retired boolean.
    const reviewSrc = readFileSync(
      join(process.cwd(), "src/app/review/work-packages/[workPackageId]/page.tsx"),
      "utf8",
    );
    expect(reviewSrc).not.toContain("const showAfterFix =");
    expect(reviewSrc).toContain("const showAfterFixHistory = photosByPhase.after_fix.length > 0;");
  });
});
