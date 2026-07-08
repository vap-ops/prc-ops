// Spec 281 U1 — the แนะนำแผนพรุ่งนี้ recommender engine. Pure, deterministic,
// tiered scoring over already-fetched rows → DraftItem[]. Tests are RED-first.

import { describe, expect, it } from "vitest";
import {
  recommendTomorrowBoard,
  type RecommendInput,
  type RecommenderWp,
} from "@/lib/sa/recommend-board";

const PLAN_DATE = "2026-07-09"; // the day the board is drafted FOR (tomorrow)

function wp(partial: Partial<RecommenderWp> & Pick<RecommenderWp, "id" | "code">): RecommenderWp {
  return {
    id: partial.id,
    code: partial.code,
    name: partial.name ?? partial.code,
    status: partial.status ?? "not_started",
    isGroup: partial.isGroup ?? false,
    priority: partial.priority ?? "normal",
    categoryCode: partial.categoryCode ?? null,
    baselineFinish: partial.baselineFinish ?? null,
  };
}

function baseInput(overrides: Partial<RecommendInput> = {}): RecommendInput {
  return {
    workPackages: [],
    crews: [],
    recentBoardWpIds: new Set<string>(),
    recentCrewByWp: new Map<string, string>(),
    planDate: PLAN_DATE,
    ...overrides,
  };
}

describe("recommendTomorrowBoard — tiers", () => {
  it("carries forward a started (in_progress) not-done leaf as tier carry_forward", () => {
    const items = recommendTomorrowBoard(
      baseInput({ workPackages: [wp({ id: "a", code: "A-1", status: "in_progress" })] }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ workPackageId: "a", tier: "carry_forward" });
    expect(items[0]!.reason).toContain("ต่อจากวันนี้");
  });

  it("carries forward a WP that was on a recent board even if status is not_started (D3 aggressive)", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [wp({ id: "a", code: "A-1", status: "not_started" })],
        recentBoardWpIds: new Set(["a"]),
      }),
    );
    expect(items[0]!.tier).toBe("carry_forward");
  });

  it("flags a not-started WP past its 271 baseline finish as behind_schedule", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [wp({ id: "a", code: "A-1", baselineFinish: "2026-07-01" })],
      }),
    );
    expect(items[0]).toMatchObject({ tier: "behind_schedule" });
    expect(items[0]!.reason).toContain("ช้ากว่าแผน");
  });

  it("treats a baseline due on the plan date as behind_schedule (past/near)", () => {
    const items = recommendTomorrowBoard(
      baseInput({ workPackages: [wp({ id: "a", code: "A-1", baselineFinish: PLAN_DATE })] }),
    );
    expect(items[0]!.tier).toBe("behind_schedule");
  });

  it("does NOT flag a WP whose baseline finishes after the plan date", () => {
    const items = recommendTomorrowBoard(
      baseInput({ workPackages: [wp({ id: "a", code: "A-1", baselineFinish: "2026-07-31" })] }),
    );
    expect(items[0]!.tier).toBe("priority");
  });

  it("orders the behind_schedule tier most-overdue first", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [
          wp({ id: "b1", code: "B-1", baselineFinish: "2026-07-05" }),
          wp({ id: "b2", code: "B-2", baselineFinish: "2026-07-01" }),
        ],
      }),
    );
    expect(items.map((i) => i.workPackageId)).toEqual(["b2", "b1"]);
  });

  it("drops the behind_schedule tier when baselines are unbound (degrades to priority)", () => {
    const items = recommendTomorrowBoard(
      baseInput({ workPackages: [wp({ id: "a", code: "A-1", baselineFinish: null })] }),
    );
    expect(items[0]!.tier).toBe("priority");
    expect(items[0]!.reason).toContain("ลำดับความสำคัญ");
  });

  it("ranks the priority tier by the shared worklist priority rank (critical before normal)", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [
          wp({ id: "n", code: "P-1", priority: "normal" }),
          wp({ id: "c", code: "P-2", priority: "critical" }),
        ],
      }),
    );
    expect(items.map((i) => i.workPackageId)).toEqual(["c", "n"]);
  });

  it("places a WP at its highest-qualifying tier (started + behind → carry_forward)", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [
          wp({ id: "a", code: "A-1", status: "in_progress", baselineFinish: "2026-07-01" }),
        ],
      }),
    );
    expect(items[0]!.tier).toBe("carry_forward");
  });

  it("excludes งาน groups and complete leaves", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [
          wp({ id: "g", code: "G", isGroup: true }),
          wp({ id: "done", code: "D-1", status: "complete" }),
          wp({ id: "leaf", code: "L-1", status: "in_progress" }),
        ],
      }),
    );
    expect(items.map((i) => i.workPackageId)).toEqual(["leaf"]);
  });

  it("orders overall carry_forward block, then behind_schedule, then priority", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [
          wp({ id: "pr", code: "Z-1", status: "not_started" }),
          wp({ id: "bh", code: "Z-2", status: "not_started", baselineFinish: "2026-07-01" }),
          wp({ id: "cf", code: "Z-3", status: "in_progress" }),
        ],
      }),
    );
    expect(items.map((i) => i.tier)).toEqual(["carry_forward", "behind_schedule", "priority"]);
    expect(items.map((i) => i.workPackageId)).toEqual(["cf", "bh", "pr"]);
  });

  it("caps the draft at topN, ordered, leaving the rest out", () => {
    const wps = Array.from({ length: 8 }, (_, i) =>
      wp({ id: `w${i}`, code: `P-${i}`, priority: i === 0 ? "critical" : "normal" }),
    );
    const items = recommendTomorrowBoard(baseInput({ workPackages: wps, topN: 3 }));
    expect(items).toHaveLength(3);
    expect(items[0]!.workPackageId).toBe("w0"); // critical floats to the top
  });
});

