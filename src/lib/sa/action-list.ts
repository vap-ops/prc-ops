// Spec 218 — the SA "ต้องแก้ไข" classifier. A WP can land back on the SA's plate
// three ways; this splits the SA's worklist into those action items vs the rest:
//   • rework      — a complete WP reopened for a defect (status='rework', spec 144/216/217).
//   • revision    — the PM said ให้แก้ไข (needs_revision); WP stays pending_approval.
//   • rejected    — the PM said ไม่อนุมัติ; WP stays pending_approval.
// Pure (no fetch) so it's unit-testable; the /sa page supplies the rows.

import type { ApprovalRevisionReason, ReworkSource } from "@/lib/db/enums";
import {
  buildMyWorkList,
  type MyWorkWp,
  type MyWorkItem,
  type MovementInput,
} from "@/lib/sa/my-work";
// Type-only — erased at compile time, so this does not pull the client
// component's "use client" directive into this pure/server-safe module.
import type { CameraFabWp } from "@/components/features/sa/camera-fab";

export type SaActionKind = "rework" | "revision" | "rejected";

export interface SaActionItem {
  id: string;
  code: string;
  name: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  kind: SaActionKind;
  /** rework: the defect reason; revision/rejected: the PM's comment. */
  reason: string | null;
  /** rework only — who called it (ตรวจภายใน/ลูกค้าแจ้ง). */
  source: ReworkSource | null;
  /** rework only — the cycle (≥1). */
  round: number | null;
  /** revision only — WHY the photos came back (spec 355); null on historical rows. */
  revisionReason: ApprovalRevisionReason | null;
  /**
   * Spec 384 U1 — WHEN this landed back on the SA, which is what the stale band
   * and the within-group order read. `approvals.decided_at` for a bounce, the
   * `wp_reopened_for_defect` audit row's `created_at` for rework. null when the
   * rework row has no reopen audit row: that age is UNKNOWN, and unknown is not
   * old — it sorts last and is never banded stale.
   */
  sinceIso: string | null;
}

export interface BouncedWp {
  wp: MyWorkWp;
  decision: "needs_revision" | "rejected";
  comment: string | null;
  /** Spec 355 — the structured reject-evidence reason (needs_revision only). */
  revisionReason: ApprovalRevisionReason | null;
  /**
   * Spec 337 U2a — the SA has already pressed ส่งตรวจอีกครั้ง for THIS decision,
   * so the ball is back with the decider and the item leaves the SA's list. The
   * WP stays `pending_approval` the whole time, so status cannot tell us; the
   * fact lives in the `wp_evidence_resubmitted` audit row. Required (not
   * optional-defaulting-false) so a caller that forgets it fails typecheck
   * rather than silently pinning items to the list forever.
   */
  answered: boolean;
  /** Spec 384 U1 — `approvals.decided_at` of THIS decision. Already fetched by
   *  `getLatestDecisionsForWorkPackages`; required so a caller that forgets it
   *  fails typecheck instead of silently flattening every row's age to null. */
  decidedAt: string;
}

/**
 * Spec 372 U3 — which statuses can hold a bounce the SA still owes.
 *
 * `pending_approval` is where the two PHOTO causes leave the WP. `in_progress` is
 * where a `premature` bounce sends it: the work is genuinely unfinished, so it goes
 * back to the site as ordinary active work. `rework` is deliberately excluded — it
 * has its own lane carrying the round and the defect reason.
 *
 * A predicate rather than an inline filter because the inline form could be narrowed
 * back to pending-only with every source-scan still green (mutation-checked), which
 * would silently delete the PM's reason from the SA's lane.
 */
export function isBounceableStatus(status: string): boolean {
  return status === "pending_approval" || status === "in_progress";
}

/**
 * Spec 372 U3 — is a bounced WP still the SA's move?
 *
 * The two PHOTO causes never move the WP: it sits at `pending_approval` the whole
 * time, so only a `wp_evidence_resubmitted` audit row can say the SA acted. That is
 * the `hasResubmitAudit` rule, unchanged.
 *
 * `premature` is different in both directions. The WP LEAVES the queue for
 * `in_progress`, and the SA closes the loop with the ordinary ส่งงานเข้าตรวจ submit —
 * which writes no resubmit audit row at all. Keying it on the audit row would pin it
 * to the SA's list forever; keying it on the STATUS is exact: unfinished work sits at
 * `in_progress`, and the moment it is back at `pending_approval` the ball is with the
 * PM again.
 *
 * Without this the premature bounce would simply vanish from the ต้องแก้ไข lane along
 * with the PM's reason, and the SA would see an ordinary in-progress WP with no idea
 * it had come back.
 */
