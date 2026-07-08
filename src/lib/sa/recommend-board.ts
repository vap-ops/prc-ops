// Spec 281 U1 (extends ADR 0076) — แนะนำแผนพรุ่งนี้: the heuristic recommender
// engine. A pure, deterministic function over already-fetched rows that proposes
// tomorrow's แผนพรุ่งนี้ board as a DraftItem[] — which not-done งานย่อย to plan +
// a suggested crew for each, every one carrying a plain Thai reason. The page
// (U2) fetches + derives the inputs and one-taps the accepted rows into the
// existing spec-273 write RPCs; nothing here writes anything (D5).
//
// The scoring is tiered (§3): every not-done leaf lands at its HIGHEST-qualifying
// tier, tiers are ordered highest-rank first, and the draft is the top-N.
//   1. ต่อจากวันนี้  (carry_forward)  — started but not done (D3 aggressive).
//   2. ช้ากว่าแผน   (behind_schedule) — past/near its spec-271 baseline finish.
//   3. ลำดับความสำคัญ (priority)       — the rest, by the shared worklist rank.
// Every tier degrades gracefully: no baselines → the behind tier is simply empty;
// no crews/board history → blank crews (§7). Phase-2 swaps this scorer for an LLM
// behind the same DraftItem[] contract.

import type { WorkPackageStatus, WorkPackagePriority } from "@/lib/db/enums";
import { rankFromPriority } from "@/lib/work-packages/action-bands";

export type DraftTier = "carry_forward" | "behind_schedule" | "priority";

/** Ordered highest default rank first — the overall draft is tiers concatenated. */
export const DRAFT_TIER_ORDER: readonly DraftTier[] = [
  "carry_forward",
  "behind_schedule",
  "priority",
];

export const TIER_REASON: Record<DraftTier, string> = {
  carry_forward: "ต่อจากวันนี้ — ยังไม่เสร็จ",
  behind_schedule: "ช้ากว่าแผน",
  priority: "ลำดับความสำคัญ",
};

export const CREW_REASON = {
  recent: "ทีมที่ทำงานนี้ล่าสุด",
  category: "ทีมตรงหมวดงาน",
} as const;

/** Only `complete` is a done/closed terminal — matches the /sa/plan picker's
 *  `status !== "complete"` not-done rule, so the draft and the picker agree. */
const DONE_STATUSES: ReadonlySet<WorkPackageStatus> = new Set(["complete"]);

/** Statuses that count as "started" on their own (in addition to having been on a
 *  recent board): active work the crew should keep going. rework = a reopened WP
 *  back in the site team's hands, so it reads as in-progress here. */
const STARTED_STATUSES: ReadonlySet<WorkPackageStatus> = new Set(["in_progress", "rework"]);

const DEFAULT_TOP_N = 12;

export interface RecommenderWp {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  isGroup: boolean;
  priority: WorkPackagePriority;
  /** Reconciled GLOBAL work-category code (spec 277), or null if uncategorised. */
  categoryCode: string | null;
  /** The spec-271 baseline planned-finish (ISO date), or null when unbound. */
  baselineFinish: string | null;
}

export interface RecommenderCrew {
  id: string;
  name: string;
  leadWorkerId: string | null;
  memberWorkerIds: string[];
  /** Work-category codes this crew is associated with (page-derived, spec 277). */
  categoryCodes: string[];
}

/** A suggested crew for a งาน, resolved to the worker ids the 273 RPC needs. */
export interface DraftCrew {
  crewId: string;
  crewName: string;
  /** members ∪ lead, deduped — the p_worker_ids for set_daily_plan_item_crew. */
  workerIds: string[];
  leadWorkerId: string | null;
  reason: string;
}

export interface DraftItem {
  workPackageId: string;
  code: string;
  name: string;
  tier: DraftTier;
  reason: string;
  /** The pre-assigned crew, or null when nothing matched (the SA picks). */
  crew: DraftCrew | null;
}

export interface RecommendInput {
  workPackages: ReadonlyArray<RecommenderWp>;
  crews: ReadonlyArray<RecommenderCrew>;
  /** WP ids that appeared on any recent แผนพรุ่งนี้ board — the D3 "started" signal. */
  recentBoardWpIds: ReadonlySet<string>;
  /** Most-recent crew that ran each WP (page-derived continuity): wpId → crewId. */
  recentCrewByWp: ReadonlyMap<string, string>;
  /** The date the board is being drafted FOR (tomorrow), ISO. Behind = finish ≤ this. */
  planDate: string;
  /** Cap on the pre-checked draft; the rest stay addable via the picker. */
  topN?: number;
}

