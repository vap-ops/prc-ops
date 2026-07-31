// Spec 218 U1 — the SA "ต้องแก้ไข" classifier: split the SA's WPs into the ones
// that need their correction (rework / ให้แก้ไข / ไม่อนุมัติ) vs the rest.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSaActionList,
  buildCaptureWps,
  bounceAnswered,
  isBounceableStatus,
  type SaActionItem,
} from "@/lib/sa/action-list";
import type { MyWorkWp, MyWorkItem } from "@/lib/sa/my-work";

const projectsById = new Map([
  ["pr1", { code: "PRC-A", name: "อาคาร A" }],
  ["pr2", { code: "PRC-B", name: "อาคาร B" }],
]);

function wp(id: string, status: MyWorkWp["status"], project_id = "pr1"): MyWorkWp {
  return {
    id,
    code: id.toUpperCase(),
    name: `งาน ${id}`,
    status,
    project_id,
    category_id: null,
    // Spec 375 U1 — movement tie-break; constant here so these cases keep
    // exercising the legacy project/code ordering they were written for.
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildSaActionList", () => {
  it("pulls rework + bounced WPs into actions; everything else stays in rest", () => {
    const { actions, rest } = buildSaActionList({
      inPlay: [wp("a", "in_progress"), wp("b", "rework"), wp("c", "on_hold")],
      bounced: [
        {
          wp: wp("d", "pending_approval"),
          decision: "needs_revision",
          comment: "ขอรูปเพิ่ม",
          revisionReason: null,
          answered: false,
          // Spec 384 U1 — the age the stale band and the group order read.
          decidedAt: "2026-07-20T00:00:00.000+00:00",
        },
        {
          wp: wp("e", "pending_approval"),
          decision: "rejected",
          comment: "ทำใหม่",
          revisionReason: null,
          answered: false,
          // Spec 384 U1 — the age the stale band and the group order read.
          decidedAt: "2026-07-20T00:00:00.000+00:00",
        },
      ],
      reworkInfo: new Map([["b", { reason: "รอยร้าว", source: "client", round: 2, since: null }]]),
      projectsById,
    });
    expect(actions.map((x) => [x.id, x.kind])).toEqual([
      ["e", "rejected"],
      ["b", "rework"],
      ["d", "revision"],
    ]);
    expect(rest.map((x) => x.id)).toEqual(["a", "c"]);
  });

  // Spec 355 U3 — the structured reject-evidence reason rides the bounce into the
  // worklist row, so the ต้องแก้ไข chip can say WHY (mismatch ≠ add-more).
  it("threads the revision reason from the bounce to the revision row (null elsewhere)", () => {
    const { actions } = buildSaActionList({
      inPlay: [wp("b", "rework")],
      bounced: [
        {
          wp: wp("d", "pending_approval"),
          decision: "needs_revision",
          comment: null,
          revisionReason: "mismatch",
          answered: false,
          // Spec 384 U1 — the age the stale band and the group order read.
          decidedAt: "2026-07-20T00:00:00.000+00:00",
        },
        {
          wp: wp("e", "pending_approval"),
          decision: "rejected",
          comment: "ทำใหม่",
          revisionReason: null,
          answered: false,
          // Spec 384 U1 — the age the stale band and the group order read.
          decidedAt: "2026-07-20T00:00:00.000+00:00",
        },
      ],
      reworkInfo: new Map([["b", { reason: "รอยร้าว", source: "client", round: 2, since: null }]]),
      projectsById,
    });
    expect(actions.find((x) => x.id === "d")!.revisionReason).toBe("mismatch");
    expect(actions.find((x) => x.id === "e")!.revisionReason).toBeNull();
    expect(actions.find((x) => x.id === "b")!.revisionReason).toBeNull();
  });

  it("carries rework reason/source/round and the PM comment as the row context", () => {
    const { actions } = buildSaActionList({
      inPlay: [wp("b", "rework")],
      bounced: [
        {
          wp: wp("d", "pending_approval"),
          decision: "needs_revision",
          comment: "ขอรูปเพิ่ม",
          revisionReason: null,
          answered: false,
          // Spec 384 U1 — the age the stale band and the group order read.
          decidedAt: "2026-07-20T00:00:00.000+00:00",
        },
      ],
      reworkInfo: new Map([["b", { reason: "รอยร้าว", source: "client", round: 2, since: null }]]),
      projectsById,
    });
    const rework = actions.find((x): x is SaActionItem => x.id === "b")!;
    expect(rework.reason).toBe("รอยร้าว");
    expect(rework.source).toBe("client");
    expect(rework.round).toBe(2);
    expect(rework.projectCode).toBe("PRC-A");
    const rev = actions.find((x) => x.id === "d")!;
    expect(rev.reason).toBe("ขอรูปเพิ่ม");
    expect(rev.source).toBeNull();
    expect(rev.round).toBeNull();
  });

  // Spec 337 U2a — the cure loop's clear condition. Once the SA has pressed
  // ส่งตรวจอีกครั้ง the ball is back with the decider, so the item must leave the
  // SA's ต้องแก้ไข list; leaving it there is what made the old loop feel endless.
  // The WP stays pending_approval throughout, so status alone cannot tell.
  it("drops a ให้แก้ไข item once the SA has answered it", () => {
    const { actions, rest } = buildSaActionList({
      inPlay: [],
      bounced: [
        {
          wp: wp("d", "pending_approval"),
          decision: "needs_revision",
          comment: "ขอรูปเพิ่ม",
          revisionReason: null,
          answered: true,
          // Spec 384 U1 — the age the stale band and the group order read.
          decidedAt: "2026-07-20T00:00:00.000+00:00",
        },
      ],
      reworkInfo: new Map(),
      projectsById,
    });
    expect(actions).toEqual([]);
    // …and it does NOT reappear in the ordinary worklist: it is still in the
    // review queue, just not the SA's move.
    expect(rest).toEqual([]);
  });

  it("keeps an unanswered bounce alongside an answered one", () => {
    const { actions } = buildSaActionList({
      inPlay: [],
      bounced: [
        {
          wp: wp("d", "pending_approval"),
          decision: "needs_revision",
          comment: "ขอรูปเพิ่ม",
          revisionReason: null,
          answered: true,
          // Spec 384 U1 — the age the stale band and the group order read.
          decidedAt: "2026-07-20T00:00:00.000+00:00",
        },
        {
          wp: wp("f", "pending_approval"),
          decision: "needs_revision",
          comment: "อีกจุด",
          revisionReason: null,
          answered: false,
          // Spec 384 U1 — the age the stale band and the group order read.
          decidedAt: "2026-07-20T00:00:00.000+00:00",
        },
      ],
      reworkInfo: new Map(),
      projectsById,
    });
    expect(actions.map((x) => x.id)).toEqual(["f"]);
  });

  it("returns no actions when nothing needs the SA's fix", () => {
    const { actions, rest } = buildSaActionList({
      inPlay: [wp("a", "in_progress"), wp("c", "not_started")],
      bounced: [],
      reworkInfo: new Map(),
      projectsById,
    });
    expect(actions).toEqual([]);
    expect(rest.map((x) => x.id)).toEqual(["a", "c"]);
  });
});

