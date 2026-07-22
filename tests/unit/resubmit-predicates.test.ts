// Writing failing test first.
//
// Spec 337 U2a (F2) — the cure loop had no closing act. After a needs_revision
// the SA re-shot the photos and nothing told the decider; the item sat
// indistinguishable in a 40-deep queue and only closed when a PM happened to
// reopen it. The loop now closes on an EXPLICIT ส่งตรวจอีกครั้ง (operator
// decision 4: NOT on upload — the FB2 precedent removed auto-flip-on-photo
// because it sent partly-done work to review, and the PM's ask is free text so
// only the SA knows when it is answered).
//
// resubmitState is the whole visibility/enablement rule as one pure function,
// shared by the control (what to render) and the server action (what to
// refuse), so the two cannot drift.

import { describe, expect, it } from "vitest";
import {
  resubmitState,
  RESUBMIT_EVIDENCE_HINT,
  REVIEW_AWAITING_PHOTOS_LABEL,
  REVIEW_READY_AGAIN_LABEL,
  reviewQueueLabel,
  reviewQueueRank,
  type ResubmitDecision,
} from "@/lib/approvals/resubmit";

const DECISION_ID = "d1d1d1d1-0000-4000-8000-000000000001";
const DECIDER = "pm000000-0000-4000-8000-00000000pm01";
const SA = "sa000000-0000-4000-8000-00000000sa01";
const DECIDED_AT = "2026-07-20T10:00:00+00:00";
const BEFORE = "2026-07-20T09:00:00+00:00";
const AFTER = "2026-07-20T11:00:00+00:00";

const needsRevision: ResubmitDecision = {
  id: DECISION_ID,
  decision: "needs_revision",
  decided_at: DECIDED_AT,
  decided_by: DECIDER,
};

const noPhotos = { after: [], after_fix: [] };

function state(over: Partial<Parameters<typeof resubmitState>[0]> = {}) {
  return resubmitState({
    status: "pending_approval",
    latestDecision: needsRevision,
    currentPhotos: noPhotos,
    answeredDecisionIds: new Set<string>(),
    viewerId: SA,
    ...over,
  });
}

describe("resubmitState — when the control appears at all", () => {
  it("hides on a WP that is not in the review queue", () => {
    for (const status of ["not_started", "in_progress", "on_hold", "complete", "rework"] as const) {
      expect(state({ status }).kind).toBe("hidden");
    }
  });

  it("hides when the WP is pending with no decision yet (a first submit, not a cure)", () => {
    expect(state({ latestDecision: null }).kind).toBe("hidden");
  });

  it("hides when the latest decision was an approval or a work send-back", () => {
    // 'rejected' now flips the WP out of pending_approval entirely (F3), so it
    // can only appear here as a stale read — either way this is not a cure loop.
    for (const decision of ["approved", "rejected"] as const) {
      expect(state({ latestDecision: { ...needsRevision, decision } }).kind).toBe("hidden");
    }
  });

  it("appears for the exact state pair: pending_approval + latest needs_revision", () => {
    expect(state().kind).not.toBe("hidden");
  });

  // PM_ROLES ⊂ SITE_STAFF_ROLES and the WP page renders this for every
  // non-read-only viewer, so the DECIDER can reach their own bounce. Pressing it
  // there notifies NOBODY (resolveRecipients excludes the actor) while burning
  // the RPC's one-resubmit-per-decision AND clearing the SA's list item — a WP
  // in nobody's queue. Hidden for them; their control is the decision form.
  it("hides from the decider looking at their own bounce", () => {
    expect(
      state({
        viewerId: DECIDER,
        currentPhotos: { after: [{ created_at: AFTER }], after_fix: [] },
      }).kind,
    ).toBe("hidden");
  });

  it("still appears for anyone who is not the decider", () => {
    expect(state({ viewerId: SA }).kind).not.toBe("hidden");
  });
});

