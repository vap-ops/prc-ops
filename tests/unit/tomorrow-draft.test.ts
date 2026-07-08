// Spec 281 U2 — the page-integration assembler: turns the /sa/plan reads (raw rows +
// resolution maps) into engine inputs and returns the DraftItem[]. Tests cover the
// DERIVATION it owns (category/baseline onto WPs, recent-crew + crew-categories from
// 273 board history); the scoring itself is U1's tested contract. RED-first.

import { describe, expect, it } from "vitest";
import { buildTomorrowDraft, type BuildTomorrowDraftInput } from "@/lib/sa/tomorrow-draft";

const PLAN_DATE = "2026-07-09";

function base(overrides: Partial<BuildTomorrowDraftInput> = {}): BuildTomorrowDraftInput {
  return {
    planDate: PLAN_DATE,
    workPackages: [],
    categoryCodeById: new Map(),
    baselineFinishByWp: new Map(),
    crews: [],
    crewMembers: [],
    recentPlanItems: [],
    recentPlanCrew: [],
    ...overrides,
  };
}

const wpRow = (
  o: Partial<BuildTomorrowDraftInput["workPackages"][number]> & { id: string; code: string },
) => ({
  id: o.id,
  code: o.code,
  name: o.name ?? o.code,
  status: o.status ?? ("not_started" as const),
  is_group: o.is_group ?? false,
  priority: o.priority ?? ("normal" as const),
  category_id: o.category_id ?? null,
});

describe("buildTomorrowDraft — WP resolution", () => {
  it("resolves category_id → code and the baseline finish onto each WP", () => {
    const items = buildTomorrowDraft(
      base({
        workPackages: [wpRow({ id: "a", code: "A-1", category_id: "pc1" })],
        categoryCodeById: new Map([["pc1", "W02"]]),
        baselineFinishByWp: new Map([["a", "2026-07-01"]]),
      }),
    );
    // baseline in the past → behind_schedule proves the baseline map is wired.
    expect(items[0]).toMatchObject({ workPackageId: "a", tier: "behind_schedule" });
  });

  it("degrades to priority, blank-crew rows when crews + history are empty", () => {
    const items = buildTomorrowDraft(
      base({ workPackages: [wpRow({ id: "a", code: "A-1", status: "not_started" })] }),
    );
    expect(items[0]).toMatchObject({ tier: "priority", crew: null });
  });
});

describe("buildTomorrowDraft — crew derivation from 273 board history", () => {
  it("pre-assigns the recent-continuity crew derived from a recent board", () => {
    const items = buildTomorrowDraft(
      base({
        workPackages: [wpRow({ id: "a", code: "A-1", status: "in_progress" })],
        crews: [{ id: "C1", name: "ทีมเอ", lead_worker_id: "w1" }],
        crewMembers: [{ crew_id: "C1", worker_id: "w1" }],
        recentPlanItems: [{ id: "i1", work_package_id: "a" }],
        recentPlanCrew: [{ item_id: "i1", worker_id: "w1" }],
      }),
    );
    expect(items[0]!.crew).toMatchObject({ crewId: "C1", workerIds: ["w1"] });
    expect(items[0]!.crew!.reason).toContain("ล่าสุด");
  });

  it("derives a crew's spec-277 categories from the board history for a category match", () => {
    const items = buildTomorrowDraft(
      base({
        // C1 ran a W02 งาน (x) on a recent board → learns category W02.
        workPackages: [
          wpRow({ id: "x", code: "X-1", status: "in_progress", category_id: "pc2" }),
          wpRow({ id: "a", code: "A-1", status: "not_started", category_id: "pc2" }),
        ],
        categoryCodeById: new Map([["pc2", "W02"]]),
        crews: [{ id: "C1", name: "ทีมเอ", lead_worker_id: "w1" }],
        crewMembers: [{ crew_id: "C1", worker_id: "w1" }],
        recentPlanItems: [{ id: "ix", work_package_id: "x" }],
        recentPlanCrew: [{ item_id: "ix", worker_id: "w1" }],
      }),
    );
    // 'a' (not on a recent board, no recent crew) gets C1 by category-match.
    const rowA = items.find((i) => i.workPackageId === "a")!;
    expect(rowA.crew).toMatchObject({ crewId: "C1" });
    expect(rowA.crew!.reason).toContain("หมวดงาน");
  });

  it("lets the newest board's crew win when a WP ran under two crews", () => {
    const items = buildTomorrowDraft(
      base({
        workPackages: [wpRow({ id: "a", code: "A-1", status: "in_progress" })],
        crews: [
          { id: "C1", name: "ทีมเอ", lead_worker_id: "w1" },
          { id: "C2", name: "ทีมบี", lead_worker_id: "w2" },
        ],
        crewMembers: [
          { crew_id: "C1", worker_id: "w1" },
          { crew_id: "C2", worker_id: "w2" },
        ],
        // newest-first: i_new (C2) precedes i_old (C1).
        recentPlanItems: [
          { id: "i_new", work_package_id: "a" },
          { id: "i_old", work_package_id: "a" },
        ],
        recentPlanCrew: [
          { item_id: "i_new", worker_id: "w2" },
          { item_id: "i_old", worker_id: "w1" },
        ],
      }),
    );
    expect(items[0]!.crew).toMatchObject({ crewId: "C2" });
  });

  it("maps a lead who is not a member into their crew's roster", () => {
    const items = buildTomorrowDraft(
      base({
        workPackages: [wpRow({ id: "a", code: "A-1", status: "in_progress" })],
        crews: [{ id: "C1", name: "ทีมเอ", lead_worker_id: "w9" }],
        crewMembers: [], // w9 leads but has no member row
        recentPlanItems: [{ id: "i1", work_package_id: "a" }],
        recentPlanCrew: [{ item_id: "i1", worker_id: "w9" }],
      }),
    );
    expect(items[0]!.crew).toMatchObject({ crewId: "C1", workerIds: ["w9"], leadWorkerId: "w9" });
  });
});
