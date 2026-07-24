import { describe, expect, it } from "vitest";
import {
  buildAssignedWorkView,
  type AssignedWorkRpcRow,
} from "@/lib/technician/assigned-work-view";

type Row = AssignedWorkRpcRow;

function row(p: Partial<Row>): Row {
  return {
    wp_id: "w1",
    code: "C1",
    name: "n",
    is_group: false,
    status: "in_progress",
    parent_id: null,
    parent_code: null,
    parent_name: null,
    group_child_statuses: [],
    work_date: "2026-07-20",
    ...p,
  };
}

describe("buildAssignedWorkView", () => {
  it("a group row derives % from its own children; parentName is null", () => {
    const v = buildAssignedWorkView([
      row({
        wp_id: "g1",
        code: "S-G1",
        name: "งานหนึ่ง",
        is_group: true,
        status: "in_progress",
        group_child_statuses: ["complete", "complete", "in_progress"],
      }),
    ]);
    expect(v.rows[0]!.groupProgress).toEqual({ percent: 67, completeCount: 2, totalCount: 3 });
    expect(v.rows[0]!.parentName).toBeNull();
  });

  it("a leaf row carries its parent's name and the parent's %", () => {
    const v = buildAssignedWorkView([
      row({
        wp_id: "l1",
        code: "S-L1",
        name: "ย่อย",
        is_group: false,
        status: "not_started",
        parent_id: "g2",
        parent_code: "S-G2",
        parent_name: "งานปูกระเบื้อง",
        group_child_statuses: ["not_started", "complete"],
      }),
    ]);
    expect(v.rows[0]!.parentName).toBe("งานปูกระเบื้อง");
    expect(v.rows[0]!.groupProgress).toEqual({ percent: 50, completeCount: 1, totalCount: 2 });
  });

  it("an ungrouped leaf (no children) has no group progress", () => {
    const v = buildAssignedWorkView([
      row({
        wp_id: "u1",
        code: "S-U1",
        is_group: false,
        parent_id: null,
        group_child_statuses: [],
      }),
    ]);
    expect(v.rows[0]!.groupProgress).toBeNull();
    expect(v.rows[0]!.parentName).toBeNull();
  });

  it("empty input → workDate null, no rows; non-empty → workDate from the first row", () => {
    expect(buildAssignedWorkView([])).toEqual({ workDate: null, rows: [] });
    const v = buildAssignedWorkView([row({ work_date: "2026-07-22" })]);
    expect(v.workDate).toBe("2026-07-22");
    expect(v.rows).toHaveLength(1);
  });
});
