// Spec 400 U5 — the correction trail's reader half: shaping one `audit_log` row
// into the sentence a checker reads.
//
// The unit under test is a per-KIND mapping over six payload shapes written by
// six different functions, so every assertion below names its kind. Timestamps
// are written in UTC with the Bangkok wall clock in the comment, because that
// conversion is the failure mode: Bangkok is UTC+7, so 07:45 local is 00:45Z —
// and the payloads store ISO-8601 UTC (read off the one real live row,
// `"2026-08-05T00:45:00+00:00"`), never a local literal.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MUSTER_AUDIT_KINDS,
  describeAuditEvent,
  shapeDayAuditRow,
  type RawDayAuditRow,
} from "@/lib/muster/day-audit";

function raw(over: Partial<RawDayAuditRow> = {}): RawDayAuditRow {
  return {
    logged_at: "2026-07-21T02:00:00+00:00", // 09:00 Bangkok
    kind: "muster_correction_scan_in",
    actor_id: "00000000-0000-0000-0000-0000000000c1",
    actor_name: "คุณเอ ผู้แก้ไข",
    actor_role: "procurement",
    worker_id: "00000000-0000-0000-0000-0000000000w1",
    worker_name: "ลูกทีม สาม",
    session: "regular",
    detail: {},
    ...over,
  };
}

describe("shapeDayAuditRow", () => {
  it("carries the actor, the worker and the session through", () => {
    const row = shapeDayAuditRow(raw());
    expect(row.actorName).toBe("คุณเอ ผู้แก้ไข");
    expect(row.actorRole).toBe("procurement");
    expect(row.workerName).toBe("ลูกทีม สาม");
    expect(row.session).toBe("regular");
  });

  it("keeps a null actor_name null — the caller renders it unattributed, never a uuid", () => {
    // Real case: 4 of the 5 live site admins have no full_name at all.
    expect(shapeDayAuditRow(raw({ actor_name: null })).actorName).toBeNull();
  });

  it("keeps a null session null rather than defaulting it to regular", () => {
    // A whole-day event (close/reopen) has no session, and inventing 'regular'
    // would make a day-level edit read as a change to someone's normal shift.
    expect(shapeDayAuditRow(raw({ kind: "muster_day_close", session: null })).session).toBeNull();
  });
});

