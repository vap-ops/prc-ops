// Spec 192 U4 — the site-admin daily home's "งานของฉัน" list. Pure builder: the
// SA's visible, not-done work packages joined to their project name, sorted by
// project then WP code (a stable field order). The page does the RLS-scoped read;
// this is the view-model assembly, unit-testable without Supabase.

import { describe, it, expect } from "vitest";
import { buildMyWorkList, type MyWorkWp } from "@/lib/sa/my-work";

const PROJECTS = new Map([
  ["p1", { code: "PRJ-001", name: "อาคารสำนักงาน" }],
  ["p2", { code: "PRJ-002", name: "บ้านพักอาศัย" }],
]);

function wp(p: Partial<MyWorkWp> & Pick<MyWorkWp, "id" | "code" | "project_id">): MyWorkWp {
  return { name: "งาน", status: "in_progress", ...p };
}

describe("buildMyWorkList", () => {
  it("returns an empty list for no work packages", () => {
    expect(buildMyWorkList([], PROJECTS)).toEqual([]);
  });

  it("joins each WP to its project and sorts by project code then WP code", () => {
    const result = buildMyWorkList(
      [
        wp({ id: "b", code: "WP-02", project_id: "p2" }),
        wp({ id: "a", code: "WP-02", project_id: "p1" }),
        wp({ id: "c", code: "WP-01", project_id: "p1" }),
      ],
      PROJECTS,
    );
    expect(result.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(result[0]).toMatchObject({
      id: "c",
      code: "WP-01",
      projectId: "p1",
      projectCode: "PRJ-001",
      projectName: "อาคารสำนักงาน",
    });
  });

  it("falls back to — for an unknown project", () => {
    const result = buildMyWorkList([wp({ id: "x", code: "WP-09", project_id: "ghost" })], PROJECTS);
    expect(result[0]?.projectName).toBe("—");
    expect(result[0]?.projectCode).toBe("");
  });
});