export function bounceAnswered(input: {
  decision: "needs_revision" | "rejected";
  revisionReason: ApprovalRevisionReason | null;
  status: string;
  hasResubmitAudit: boolean;
}): boolean {
  if (input.decision === "needs_revision" && input.revisionReason === "premature") {
    return input.status === "pending_approval";
  }
  return input.hasResubmitAudit;
}

export interface ReworkInfo {
  reason: string | null;
  source: ReworkSource | null;
  round: number;
  /** Spec 384 U1 — `created_at` of the latest `wp_reopened_for_defect` row, or
   *  null when the WP is in rework with no reopen audit row to date it. */
  since: string | null;
}

// Most-severe first: a hard rejection, then a reopened defect, then a revision ask.
const KIND_ORDER: Record<SaActionKind, number> = { rejected: 0, rework: 1, revision: 2 };

export function buildSaActionList(input: {
  /** Visible WPs not in (complete, pending_approval) — includes rework. */
  inPlay: ReadonlyArray<MyWorkWp>;
  /** pending_approval WPs whose latest decision is negative. */
  bounced: ReadonlyArray<BouncedWp>;
  /** wpId → reopen context (spec 216/217), for the rework rows. */
  reworkInfo: ReadonlyMap<string, ReworkInfo>;
  projectsById: ReadonlyMap<string, { code: string; name: string }>;
  /** Spec 277 — project_category id → GLOBAL work-category code (W0x), for the
   *  "งานของฉัน" (rest) cards. Omitted → cards render uncategorised. */
  categoryCodeById?: ReadonlyMap<string, string>;
  /** Spec 375 U1 — orders `rest` by movement instead of the alphabet. Omitted →
   *  the legacy project/code order, nothing marked cold. Only `rest` is affected:
   *  `actions` stay severity-ordered, because a bounce is the SA's move whether
   *  or not the WP has been photographed lately. */
  movement?: MovementInput;
}): { actions: SaActionItem[]; rest: MyWorkItem[] } {
  const { inPlay, bounced, reworkInfo, projectsById, categoryCodeById, movement } = input;

  const project = (id: string) => projectsById.get(id);

  const reworkActions: SaActionItem[] = inPlay
    .filter((w) => w.status === "rework")
    .map((w) => {
      const info = reworkInfo.get(w.id);
      return {
        id: w.id,
        code: w.code,
        name: w.name,
        projectId: w.project_id,
        projectCode: project(w.project_id)?.code ?? "",
        projectName: project(w.project_id)?.name ?? "—",
        kind: "rework" as const,
        reason: info?.reason ?? null,
        source: info?.source ?? null,
        round: info && info.round >= 1 ? info.round : null,
        revisionReason: null,
        sinceIso: info?.since ?? null,
      };
    });

  // Spec 337 U2a: an answered bounce is waiting on the DECIDER, not the SA.
  const bouncedActions: SaActionItem[] = bounced
    .filter((b) => !b.answered)
    .map((b) => ({
      id: b.wp.id,
      code: b.wp.code,
      name: b.wp.name,
      projectId: b.wp.project_id,
      projectCode: project(b.wp.project_id)?.code ?? "",
      projectName: project(b.wp.project_id)?.name ?? "—",
      kind: b.decision === "rejected" ? "rejected" : "revision",
      reason: b.comment,
      source: null,
      round: null,
      // The DB CHECK forbids a reason outside needs_revision, so rejected rows
      // arrive null already; thread rather than re-derive.
      revisionReason: b.revisionReason,
      sinceIso: b.decidedAt,
    }));

  const actions = [...reworkActions, ...bouncedActions].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.projectCode.localeCompare(b.projectCode) ||
      a.code.localeCompare(b.code),
  );

  // The rest of the daily worklist: in-play WPs that aren't rework.
  const rest = buildMyWorkList(
    inPlay.filter((w) => w.status !== "rework"),
    projectsById,
    categoryCodeById,
    movement,
  );

  return { actions, rest };
}