// Spec 384 U2 — `captureWps = rest` made the camera FAB's picker the exact
// COMPLEMENT of `actions`: every rework/bounced WP `buildSaActionList` puts in
// `actions` (the ones the ต้องแก้ไข section is asking for a photo on) is by
// construction absent from `rest`, so the SA's most-used control could never
// resolve to precisely the WPs she opened it for.
function actionItem(id: string, overrides: Partial<SaActionItem> = {}): SaActionItem {
  return {
    id,
    code: id.toUpperCase(),
    name: `งาน ${id}`,
    projectId: "pr1",
    projectCode: "PRC-A",
    projectName: "อาคาร A",
    kind: "revision",
    reason: null,
    source: null,
    round: null,
    revisionReason: null,
    sinceIso: null,
    ...overrides,
  };
}

function restItem(id: string, overrides: Partial<MyWorkItem> = {}): MyWorkItem {
  return {
    id,
    code: id.toUpperCase(),
    name: `งาน ${id}`,
    status: "in_progress",
    projectId: "pr1",
    projectName: "อาคาร A",
    projectCode: "PRC-A",
    categoryCode: null,
    lastPhotoAt: null,
    isCold: false,
    ...overrides,
  };
}

describe("buildCaptureWps — the camera FAB's domain (spec 384 U2)", () => {
  it("includes action WPs (rework/bounced) — the whole point of the fix", () => {
    const wps = buildCaptureWps([actionItem("d"), actionItem("b", { kind: "rework" })], []);
    expect(wps.map((w) => w.id).sort()).toEqual(["b", "d"]);
  });

  it("still includes the ordinary rest WPs", () => {
    const wps = buildCaptureWps([], [restItem("a"), restItem("c")]);
    expect(wps.map((w) => w.id).sort()).toEqual(["a", "c"]);
  });

  it("unions both sets", () => {
    const wps = buildCaptureWps([actionItem("d")], [restItem("a")]);
    expect(wps.map((w) => w.id).sort()).toEqual(["a", "d"]);
  });

  // Spec 384 §5 build-trap 8: widening CameraFab's domain moves both of its
  // boundaries. This is the newly-REACHABLE one — a SA with exactly one
  // bounced/rework WP and nothing else in play used to get NO fab at all
  // (`rest` was empty); she now gets the single-WP direct-link form. Before
  // this fix that state was unreachable, so nothing pinned it.
  it("reaches length 1 from an action WP alone — the FAB's single-link boundary", () => {
    expect(buildCaptureWps([actionItem("a")], [])).toHaveLength(1);
  });

  // A `premature` bounce sits at `in_progress` (spec 372 U3), which is BOTH an
  // action (unanswered bounce) and, today, a `rest` row — the one case where
  // the two input sets already overlap. The picker must not offer it twice.
  it("de-dupes a WP that appears in both sets", () => {
    const wps = buildCaptureWps([actionItem("a")], [restItem("a")]);
    expect(wps.map((w) => w.id)).toEqual(["a"]);
  });

  it("carries only the fields the FAB needs, from the action row on a dupe", () => {
    const wps = buildCaptureWps(
      [actionItem("a", { code: "A-1", name: "งานเอ", projectId: "pr9" })],
      [restItem("a", { code: "STALE", name: "ชื่อเก่า", projectId: "pr1" })],
    );
    expect(wps).toEqual([{ id: "a", projectId: "pr9", code: "A-1", name: "งานเอ" }]);
  });

  it("returns nothing when both sets are empty", () => {
    expect(buildCaptureWps([], [])).toEqual([]);
  });

  // Spec 384 §3 U2: "actions ∪ rest, bounced rows first" — the ต้องแก้ไข rows
  // (already severity-ordered by buildSaActionList: rejected → rework →
  // revision) come before the ordinary worklist, not re-sorted or interleaved.
  it("orders every action row ahead of every rest row, in the actions' own order", () => {
    const wps = buildCaptureWps(
      [
        actionItem("rejected-1", { kind: "rejected" }),
        actionItem("rework-1", { kind: "rework" }),
        actionItem("revision-1", { kind: "revision" }),
      ],
      [restItem("z"), restItem("a")],
    );
    expect(wps.map((w) => w.id)).toEqual(["rejected-1", "rework-1", "revision-1", "z", "a"]);
  });
});

