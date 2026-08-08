// Spec 400 U5 — the correction trail rendered inside the ?day= panel.
//
// The write side of the correction loop has been complete since U3c; every edit
// already lands an `audit_log` row and NOTHING read them. What is pinned here is
// the reading surface: that each edit is named with the fact a checker can verify
// against the column above it, that an empty day says so rather than rendering
// nothing, and that the panel never claims a trail it did not fetch.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceDayPanel } from "@/components/features/muster/attendance-day-panel";
import { shapeDayAuditRow, type DayAuditRow, type RawDayAuditRow } from "@/lib/muster/day-audit";
import type { GridDay } from "@/lib/muster/attendance-grid";

const TODAY = "2026-08-06";

function day(over: Partial<GridDay> = {}): GridDay {
  return {
    date: "2026-08-04",
    nonWorking: false,
    holidayName: null,
    headcount: 4,
    dayClosed: false,
    ...over,
  };
}

function trailRow(over: Partial<RawDayAuditRow> = {}): DayAuditRow {
  return shapeDayAuditRow({
    logged_at: "2026-08-05T02:00:00+00:00", // 09:00 Bangkok
    kind: "muster_correction_scan_in",
    actor_id: "00000000-0000-0000-0000-0000000000c1",
    actor_name: "คุณเอ ผู้แก้ไข",
    actor_role: "procurement",
    worker_id: "00000000-0000-0000-0000-0000000000w1",
    worker_name: "ลูกทีม สาม",
    session: "regular",
    detail: {},
    ...over,
  });
}

function panel(over: Partial<Parameters<typeof AttendanceDayPanel>[0]> = {}) {
  return render(
    <AttendanceDayPanel
      day={day()}
      todayIso={TODAY}
      projectId="a1000000-0000-0000-0000-000000000001"
      canReopen={false}
      canClose={false}
      returnTo="/team/attendance"
      trail={[]}
      {...over}
    />,
  );
}

describe("the trail section", () => {
  it("names WHAT was done, TO WHOM, and BY WHOM with the role held at the time", () => {
    panel({ trail: [trailRow()] });
    const trail = screen.getByRole("list", { name: "ประวัติการแก้ไขย้อนหลัง" });
    const only = within(trail).getAllByRole("listitem");
    expect(only).toHaveLength(1);
    expect(only[0]).toHaveTextContent("เพิ่มคนที่ตกหล่น");
    expect(only[0]).toHaveTextContent("ลูกทีม สาม");
    expect(only[0]).toHaveTextContent("คุณเอ ผู้แก้ไข");
    // The role is the one on the audit row, which is what explains the edit.
    expect(only[0]).toHaveTextContent("จัดซื้อ");
    // ⚠️ The DATE the edit was made, not the time alone. The panel is open on
    // 4 ส.ค. and this edit happened on 5 ส.ค. — a correction is made on a LATER
    // day than the one being audited, so a bare "09:00" would read as 09:00 on
    // the audited day. Hand-written, in Bangkok, in the app's Buddhist era, so
    // the expectation is independent of the formatter it checks.
    expect(only[0]).toHaveTextContent("5 ส.ค. 2569 09:00");
    // …and the raw payload timestamp never reaches the reader. `getAllByRole`
    // is indexed, so under noUncheckedIndexedAccess the element is read through
    // `?.` rather than asserted non-null.
    expect(only[0]?.textContent).not.toContain("2026-08-05T02:00:00");
  });

  it("renders an unattributed edit rather than a uuid when the actor has no name", () => {
    // 4 of the 5 live site admins have no full_name in the system at all.
    panel({ trail: [trailRow({ actor_name: null })] });
    const trail = screen.getByRole("list", { name: "ประวัติการแก้ไขย้อนหลัง" });
    expect(within(trail).getByRole("listitem")).toHaveTextContent("ไม่ทราบผู้แก้ไข");
    expect(within(trail).getByRole("listitem").textContent).not.toContain("0000-0000");
  });

  it("states the before and after of a retime, the fact the whole trail exists for", () => {
    panel({
      trail: [
        trailRow({
          kind: "muster_correction_time",
          detail: {
            in_at: "2026-08-04T00:45:00+00:00", // 07:45 Bangkok
            out_at: null,
            before_in_at: "2026-08-04T02:12:00+00:00", // 09:12 Bangkok
            before_out_at: null,
          },
        }),
      ],
    });
    expect(screen.getByRole("list", { name: "ประวัติการแก้ไขย้อนหลัง" })).toHaveTextContent(
      "เข้า 09:12 → 07:45",
    );
  });

  it("says the day is untouched rather than rendering an empty section", () => {
    // A missing list and "nobody edited this day" are the same pixels, and only
    // one of them is a fact. The panel must be the one that states it.
    panel({ trail: [] });
    expect(screen.getByText("ยังไม่มีการแก้ไขย้อนหลังของวันดังกล่าว")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "ประวัติการแก้ไขย้อนหลัง" })).toBeNull();
  });

  it("does not claim an empty trail when no project is picked and none was fetched", () => {
    // ทุกโครงการ spans several projects and the RPC takes exactly one, so nothing
    // is read. Saying "ยังไม่มีการแก้ไข" here would assert a fact about days the
    // page never looked at — the same lie the ?day= controls avoid with their own
    // "เลือกโครงการก่อน" arm.
    panel({ projectId: null, trail: null });
    expect(screen.queryByText("ยังไม่มีการแก้ไขย้อนหลังของวันดังกล่าว")).toBeNull();
    expect(screen.getByText("เลือกโครงการก่อน จึงจะดูประวัติการแก้ไขได้")).toBeInTheDocument();
  });

  it("shows the trail to a reader who may not correct anything", () => {
    // The audience is ATTENDANCE_AUDIT_ROLES, wider than the correction audience:
    // accounting owns the wage consequence and must see who touched the day even
    // though every control on this panel is withheld from them.
    panel({ canReopen: false, canClose: false, trail: [trailRow()] });
    expect(screen.getByRole("list", { name: "ประวัติการแก้ไขย้อนหลัง" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ปิดวัน" })).toBeNull();
  });

  it("keeps the trail in the order the RPC returned it — newest first", () => {
    panel({
      trail: [
        trailRow({
          kind: "muster_day_reopen",
          logged_at: "2026-08-05T03:00:00+00:00", // 10:00
          worker_name: null,
          session: null,
          detail: { reason: "ลืมบันทึกคนงาน" },
        }),
        trailRow({ logged_at: "2026-08-05T02:00:00+00:00" }), // 09:00
      ],
    });
    const items = within(
      screen.getByRole("list", { name: "ประวัติการแก้ไขย้อนหลัง" }),
    ).getAllByRole("listitem");
    // ⚠️ ปิดวัน is a substring of เปิดวันอีกครั้ง — assert the whole label, and
    // assert the SECOND row separately so a reversed list cannot pass.
    expect(items[0]).toHaveTextContent("เปิดวันอีกครั้ง");
    expect(items[1]).toHaveTextContent("เพิ่มคนที่ตกหล่น");
  });
});
