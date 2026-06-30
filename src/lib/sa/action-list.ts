// Spec 218 — the SA "ต้องแก้ไข" classifier. A WP can land back on the SA's plate
// three ways; this splits the SA's worklist into those action items vs the rest:
//   • rework      — a complete WP reopened for a defect (status='rework', spec 144/216/217).
//   • revision    — the PM said ให้แก้ไข (needs_revision); WP stays pending_approval.
//   • rejected    — the PM said ไม่อนุมัติ; WP stays pending_approval.
// Pure (no fetch) so it's unit-testable; the /sa page supplies the rows.

import type { ReworkSource } from "@/lib/db/enums";
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
}

export interface BouncedWp {
  wp: MyWorkWp;
  decision: "needs_revision" | "rejected";
  comment: string | null;
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
}): { actions: SaActionItem[]; rest: MyWorkItem[] } {
  const { inPlay, bounced, reworkInfo, projectsById } = input;

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
      };
    });

  const bouncedActions: SaActionItem[] = bounced.map((b) => ({
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
  );

  return { actions, rest };
}
