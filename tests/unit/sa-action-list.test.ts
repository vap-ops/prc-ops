// Spec 218 U1 — the SA "ต้องแก้ไข" classifier: split the SA's WPs into the ones
// that need their correction (rework / ให้แก้ไข / ไม่อนุมัติ) vs the rest.

import { describe, it, expect } from "vitest";
import { buildSaActionList, type SaActionItem } from "@/lib/sa/action-list";
import type { MyWorkWp } from "@/lib/sa/my-work";

const projectsById = new Map([
  ["pr1", { code: "PRC-A", name: "อาคาร A" }],
  ["pr2", { code: "PRC-B", name: "อาคาร B" }],
]);

function wp(id: string, status: MyWorkWp["status"], project_id = "pr1"): MyWorkWp {
  return { id, code: id.toUpperCase(), name: `งาน ${id}`, status, project_id, category_id: null };
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
        },
        {
          wp: wp("e", "pending_approval"),
          decision: "rejected",
          comment: "ทำใหม่",
          revisionReason: null,
          answered: false,
        },
      ],
      reworkInfo: new Map([["b", { reason: "รอยร้าว", source: "client", round: 2 }]]),
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
        },
        {
          wp: wp("e", "pending_approval"),
          decision: "rejected",
          comment: "ทำใหม่",
          revisionReason: null,
          answered: false,
        },
      ],
      reworkInfo: new Map([["b", { reason: "รอยร้าว", source: "client", round: 2 }]]),
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
        },
      ],
      reworkInfo: new Map([["b", { reason: "รอยร้าว", source: "client", round: 2 }]]),
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
        },
        {
          wp: wp("f", "pending_approval"),
          decision: "needs_revision",
          comment: "อีกจุด",
          revisionReason: null,
          answered: false,
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
