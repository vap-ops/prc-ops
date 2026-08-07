// Spec 400 U5 — the correction TRAIL's reader half.
//
// Six functions write a muster edit into `audit_log` under action `crew_change`,
// each with its own payload shape. `list_muster_day_audit` normalises them into
// one row type; this module turns one such row into the sentence a checker reads.
//
// PURE and exported per kind, for the reason U1 paid for: a source scan proves a
// branch exists, never that it is REACHABLE. Every arm below is driven directly
// by its own case in muster-day-audit.test.ts.
//
// ⚠️ No `default:` that returns nothing. A row that vanishes from an AUDIT trail
// is the one failure this surface must not have, so an unrecognised kind renders
// the raw kind — visibly wrong, and still a row. (The house rule about silent
// `default:` arms, applied where dropping is the worse half.)

import type { UserRole } from "@/lib/db/enums";
import { formatThaiTime } from "@/lib/i18n/labels";

/** Every payload `kind` the trail reports, and the only ones its RPC returns.
 *
 *  Derived, not recalled:
 *    grep -rho "'kind', '[a-z_]*'" supabase/migrations/ | sort -u | grep muster
 *  Kept equal to the SQL allowlist by a test that reads the migration file — a
 *  seventh kind in one and not the other is either a row with no sentence or a
 *  sentence with no rows. */
export const MUSTER_AUDIT_KINDS = [
  "muster_correction_scan_in",
  "muster_correction_time",
  "muster_undo",
  "muster_move",
  "muster_day_close",
  "muster_day_reopen",
] as const;

export type MusterAuditKind = (typeof MUSTER_AUDIT_KINDS)[number];

/** One row exactly as `list_muster_day_audit` returns it. */
export type RawDayAuditRow = {
  logged_at: string;
  kind: string;
  actor_id: string | null;
  /** `users.full_name`. NULL is the real case — 4 of the 5 live site admins have
   *  no name in the system at all — and it must stay null so the caller can say
   *  "ไม่ทราบผู้แก้ไข" rather than print a uuid. */
  actor_name: string | null;
  /** The role held AT THE TIME, off the audit row. Not the actor's role today. */
  actor_role: UserRole;
  worker_id: string | null;
  worker_name: string | null;
  session: "regular" | "ot" | null;
  /** Built per kind by the RPC. Never the raw payload: that carries whole-row
   *  snapshots of `muster_attendance` which have no business in a browser. */
  detail: Record<string, unknown> | null;
};

export type DayAuditRow = {
  loggedAt: string;
  kind: string;
  actorName: string | null;
  actorRole: UserRole;
  /** Spec 400 U6a — kept alongside workerName so a per-worker filter (the fix
   *  page's own trail) does not have to match on a display name two workers
   *  could share. Null for a whole-day event (close/reopen). */
  workerId: string | null;
  workerName: string | null;
  session: "regular" | "ot" | null;
  detail: Record<string, unknown>;
};

export function shapeDayAuditRow(raw: RawDayAuditRow): DayAuditRow {
  return {
    loggedAt: raw.logged_at,
    kind: raw.kind,
    actorName: raw.actor_name,
    actorRole: raw.actor_role,
    workerId: raw.worker_id,
    workerName: raw.worker_name,
    session: raw.session,
    detail: raw.detail ?? {},
  };
}

/** What each kind is CALLED. Keyed on the union so a seventh kind added to
 *  MUSTER_AUDIT_KINDS reds at typecheck instead of falling through to the raw
 *  string at runtime. */
const ACTION_LABEL: Record<MusterAuditKind, string> = {
  muster_correction_scan_in: "เพิ่มคนที่ตกหล่น",
  muster_correction_time: "แก้เวลา",
  muster_undo: "ลบการเช็คชื่อ",
  muster_move: "ย้ายทีม",
  muster_day_close: "ปิดวัน",
  // ⚠️ ปิดวัน is a SUBSTRING of this. Any matcher over these labels must compare
  // for equality, never `contains` (spec 400 U3b's Thai-matcher lesson).
  muster_day_reopen: "เปิดวันอีกครั้ง",
};