function isNotDoneLeaf(w: RecommenderWp): boolean {
  return !w.isGroup && !DONE_STATUSES.has(w.status);
}

function classifyTier(
  w: RecommenderWp,
  recentBoardWpIds: ReadonlySet<string>,
  planDate: string,
): DraftTier {
  const started = STARTED_STATUSES.has(w.status) || recentBoardWpIds.has(w.id);
  if (started) return "carry_forward";
  if (w.baselineFinish !== null && w.baselineFinish <= planDate) return "behind_schedule";
  return "priority";
}

/** The within-tier comparator. behind_schedule leads with most-overdue; the others
 *  lead with the shared worklist priority rank. Ties break on code for stability. */
function compareInTier(tier: DraftTier, a: RecommenderWp, b: RecommenderWp): number {
  if (tier === "behind_schedule") {
    // Nulls can't reach this tier, but guard for total-order safety.
    const fa = a.baselineFinish ?? "";
    const fb = b.baselineFinish ?? "";
    if (fa !== fb) return fa < fb ? -1 : 1; // earlier finish = more overdue = first
  }
  const ra = rankFromPriority(a.priority);
  const rb = rankFromPriority(b.priority);
  if (ra !== rb) return rb - ra; // higher rank first
  return a.code.localeCompare(b.code);
}

function pickCrew(
  w: RecommenderWp,
  crews: ReadonlyArray<RecommenderCrew>,
  recentCrewByWp: ReadonlyMap<string, string>,
): DraftCrew | null {
  const toDraft = (crew: RecommenderCrew, reason: string): DraftCrew | null => {
    const workerIds = [...crew.memberWorkerIds];
    if (crew.leadWorkerId && !workerIds.includes(crew.leadWorkerId)) {
      workerIds.push(crew.leadWorkerId);
    }
    if (workerIds.length === 0) return null; // an empty crew is no suggestion
    return {
      crewId: crew.id,
      crewName: crew.name,
      workerIds,
      leadWorkerId: crew.leadWorkerId,
      reason,
    };
  };

  // 1. recent-continuity: the crew that ran this งาน on a recent board.
  const recentCrewId = recentCrewByWp.get(w.id);
  if (recentCrewId) {
    const crew = crews.find((c) => c.id === recentCrewId);
    if (crew) {
      const draft = toDraft(crew, CREW_REASON.recent);
      if (draft) return draft;
    }
  }
  // 2. spec-277 category-match: the first crew whose category covers the งาน.
  if (w.categoryCode !== null) {
    const crew = crews.find((c) => c.categoryCodes.includes(w.categoryCode!));
    if (crew) {
      const draft = toDraft(crew, CREW_REASON.category);
      if (draft) return draft;
    }
  }
  // 3. blank — the SA picks.
  return null;
}

/**
 * Draft tomorrow's แผนพรุ่งนี้ board. Pure over already-fetched rows; returns the
 * ordered top-N DraftItems (every one meant to render pre-checked, D4), each with
 * a suggested crew (or null) and a plain Thai reason.
 */
export function recommendTomorrowBoard(input: RecommendInput): DraftItem[] {
  const { workPackages, crews, recentBoardWpIds, recentCrewByWp, planDate } = input;
  const topN = input.topN ?? DEFAULT_TOP_N;

  const candidates = workPackages.filter(isNotDoneLeaf);

  // Bucket each candidate at its highest-qualifying tier, then order within.
  const byTier = new Map<DraftTier, RecommenderWp[]>();
  for (const w of candidates) {
    const tier = classifyTier(w, recentBoardWpIds, planDate);
    const bucket = byTier.get(tier) ?? [];
    bucket.push(w);
    byTier.set(tier, bucket);
  }

  const ordered: Array<{ wp: RecommenderWp; tier: DraftTier }> = [];
  for (const tier of DRAFT_TIER_ORDER) {
    const bucket = byTier.get(tier);
    if (!bucket) continue;
    bucket.sort((a, b) => compareInTier(tier, a, b));
    for (const wp of bucket) ordered.push({ wp, tier });
  }

  return ordered.slice(0, topN).map(({ wp, tier }) => ({
    workPackageId: wp.id,
    code: wp.code,
    name: wp.name,
    tier,
    reason: TIER_REASON[tier],
    crew: pickCrew(wp, crews, recentCrewByWp),
  }));
}