describe("recommendTomorrowBoard — crew pre-assign", () => {
  const crewC1 = {
    id: "C1",
    name: "ทีมเอ",
    leadWorkerId: "w1",
    memberWorkerIds: ["w1", "w2"],
    categoryCodes: ["W01"],
  };
  const crewC2 = {
    id: "C2",
    name: "ทีมบี",
    leadWorkerId: "w3",
    memberWorkerIds: ["w3"],
    categoryCodes: ["W02"],
  };

  it("pre-assigns the recent-continuity crew, winning over a category match", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [wp({ id: "a", code: "A-1", status: "in_progress", categoryCode: "W02" })],
        crews: [crewC1, crewC2],
        recentCrewByWp: new Map([["a", "C1"]]),
      }),
    );
    expect(items[0]!.crew).toMatchObject({ crewId: "C1", crewName: "ทีมเอ" });
    expect(items[0]!.crew!.reason).toContain("ล่าสุด");
  });

  it("falls back to a spec-277 category-matched crew when no recent crew", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [wp({ id: "a", code: "A-1", status: "in_progress", categoryCode: "W02" })],
        crews: [crewC1, crewC2],
      }),
    );
    expect(items[0]!.crew).toMatchObject({ crewId: "C2" });
    expect(items[0]!.crew!.reason).toContain("หมวดงาน");
  });

  it("leaves the crew blank when neither recent nor category matches", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [wp({ id: "a", code: "A-1", status: "in_progress", categoryCode: "W09" })],
        crews: [crewC1, crewC2],
      }),
    );
    expect(items[0]!.crew).toBeNull();
  });

  it("carries workerIds = members ∪ lead (deduped) and the lead through for the 273 RPC", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [wp({ id: "a", code: "A-1", status: "in_progress" })],
        crews: [
          {
            id: "C1",
            name: "ทีมเอ",
            leadWorkerId: "w9",
            memberWorkerIds: ["w1"],
            categoryCodes: [],
          },
        ],
        recentCrewByWp: new Map([["a", "C1"]]),
      }),
    );
    expect(items[0]!.crew).toMatchObject({ workerIds: ["w1", "w9"], leadWorkerId: "w9" });
  });

  it("does not dupe the lead when it is already a member", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [wp({ id: "a", code: "A-1", status: "in_progress" })],
        crews: [crewC1],
        recentCrewByWp: new Map([["a", "C1"]]),
      }),
    );
    expect(items[0]!.crew!.workerIds).toEqual(["w1", "w2"]);
  });

  it("skips an empty crew (no members, no lead) and leaves the row blank", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [wp({ id: "a", code: "A-1", status: "in_progress", categoryCode: "W02" })],
        crews: [
          {
            id: "C0",
            name: "ว่าง",
            leadWorkerId: null,
            memberWorkerIds: [],
            categoryCodes: ["W02"],
          },
        ],
      }),
    );
    expect(items[0]!.crew).toBeNull();
  });

  it("ignores a recentCrewByWp pointing at a crew no longer visible, falling through", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [wp({ id: "a", code: "A-1", status: "in_progress", categoryCode: "W02" })],
        crews: [crewC2],
        recentCrewByWp: new Map([["a", "GONE"]]),
      }),
    );
    // recent crew GONE is not in the visible set → category-match C2.
    expect(items[0]!.crew).toMatchObject({ crewId: "C2" });
  });
});

describe("recommendTomorrowBoard — degradation", () => {
  it("returns priority-only, blank-crew rows when crews + history are empty", () => {
    const items = recommendTomorrowBoard(
      baseInput({
        workPackages: [
          wp({ id: "a", code: "A-1", status: "not_started" }),
          wp({ id: "b", code: "A-2", status: "not_started" }),
        ],
      }),
    );
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.tier === "priority")).toBe(true);
    expect(items.every((i) => i.crew === null)).toBe(true);
  });

  it("returns an empty draft when there are no candidate งานย่อย", () => {
    expect(recommendTomorrowBoard(baseInput())).toEqual([]);
  });
});