// Spec 372 U3 — `premature` ("งานยังไม่เสร็จ") now sends the WP back to `in_progress`
// instead of parking un-actionable work in the review queue. That moves it OUT of the
// pending_approval population the SA's ต้องแก้ไข lane was built from, so without this
// rule the PM's message would simply vanish and the SA would see an ordinary
// in-progress WP with no idea it had come back.
//
// It also inverts what "answered" means. For the photo bounces the WP never leaves
// pending_approval, so only a `wp_evidence_resubmitted` audit row can say the SA
// acted. For premature the STATUS is the signal: while the work is unfinished the WP
// sits at in_progress; once the SA finishes and submits, it returns to
// pending_approval and the ball is with the PM again.
describe("bounceAnswered — whose move is it (spec 372 U3)", () => {
  const premature = { decision: "needs_revision" as const, revisionReason: "premature" as const };
  const photoBounce = { decision: "needs_revision" as const, revisionReason: "mismatch" as const };

  it("a premature bounce is the SA's move while the work is unfinished", () => {
    expect(bounceAnswered({ ...premature, status: "in_progress", hasResubmitAudit: false })).toBe(
      false,
    );
    // …and no resubmit audit row will ever exist for it — the SA submits normally,
    // so keying on the audit row would pin it to the list forever.
    expect(bounceAnswered({ ...premature, status: "in_progress", hasResubmitAudit: true })).toBe(
      false,
    );
  });

  it("a premature bounce is ANSWERED once the WP is back in the review queue", () => {
    expect(
      bounceAnswered({ ...premature, status: "pending_approval", hasResubmitAudit: false }),
    ).toBe(true);
  });

  it("the photo bounces still key on the resubmit audit row, not the status", () => {
    expect(
      bounceAnswered({ ...photoBounce, status: "pending_approval", hasResubmitAudit: false }),
    ).toBe(false);
    expect(
      bounceAnswered({ ...photoBounce, status: "pending_approval", hasResubmitAudit: true }),
    ).toBe(true);
  });

  it("a reject-work bounce keys on the audit row too", () => {
    const rejected = { decision: "rejected" as const, revisionReason: null };
    expect(bounceAnswered({ ...rejected, status: "rework", hasResubmitAudit: false })).toBe(false);
    expect(bounceAnswered({ ...rejected, status: "rework", hasResubmitAudit: true })).toBe(true);
  });
});

