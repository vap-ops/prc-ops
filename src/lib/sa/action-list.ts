// Spec 218 — the SA "ต้องแก้ไข" classifier. A WP can land back on the SA's plate
// three ways; this splits the SA's worklist into those action items vs the rest:
//   • rework      — a complete WP reopened for a defect (status='rework', spec 144/216/217).
//   • revision    — the PM said ให้แก้ไข (needs_revision); WP stays pending_approval.
//   • rejected    — the PM said ไม่อนุมัติ; WP stays pending_approval.
// Pure (no fetch) so it's unit-testable; the /sa page supplies the rows.

import type { ApprovalRevisionReason, ReworkSource } from "@/lib/db/enums";
import { buildMyWorkList, type MyWorkWp, type MyWorkItem } from "@/lib/sa/my-work";

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
}

export interface ReworkInfo {
  reason: string | null;
  source: ReworkSource | null;
  round: number;
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
}): { actions: SaActionItem[]; rest: MyWorkItem[] } {
  const { inPlay, bounced, reworkInfo, projectsById, categoryCodeById } = input;

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
  );

  return { actions, rest };
}