describe("resubmitState — the new-photo gate", () => {
  it("blocks with the hint when there is no photo at all", () => {
    expect(state()).toEqual({ kind: "blocked", hint: RESUBMIT_EVIDENCE_HINT });
  });

  it("blocks when every current photo predates the decision (the stale re-shoot)", () => {
    expect(state({ currentPhotos: { after: [{ created_at: BEFORE }], after_fix: [] } })).toEqual({
      kind: "blocked",
      hint: RESUBMIT_EVIDENCE_HINT,
    });
  });

  it("blocks a photo taken at exactly the decision instant (strictly newer wins)", () => {
    expect(
      state({ currentPhotos: { after: [{ created_at: DECIDED_AT }], after_fix: [] } }).kind,
    ).toBe("blocked");
  });

  it("unlocks on a new after photo", () => {
    expect(state({ currentPhotos: { after: [{ created_at: AFTER }], after_fix: [] } })).toEqual({
      kind: "ready",
    });
  });

  it("unlocks on a new after_fix photo (a rework round that bounced)", () => {
    expect(state({ currentPhotos: { after: [], after_fix: [{ created_at: AFTER }] } })).toEqual({
      kind: "ready",
    });
  });

  it("unlocks when a new photo sits among older ones", () => {
    expect(
      state({
        currentPhotos: { after: [{ created_at: BEFORE }, { created_at: AFTER }], after_fix: [] },
      }).kind,
    ).toBe("ready");
  });

  // The boundary is the LATEST decision, so it resets on every bounce: photos
  // that unlocked round 1 must not unlock round 2.
  it("re-blocks after a second needs_revision, using the newer boundary", () => {
    const secondBounce: ResubmitDecision = {
      id: "d2d2d2d2-0000-4000-8000-000000000002",
      decision: "needs_revision",
      decided_at: "2026-07-20T12:00:00+00:00",
      decided_by: DECIDER,
    };
    expect(
      state({
        latestDecision: secondBounce,
        currentPhotos: { after: [{ created_at: AFTER }], after_fix: [] },
      }).kind,
    ).toBe("blocked");
  });
});

// Spec 337 U2 approver side — the other half of the SA-side clear. When a bounce
// leaves the SA's list it must become visibly the DECIDER's move here, or the WP
// belongs to nobody: the resubmit ping is a single mute-able push, and the queue
// row is otherwise byte-identical before and after the resubmit.
describe("reviewQueueLabel / reviewQueueRank", () => {
  const fallback = (d: string | null) => (d === null ? "รอตรวจครั้งแรก" : `label:${d}`);

  it("splits the needs_revision items in two", () => {
    expect(reviewQueueLabel("needs_revision", false, fallback)).toBe(REVIEW_AWAITING_PHOTOS_LABEL);
    expect(reviewQueueLabel("needs_revision", true, fallback)).toBe(REVIEW_READY_AGAIN_LABEL);
  });

  it("leaves every other queue row's label alone", () => {
    expect(reviewQueueLabel(null, false, fallback)).toBe("รอตรวจครั้งแรก");
    expect(reviewQueueLabel("rejected", true, fallback)).toBe("label:rejected");
  });

  it("lifts answered bounces above the rest, and nothing else", () => {
    expect(reviewQueueRank("needs_revision", true)).toBeLessThan(
      reviewQueueRank("needs_revision", false),
    );
    expect(reviewQueueRank("needs_revision", true)).toBeLessThan(reviewQueueRank(null, false));
    // Same rank for everything unanswered → a stable sort preserves spec 15's
    // oldest-first ordering underneath.
    expect(reviewQueueRank(null, false)).toBe(reviewQueueRank("needs_revision", false));
  });
});

describe("resubmitState — one resubmit per decision", () => {
  it("reports done once this decision has been answered", () => {
    expect(
      state({
        currentPhotos: { after: [{ created_at: AFTER }], after_fix: [] },
        answeredDecisionIds: new Set([DECISION_ID]),
      }),
    ).toEqual({ kind: "done" });
  });

  it("still reports done when the photos would otherwise block (no dead button)", () => {
    expect(state({ answeredDecisionIds: new Set([DECISION_ID]) }).kind).toBe("done");
  });

  it("ignores a resubmit that answered a PREVIOUS decision", () => {
    expect(
      state({
        currentPhotos: { after: [{ created_at: AFTER }], after_fix: [] },
        answeredDecisionIds: new Set(["d0d0d0d0-0000-4000-8000-000000000000"]),
      }).kind,
    ).toBe("ready");
  });
});