// Spec 372 U3 — the WIRING half. /sa is a Server Component vitest cannot render, so
// the RULE is unit-tested above and the page's use of it is pinned here by source
// scan (comments stripped first, so prose naming a symbol cannot satisfy it).
//
// The thing that must not regress: the population the bounce lane is built from. It
// was `pendingWps` alone, and a premature WP is no longer in that set — shipping the
// RPC route without widening this would delete the PM's message from the SA's view.
describe("/sa surfaces a premature bounce (spec 372 U3)", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/sa/page.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const occurrences = (needle: string) => src.split(needle).length - 1;

  it("routes the answered question through the shared rule, not an inline audit lookup", () => {
    // import + one call.
    expect(occurrences("bounceAnswered")).toBe(2);
    // `answered` must be DECIDED by the rule. The audit lookup itself survives —
    // correctly — as an INPUT to it, so forbidding that string would be wrong; what
    // must not come back is the lookup being the answer.
    expect(src).toContain("answered: bounceAnswered(");
    expect(src).not.toContain("answered: dec.id !== undefined && answeredDecisionIds");
  });

  it("builds the bounce lane from the shared predicate, not an inline status list", () => {
    // Mutation-checked: pinning the SYMBOL alone stayed green when the predicate was
    // narrowed back to pending-only, because the name survived. The predicate itself
    // is what must be pinned, so it lives in action-list.ts and is tested over the
    // whole status domain below.
    expect(occurrences("isBounceableStatus")).toBe(2);
  });

  it("OLD-SHAPE GUARD: the page no longer filters the lane to pending_approval alone", () => {
    // `pendingWps` alone excludes in_progress by construction, so the lane must be
    // built from a wider set. Pinning the symbol, not the exact expression, so the
    // page can refactor without this becoming a copy of the implementation.
    expect(occurrences("bounceableWps")).toBeGreaterThanOrEqual(2);
  });
});

