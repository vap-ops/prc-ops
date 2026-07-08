import { describe, expect, it } from "vitest";

import { buildOrgChart } from "@/lib/org/org-chart";

// Spec 284 U2 / ADR 0080 — the org-chart read builder. Pure: groups users by
// their primary department_id, resolves each dept's head from head_user_id,
// orders active departments by sort_order, and hides inactive ones.
describe("buildOrgChart", () => {
  const depts = [
    {
      id: "d1",
      key: "legal",
      name_th: "กฎหมาย",
      is_active: true,
      head_user_id: "u1",
      sort_order: 60,
    },
    {
      id: "d0",
      key: "executive",
      name_th: "ผู้บริหาร",
      is_active: true,
      head_user_id: null,
      sort_order: 10,
    },
    { id: "dx", key: "hr", name_th: "บุคคล", is_active: false, head_user_id: null, sort_order: 70 },
  ];
  const users = [
    { id: "u1", full_name: "สมชาย", department_id: "d1" },
    { id: "u2", full_name: "สมหญิง", department_id: "d1" },
    { id: "u3", full_name: null, department_id: "d0" },
    { id: "u9", full_name: "ไม่มีแผนก", department_id: null },
  ];

  it("orders active depts by sort_order and hides inactive", () => {
    const chart = buildOrgChart(depts, users);
    expect(chart.map((d) => d.key)).toEqual(["executive", "legal"]); // hr inactive → hidden
  });

  it("groups members by department_id and resolves the head", () => {
    const legal = buildOrgChart(depts, users).find((d) => d.key === "legal")!;
    expect(legal.nameTh).toBe("กฎหมาย");
    expect(legal.head?.name).toBe("สมชาย");
    expect(legal.members.map((m) => m.id).sort()).toEqual(["u1", "u2"]);
  });

  it("head is undefined when head_user_id is null; missing name falls back", () => {
    const exec = buildOrgChart(depts, users).find((d) => d.key === "executive")!;
    expect(exec.head).toBeUndefined();
    expect(exec.members).toEqual([{ id: "u3", name: "(ไม่มีชื่อ)" }]);
  });

  it("users with no department_id are not placed in any dept", () => {
    const chart = buildOrgChart(depts, users);
    const allMemberIds = chart.flatMap((d) => d.members.map((m) => m.id));
    expect(allMemberIds).not.toContain("u9");
  });
});