describe("describeAuditEvent — what each of the six kinds says", () => {
  it("names an add-person correction", () => {
    expect(describeAuditEvent(shapeDayAuditRow(raw())).action).toBe("เพิ่มคนที่ตกหล่น");
  });

  it("names a retime and states BOTH values, before and after", () => {
    const e = describeAuditEvent(
      shapeDayAuditRow(
        raw({
          kind: "muster_correction_time",
          detail: {
            in_at: "2026-07-20T00:45:00+00:00", // 07:45 Bangkok
            out_at: null,
            before_in_at: "2026-07-20T02:12:00+00:00", // 09:12 Bangkok
            before_out_at: null,
          },
        }),
      ),
    );
    expect(e.action).toBe("แก้เวลา");
    // "แก้เวลา" on its own states nothing a reader can check. The pair is the fact.
    expect(e.detail).toBe("เข้า 09:12 → 07:45");
  });

  it("reports only the axis that moved, so an untouched check-out is not implied", () => {
    const e = describeAuditEvent(
      shapeDayAuditRow(
        raw({
          kind: "muster_correction_time",
          detail: {
            in_at: "2026-07-20T00:45:00+00:00", // 07:45, unchanged
            out_at: "2026-07-20T10:30:00+00:00", // 17:30 Bangkok
            before_in_at: "2026-07-20T00:45:00+00:00", // 07:45 — same value
            before_out_at: null,
          },
        }),
      ),
    );
    expect(e.detail).toBe("ออก — → 17:30");
    expect(e.detail).not.toContain("เข้า");
  });

  it("says so plainly when a retime changed nothing", () => {
    // The RPC permits it (same value in, same value out), and a blank line under
    // "แก้เวลา" would read as a rendering failure rather than as a no-op.
    const e = describeAuditEvent(
      shapeDayAuditRow(
        raw({
          kind: "muster_correction_time",
          detail: {
            in_at: "2026-07-20T00:45:00+00:00",
            out_at: null,
            before_in_at: "2026-07-20T00:45:00+00:00",
            before_out_at: null,
          },
        }),
      ),
    );
    expect(e.detail).toBe("ไม่มีการเปลี่ยนเวลา");
  });

  it("names a deletion and states what the deleted row said", () => {
    const e = describeAuditEvent(
      shapeDayAuditRow(
        raw({
          kind: "muster_undo",
          detail: {
            before_in_at: "2026-07-20T01:00:00+00:00", // 08:00 Bangkok
            before_out_at: "2026-07-20T10:00:00+00:00", // 17:00 Bangkok
          },
        }),
      ),
    );
    expect(e.action).toBe("ลบการเช็คชื่อ");
    // The payload snapshot is the only surviving copy of the row.
    expect(e.detail).toBe("เดิม เข้า 08:00 · ออก 17:00");
  });

  it("names both teams of a move", () => {
    const e = describeAuditEvent(
      shapeDayAuditRow(
        raw({
          kind: "muster_move",
          session: null,
          detail: { from_team_name: "หัวหน้า หนึ่ง", to_team_name: "หัวหน้า สอง" },
        }),
      ),
    );
    expect(e.action).toBe("ย้ายทีม");
    expect(e.detail).toBe("จาก หัวหน้า หนึ่ง → หัวหน้า สอง");
  });

  it("renders a lead-less team as ไม่ระบุหัวหน้า rather than dropping the move", () => {
    // An office team has no lead; the RPC left-joins so the name arrives null.
    const e = describeAuditEvent(
      shapeDayAuditRow(
        raw({
          kind: "muster_move",
          session: null,
          detail: { from_team_name: null, to_team_name: "หัวหน้า สอง" },
        }),
      ),
    );
    expect(e.detail).toBe("จาก ไม่ระบุหัวหน้า → หัวหน้า สอง");
  });

  it("names a close, and carries no detail because closing states itself", () => {
    const e = describeAuditEvent(
      shapeDayAuditRow(raw({ kind: "muster_day_close", session: null, worker_name: null })),
    );
    expect(e.action).toBe("ปิดวัน");
    expect(e.detail).toBeNull();
  });

  it("names a reopen and carries the reason its RPC made mandatory", () => {
    const e = describeAuditEvent(
      shapeDayAuditRow(
        raw({
          kind: "muster_day_reopen",
          session: null,
          worker_name: null,
          detail: { reason: "ลืมบันทึกคนงาน 1 คน" },
        }),
      ),
    );
    // ⚠️ ปิดวัน is a SUBSTRING of เปิดวันอีกครั้ง, so an unanchored matcher passes
    // for the wrong event. Equality, not toContain.
    expect(e.action).toBe("เปิดวันอีกครั้ง");
    expect(e.action).not.toBe("ปิดวัน");
    expect(e.detail).toBe("เหตุผล: ลืมบันทึกคนงาน 1 คน");
  });

  it("shows an unrecognised kind rather than dropping the row", () => {
    // A seventh kind can only reach here through the RPC's own allowlist, but a
    // row that vanishes from an AUDIT trail is the one failure mode this surface
    // must not have. It renders the raw kind, visibly wrong, instead of nothing.
    const e = describeAuditEvent(shapeDayAuditRow(raw({ kind: "muster_something_new" })));
    expect(e.action).toBe("muster_something_new");
    expect(e.detail).toBeNull();
  });
});

describe("the kind list and the RPC cannot drift apart", () => {
  it("MUSTER_AUDIT_KINDS is exactly the allowlist inside the migration", () => {
    // The TS list is what the copy is keyed on; the SQL list is what the trail
    // actually returns. A seventh kind added to one and not the other is either a
    // row with no sentence or a sentence with no rows — this reds on both.
    const sql = readFileSync(
      "supabase/migrations/20260813075917_spec400u5_list_muster_day_audit.sql",
      "utf8",
    );
    const allowlist = sql.slice(sql.indexOf("al.payload->>'kind' in ("));
    const inSql = [
      ...allowlist.slice(0, allowlist.indexOf(")")).matchAll(/'(muster_[a-z_]+)'/g),
    ].map((m) => m[1]);
    expect(inSql.length).toBeGreaterThan(0); // a zero-match scan is an abort, not a pass
    expect([...inSql].sort()).toEqual([...MUSTER_AUDIT_KINDS].sort());
  });
});
