// Spec 271 U2a §3 — derived per-leaf actual anchors. Never stored on the row;
// recomputed from evidence each read (variance_snapshots freeze weekly copies
// for tamper visibility — U1). Reuses the shared supersede-aware photo
// primitives (spec 256) so this cannot drift from the schedule surfaces.
//
// actual_end (D7): the submit-time anchor needs the U3 status-transition audit
// rows; until they exist this reads the approval record's decided_at — the
// documented pre-U3 fallback (§3: on scored projects U3 ships before work
// starts, so the fallback only ever affects calibration/display data). The
// input seam is the approvals rows, so U3 swaps the feed, not this lib.

import {
  currentPhotoRows,
  photoBangkokDate,
  type ActivityPhotoRow,
} from "@/lib/work-packages/photo-evidence";
import { bangkokDateOf } from "@/lib/dates";

export interface ActualsPhotoRow extends ActivityPhotoRow {
  phase: string;
}
export interface ActualsLaborRow {
  work_package_id: string;
  /** date (yyyy-mm-dd) */
  work_date: string;
  created_at: string;
}
export interface ActualsApprovalRow {
  work_package_id: string;
  decision: string;
  decided_at: string | null;
}

export interface LeafActuals {
  actualStart: string | null;
  actualEnd: string | null;
  hasEvidence: boolean;
}

/** §3 anti-forgery: labor anchors only when entered ≤ 3 days after the work
 *  date — late/backdated entry stays legal for payroll but can't move the metric. */
export const LABOR_ENTRY_LAG_DAYS = 3;

const START_PHOTO_PHASES = new Set(["during", "after", "after_fix"]);

function laborLagDays(row: ActualsLaborRow): number | null {
  const entered = bangkokDateOf(row.created_at);
  if (entered === null) return null;
  return Math.round(
    (Date.parse(`${entered}T00:00:00Z`) - Date.parse(`${row.work_date}T00:00:00Z`)) / 86_400_000,
  );
}

export function deriveActuals(input: {
  photos: ReadonlyArray<ActualsPhotoRow>;
  labor: ReadonlyArray<ActualsLaborRow>;
  approvals: ReadonlyArray<ActualsApprovalRow>;
}): Map<string, LeafActuals> {
  const out = new Map<string, LeafActuals>();
  const at = (wp: string): LeafActuals => {
    let cur = out.get(wp);
    if (!cur) {
      cur = { actualStart: null, actualEnd: null, hasEvidence: false };
      out.set(wp, cur);
    }
    return cur;
  };
  const minStart = (wp: string, day: string | null) => {
    if (day === null) return;
    const a = at(wp);
    if (a.actualStart === null || day < a.actualStart) a.actualStart = day;
  };

  // Photos: any CURRENT photo is evidence; during/after/after_fix anchor a start.
  for (const p of currentPhotoRows(input.photos)) {
    const a = at(p.work_package_id);
    a.hasEvidence = true;
    if (START_PHOTO_PHASES.has(p.phase)) minStart(p.work_package_id, photoBangkokDate(p));
  }

  // Labor: evidence always; an anchor only within the entry-lag bound.
  for (const l of input.labor) {
    const a = at(l.work_package_id);
    a.hasEvidence = true;
    const lag = laborLagDays(l);
    if (lag !== null && lag <= LABOR_ENTRY_LAG_DAYS) minStart(l.work_package_id, l.work_date);
  }

  // Approvals: evidence; the latest APPROVED decision date is the (fallback)
  // completion anchor.
  for (const ap of input.approvals) {
    const a = at(ap.work_package_id);
    a.hasEvidence = true;
    if (ap.decision !== "approved" || ap.decided_at === null) continue;
    const day = bangkokDateOf(ap.decided_at);
    if (day !== null && (a.actualEnd === null || day > a.actualEnd)) a.actualEnd = day;
  }

  // §3: start coalesces to end so it is non-null whenever completed.
  for (const a of out.values()) {
    if (a.actualStart === null && a.actualEnd !== null) a.actualStart = a.actualEnd;
  }
  return out;
}
