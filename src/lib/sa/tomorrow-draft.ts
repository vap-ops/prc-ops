// Spec 281 U2 — the /sa/plan page-integration assembler. Turns the raw board reads
// (WP rows + the category/baseline resolution maps + the roster crews + recent 273
// board history) into the U1 engine's RecommendInput and returns the DraftItem[].
// Pure over already-fetched rows (the page owns the RLS-scoped reads); it only
// derives the two board-history signals the engine needs — the recent-continuity
// crew per งาน and each crew's spec-277 categories (from what งาน it has run) —
// then delegates the scoring to recommendTomorrowBoard (§7.1: pre-assign leans on
// this thin board history until the attendance loop fills).

import type { WorkPackageStatus, WorkPackagePriority } from "@/lib/db/enums";
import {
  recommendTomorrowBoard,
  type DraftItem,
  type RecommenderCrew,
  type RecommenderWp,
} from "@/lib/sa/recommend-board";

export interface DraftWpRow {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  is_group: boolean;
  priority: WorkPackagePriority;
  /** project_categories id (spec 207), or null when uncategorised. */
  category_id: string | null;
}

export interface DraftCrewRow {
  id: string;
  name: string;
  lead_worker_id: string | null;
}

export interface DraftCrewMemberRow {
  crew_id: string;
  worker_id: string;
}

/** A recent board's item — the page passes these ordered NEWEST-first so the
 *  most-recent crew wins per งาน. */
export interface DraftPlanItemRow {
  id: string;
  work_package_id: string;
}

export interface DraftPlanCrewRow {
  item_id: string;
  worker_id: string;
}

export interface BuildTomorrowDraftInput {
  /** The date the board is drafted FOR (tomorrow), ISO. */
  planDate: string;
  workPackages: ReadonlyArray<DraftWpRow>;
  /** project_category_id → reconciled GLOBAL work-category code (W0x). */
  categoryCodeById: ReadonlyMap<string, string>;
  /** wpId → spec-271 baseline planned-finish (ISO), for the behind-schedule tier. */
  baselineFinishByWp: ReadonlyMap<string, string>;
  crews: ReadonlyArray<DraftCrewRow>;
  crewMembers: ReadonlyArray<DraftCrewMemberRow>;
  /** Items across recent boards, NEWEST-first. */
  recentPlanItems: ReadonlyArray<DraftPlanItemRow>;
  recentPlanCrew: ReadonlyArray<DraftPlanCrewRow>;
  topN?: number;
}

export function buildTomorrowDraft(input: BuildTomorrowDraftInput): DraftItem[] {
  const {
    planDate,
    workPackages,
    categoryCodeById,
    baselineFinishByWp,
    crews,
    crewMembers,
    recentPlanItems,
    recentPlanCrew,
  } = input;

  const categoryOf = (categoryId: string | null): string | null =>
    (categoryId && categoryCodeById.get(categoryId)) || null;

  // worker → crew. crew_members is the SSOT; a lead who has no member row still
  // belongs to their crew (mirrors buildCrewTeams' roster = members ∪ lead).
  const crewByWorker = new Map<string, string>();
  for (const m of crewMembers) crewByWorker.set(m.worker_id, m.crew_id);
  for (const c of crews) {
    if (c.lead_worker_id && !crewByWorker.has(c.lead_worker_id)) {
      crewByWorker.set(c.lead_worker_id, c.id);
    }
  }

  // Group recent board crew rows by their item.
  const workersByItem = new Map<string, string[]>();
  for (const pc of recentPlanCrew) {
    const list = workersByItem.get(pc.item_id) ?? [];
    list.push(pc.worker_id);
    workersByItem.set(pc.item_id, list);
  }

  const categoryCodeByWp = new Map<string, string | null>();
  for (const w of workPackages) categoryCodeByWp.set(w.id, categoryOf(w.category_id));

  // Walk recent items (newest-first) → derive the recent-continuity crew per งาน
  // and accumulate each crew's spec-277 categories from what it has run.
  const recentBoardWpIds = new Set<string>();
  const recentCrewByWp = new Map<string, string>();
  const categoriesByCrew = new Map<string, Set<string>>();
  const addCrewCategory = (crewId: string, code: string | null) => {
    if (!code) return;
    const set = categoriesByCrew.get(crewId) ?? new Set<string>();
    set.add(code);
    categoriesByCrew.set(crewId, set);
  };

  for (const item of recentPlanItems) {
    recentBoardWpIds.add(item.work_package_id);
    const code = categoryCodeByWp.get(item.work_package_id) ?? null;
    const crewIdsOnItem = new Set<string>();
    for (const workerId of workersByItem.get(item.id) ?? []) {
      const crewId = crewByWorker.get(workerId);
      if (crewId) crewIdsOnItem.add(crewId);
    }
    // Recent crew for this งาน = the first crew seen on the newest board (newest
    // wins: only set if not already resolved from a more-recent item).
    for (const crewId of crewIdsOnItem) {
      if (!recentCrewByWp.has(item.work_package_id)) {
        recentCrewByWp.set(item.work_package_id, crewId);
      }
      addCrewCategory(crewId, code);
    }
  }

  const membersByCrew = new Map<string, string[]>();
  for (const m of crewMembers) {
    const list = membersByCrew.get(m.crew_id) ?? [];
    list.push(m.worker_id);
    membersByCrew.set(m.crew_id, list);
  }

  const recommenderCrews: RecommenderCrew[] = crews.map((c) => ({
    id: c.id,
    name: c.name,
    leadWorkerId: c.lead_worker_id,
    memberWorkerIds: membersByCrew.get(c.id) ?? [],
    categoryCodes: [...(categoriesByCrew.get(c.id) ?? [])],
  }));

  const recommenderWps: RecommenderWp[] = workPackages.map((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    status: w.status,
    isGroup: w.is_group,
    priority: w.priority,
    categoryCode: categoryCodeByWp.get(w.id) ?? null,
    baselineFinish: baselineFinishByWp.get(w.id) ?? null,
  }));

  return recommendTomorrowBoard({
    workPackages: recommenderWps,
    crews: recommenderCrews,
    recentBoardWpIds,
    recentCrewByWp,
    planDate,
    ...(input.topN !== undefined ? { topN: input.topN } : {}),
  });
}