const NO_TIME = "—";
const NO_LEAD = "ไม่ระบุหัวหน้า";

function text(detail: Record<string, unknown>, key: string): string | null {
  const v = detail[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A payload timestamp (ISO-8601 UTC) as a Bangkok wall clock, or the em dash for
 *  "there was no time here". `formatThaiTime` is the one home for this — spec
 *  388/374 both read wall clocks through it. */
function clock(iso: string | null): string {
  return iso ? formatThaiTime(iso) : NO_TIME;
}

/** One axis of a retime, rendered only if it actually MOVED. Reporting an axis
 *  the corrector never touched would state a change that did not happen. */
function axis(label: string, before: string | null, after: string | null): string | null {
  if (before === after) return null;
  return `${label} ${clock(before)} → ${clock(after)}`;
}

/**
 * The sentence for one edit: what was done, and — where the fact is checkable —
 * what it was done to.
 *
 * `detail` is null for the kinds that state themselves. A close needs no gloss;
 * a retime absolutely does, because "แก้เวลา" alone tells a reader nothing they
 * can verify against the row above it.
 */
export function describeAuditEvent(row: DayAuditRow): { action: string; detail: string | null } {
  const kind = row.kind as MusterAuditKind;
  const action = ACTION_LABEL[kind];
  // An unrecognised kind: show it rather than drop the row.
  if (!action) return { action: row.kind, detail: null };

  switch (kind) {
    case "muster_correction_time": {
      const moved = [
        axis("เข้า", text(row.detail, "before_in_at"), text(row.detail, "in_at")),
        axis("ออก", text(row.detail, "before_out_at"), text(row.detail, "out_at")),
      ].filter((s): s is string => s !== null);
      return {
        action,
        // The RPC permits a correction that changes neither value; a blank line
        // under "แก้เวลา" would read as a rendering failure rather than a no-op.
        detail: moved.length > 0 ? moved.join(" · ") : "ไม่มีการเปลี่ยนเวลา",
      };
    }
    case "muster_undo": {
      const inAt = clock(text(row.detail, "before_in_at"));
      const outAt = clock(text(row.detail, "before_out_at"));
      // The snapshot in the payload is the only surviving copy of the row.
      return { action, detail: `เดิม เข้า ${inAt} · ออก ${outAt}` };
    }
    case "muster_move": {
      const from = text(row.detail, "from_team_name") ?? NO_LEAD;
      const to = text(row.detail, "to_team_name") ?? NO_LEAD;
      return { action, detail: `จาก ${from} → ${to}` };
    }
    case "muster_day_reopen": {
      const reason = text(row.detail, "reason");
      return { action, detail: reason ? `เหตุผล: ${reason}` : null };
    }
    case "muster_correction_scan_in":
    case "muster_day_close":
      // Both state themselves: the row already names the worker (or the day) and
      // the actor, and a correction's method is 'manual' by construction.
      return { action, detail: null };
  }
}

/** Minimal client shape — the session client, same as the report's other reads. */
type DayAuditRpcClient = {
  rpc: (
    fn: "list_muster_day_audit",
    args: { p_project: string; p_date: string },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Reads one project-day's trail. THROWS on RPC error, like every other read on
 * this page: an empty trail means "nobody edited this day", so swallowing the
 * error would turn a failure into a false all-clear about the very thing the
 * surface exists to disclose.
 */
export async function loadDayAudit(
  client: DayAuditRpcClient,
  projectId: string,
  date: string,
): Promise<DayAuditRow[]> {
  const { data, error } = await client.rpc("list_muster_day_audit", {
    p_project: projectId,
    p_date: date,
  });
  if (error) throw new Error(`list_muster_day_audit failed: ${error.message}`);
  return ((data ?? []) as RawDayAuditRow[]).map(shapeDayAuditRow);
}
