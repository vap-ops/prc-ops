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
        { wp: wp("d", "pending_approval"), decision: "needs_revision", comment: "ขอรูปเพิ่ม" },
        { wp: wp("e", "pending_approval"), decision: "rejected", comment: "ทำใหม่" },
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

  it("carries rework reason/source/round and the PM comment as the row context", () => {
    const { actions } = buildSaActionList({
      inPlay: [wp("b", "rework")],
      bounced: [
        { wp: wp("d", "pending_approval"), decision: "needs_revision", comment: "ขอรูปเพิ่ม" },
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