// The predicate itself, over the WHOLE status domain — so adding a status without
// deciding whether a bounce can sit in it reds here rather than silently excluding it.
describe("isBounceableStatus — which statuses can hold a bounce (spec 372 U3)", () => {
  it("admits exactly pending_approval and in_progress", () => {
    const ALL = [
      "not_started",
      "in_progress",
      "on_hold",
      "complete",
      "pending_approval",
      "rework",
    ] as const;
    expect(ALL.filter(isBounceableStatus).sort()).toEqual(
      ["in_progress", "pending_approval"].sort(),
    );
  });

  it("in_progress is admitted — that is the whole point of U3", () => {
    // A premature bounce lives here. Excluding it deletes the PM's reason from the
    // SA's lane, which is the regression this unit exists to prevent.
    expect(isBounceableStatus("in_progress")).toBe(true);
  });

  it("rework is NOT a bounce — it has its own lane with the round and defect reason", () => {
    expect(isBounceableStatus("rework")).toBe(false);
  });
});

// Sibling sweep: the WP-detail attention card is the SECOND surface that decides
// whose move it is, and it keys on the latest decision with no status filter. It read
// `answeredDecisionIds` directly — a row a premature bounce never writes — so it would
// have shown a live re-shoot CTA forever, including after the SA finished the work and
// the WP was already back in the review queue.
describe("WP detail decides answered by the same rule (spec 372 U3)", () => {
  const wpSrc = readFileSync(
    resolve(process.cwd(), "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  it("routes attentionAnswered through the shared rule", () => {
    expect(wpSrc.split("bounceAnswered").length - 1).toBe(2);
    // The bare lookup must not be the answer again.
    expect(wpSrc).not.toContain("attentionAnswered = attention ? answeredDecisionIds.has");
  });

  it("feeds the rule the WP's own status — the discriminator for a premature bounce", () => {
    // Mutation-checked: a bare toContain("status: wp.status") is VACUOUS here — that
    // string appears four other times in this page, so it could never fail. Assert it
    // inside the bounceAnswered call itself.
    const call = wpSrc.slice(wpSrc.indexOf("bounceAnswered({"));
    const args = call.slice(0, call.indexOf("})") + 2);
    expect(args).toContain("status: wp.status");
    expect(args).toContain("decision: attention.decision");
    expect(args).toContain("hasResubmitAudit:");
  });
});

// /sa is a Server Component vitest cannot render, so — same idiom as the two
// wiring-pin blocks above — the RULE is unit-tested above and the page's use
// of it is pinned here by source scan.
describe("/sa wires the FAB from buildCaptureWps, not from rest alone (spec 384 U2)", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/sa/page.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const occurrences = (needle: string) => src.split(needle).length - 1;

  it("routes captureWps through the shared union helper, called with actions", () => {
    // import + one call — a bare toContain("buildCaptureWps") is satisfied by
    // the IMPORT LINE ALONE (comments are stripped, the import is not), so
    // `buildCaptureWps([], items)` — the §1.4 bug verbatim — would pass a
    // presence-only check while lint/typecheck/the suite all stay green.
    expect(occurrences("buildCaptureWps")).toBe(2);
    expect(src).toMatch(/captureWps\s*=\s*buildCaptureWps\(\s*actions\s*,/);
  });

  // OLD-SHAPE GUARD: this is the exact bug — captureWps derived by mapping
  // `items` (== rest) alone, which is `actions`' complement by construction.
  it("OLD-SHAPE GUARD: captureWps is no longer items.map(...) alone", () => {
    expect(src).not.toMatch(/captureWps\s*=\s*items\.map/);
  });
});