/**
 * Spec 384 U2 — the camera FAB's candidate list.
 *
 * `captureWps = rest` made the FAB's picker the exact COMPLEMENT of `actions`:
 * `rest` is `inPlay` minus rework minus (upstream) every pending_approval WP,
 * so a rework row or a pending_approval bounce — precisely the WPs the
 * ต้องแก้ไข section is asking for a photo on — could never be reached from the
 * SA's most-used control. Union both sets instead, deduped by id (a
 * `premature` bounce sits at `in_progress`, spec 372 U3, so it is already in
 * BOTH `actions` and `rest` today — the FAB must offer it once, not twice).
 */
export function buildCaptureWps(
  actions: ReadonlyArray<SaActionItem>,
  rest: ReadonlyArray<MyWorkItem>,
): CameraFabWp[] {
  const seen = new Set<string>();
  const out: CameraFabWp[] = [];
  for (const it of [...actions, ...rest]) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push({ id: it.id, projectId: it.projectId, code: it.code, name: it.name });
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Spec 384 U1 — the sweep, not the trickle.
 *
 * `SaActionSection` was built for 1–3 items ("pinned above งานของฉัน, each row
 * self-explaining"). The PM reviews in BATCHES — 16 on 07-21, 12 on 07-27, 13 on
 * 07-28 — so the SA receives a dozen-plus bounces at once, most carrying the same
 * reason and the same next action, and the surface renders a dozen-plus identical
 * self-explaining cards (~6,000px above the muster strip, the plan and the tools).
 *
 * Splitting it needs exactly two facts about each row: is it OLD, and what is it
 * asking for. Everything else about the card is unchanged (spec 355 got it right).
 * ------------------------------------------------------------------------- */

/**
 * A row older than this is banded out of its reason group and always shown.
 *
 * DERIVED, not chosen. Open-bounce ages are bimodal — a sweep clears inside its
 * own review cycle or not at all — so the cut goes in the empty interval between
 * the modes. Measured 2026-07-31 in ELAPSED days: 29 rows below 4.0, 7 above 6.0,
 * and NOTHING between, so 5 sits dead centre with a full day of slack either side.
 *
 * ⚠️ The unit is ELAPSED time (`now() - decided_at`), NOT calendar-date
 * subtraction. The first draft of this constant was 3, derived from a
 * `now()::date - decided_at::date` histogram whose "1–3 day" mode is really
 * elapsed [0, 4) — so a 3-day cut sliced that mode by time of day and the band
 * came out 18 of 36 rows instead of 7. Caught by rendering the real page, not by
 * the suite. Spec 384 §6 ③ re-runs the ELAPSED query as acceptance: if the empty
 * interval closes, this constant is wrong.
 */
export const STALE_ACTION_DAYS = 5;

/** ISO cutoff for `groupSaActions`, `days` before `nowMs`. Pure. */
export function staleCutoffIso(nowMs: number, days: number = STALE_ACTION_DAYS): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The same cutoff against the current clock. Separate from `staleCutoffIso` so the
 * grouping stays a pure, testable function of an injected cutoff while the caller
 * keeps the clock read OUT of its render body — the React Compiler lint rejects an
 * impure call there ("Cannot call impure function during render"). Same split as
 * `coldCutoffFromNow` (spec 375 U1).
 */
export function staleCutoffFromNow(days: number = STALE_ACTION_DAYS): string {
  return staleCutoffIso(Date.now(), days);
}

/**
 * What a group of rows is asking the SA for. A reasoned bounce keys on its REASON,
 * because that is what makes a sweep homogeneous; everything else keys on its kind.
 *
 * Built by a switch over `SaActionKind` with NO default arm, so adding a kind is a
 * compile error rather than a row that renders into no group at all.
 */
export type SaActionGroupKey =
  | `revision:${ApprovalRevisionReason}`
  | "revision"
  | "rejected"
  | "rework";

export interface SaActionGroup {
  key: SaActionGroupKey;
  /** Oldest first; rows with an unknown age last. */
  items: SaActionItem[];
}

export function saActionGroupKey(item: SaActionItem): SaActionGroupKey {
  switch (item.kind) {
    case "rejected":
      return "rejected";
    case "rework":
      return "rework";
    case "revision":
      // `approvals_revision_reason_forbidden_unless_needs_revision` only FORBIDS a
      // reason outside needs_revision — it does not REQUIRE one, so a reasonless
      // bounce is still writable and needs a group of its own rather than a
      // lookup that misses. 7 such rows are live today.
      return item.revisionReason ? `revision:${item.revisionReason}` : "revision";
  }
}

/** The kind a group key came from, for the severity ordering below. */
function kindOfGroup(key: SaActionGroupKey): SaActionKind {
  if (key === "rejected" || key === "rework") return key;
  return "revision";
}

/** Epoch ms, or null when the row carries no USABLE age. */
function sinceMs(item: SaActionItem): number | null {
  // Parse, never string-compare: `sinceIso` comes from PostgREST (`…+00:00`) and
  // the cutoff from `toISOString()` (`…Z`), and `"+" < "Z"` bytewise — so a
  // lexicographic compare is only accidentally right and wrong at the boundary
  // (spec 375 U1's second defect).
  if (item.sinceIso === null) return null;
  const ms = Date.parse(item.sinceIso);
  // An unparseable timestamp collapses to UNKNOWN rather than leaking NaN into
  // the comparator: `NaN - x` is NaN, and a comparator that returns NaN gives an
  // implementation-defined order — a whole group could silently shuffle. Unknown
  // is the honest reading anyway, and unknown is never banded stale.
  return Number.isNaN(ms) ? null : ms;
}

/** Oldest first, unknown ages last, then the legacy project/code tie-break. */
function byAgeThenCode(a: SaActionItem, b: SaActionItem): number {
  const am = sinceMs(a);
  const bm = sinceMs(b);
  if (am !== bm) {
    if (am === null) return 1;
    if (bm === null) return -1;
    return am - bm;
  }
  return a.projectCode.localeCompare(b.projectCode) || a.code.localeCompare(b.code);
}

/**
 * Split the ต้องแก้ไข list into the band that is always shown and the groups the
 * surface may collapse.
 *
 * The band is a claim about the rows near it, so the split is total and exclusive:
 * every item lands in exactly one of `stale` / one group, and CONTIGUITY holds —
 * nothing inside a group is older than `staleBeforeIso`. Note the group rows carry
 * no age of their own on purpose: a non-stale group is ≤ STALE_ACTION_DAYS old by
 * construction, so "เก่าสุด N วัน" there would always read 1, 2 or 3 and carry no
 * decision — and printing it would drag a clock read into the render.
 */
export function groupSaActions(input: {
  items: ReadonlyArray<SaActionItem>;
  staleBeforeIso: string;
}): { stale: SaActionItem[]; groups: SaActionGroup[] } {
  const { items, staleBeforeIso } = input;
  const staleBeforeMs = Date.parse(staleBeforeIso);

  const stale: SaActionItem[] = [];
  const byKey = new Map<SaActionGroupKey, SaActionItem[]>();

  for (const item of items) {
    const ms = sinceMs(item);
    // `ms === null` → unknown age. Unknown is NOT old: a rework row with no
    // reopen audit row must not be asserted to have been waiting ten days.
    if (ms !== null && ms < staleBeforeMs) {
      stale.push(item);
      continue;
    }
    const key = saActionGroupKey(item);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else byKey.set(key, [item]);
  }

  stale.sort(byAgeThenCode);

  const groups: SaActionGroup[] = [...byKey.entries()]
    .map(([key, groupItems]) => ({ key, items: [...groupItems].sort(byAgeThenCode) }))
    .sort((a, b) => {
      // Severity first — a rejection outranks a reopened defect outranks a
      // revision ask, exactly as the flat list ordered them.
      const severity = KIND_ORDER[kindOfGroup(a.key)] - KIND_ORDER[kindOfGroup(b.key)];
      if (severity !== 0) return severity;
      // Then the group holding the oldest row. Both are sorted, so element 0 is
      // each group's oldest; a group whose every row has an unknown age goes last.
      const am = a.items[0] ? sinceMs(a.items[0]) : null;
      const bm = b.items[0] ? sinceMs(b.items[0]) : null;
      if (am !== bm) {
        if (am === null) return 1;
        if (bm === null) return -1;
        return am - bm;
      }
      return a.key.localeCompare(b.key);
    });

  return { stale, groups };
}
