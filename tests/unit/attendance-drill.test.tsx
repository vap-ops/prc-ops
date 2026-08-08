import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceDrill } from "@/components/features/muster/attendance-drill";
import { shapeDetailRow, groupDetailByDate } from "@/lib/muster/attendance-audit";

// Spec 358 U3 — the RENDERED drill. The view-model tests cover the pure helpers,
// but with this markup inline in a Server Component nothing pinned the Thai
// strings or the day-aware wording, and that is precisely how the first cut
// shipped a drill whose rows said ยังไม่เช็คออก while the summary chip above them
// said ยังอยู่ในงาน. These assertions read what an auditor actually sees.

const TODAY = "2026-07-25";

type Raw = Parameters<typeof shapeDetailRow>[0];

const RAW: Raw = {
  worker_id: "w1",
  worker_name: "ช่าง หนึ่ง",
  project_id: "p1",
  project_name: "โครงการเอ",
  work_date: "2026-07-24",
  session: "regular",
  in_at: "2026-07-24T01:38:00Z", // 08:38 BKK
  in_method: "manual",
  out_at: "2026-07-24T10:00:00Z", // 17:00 BKK
  out_method: "manual",
  out_auto: false,
  ot_hours: null,
  scanned_by: "u1",
  scanned_by_name: "อรปรีญา เงางาม",
  team_lead_name: "จันทร์ เงางาม",
  day_closed: false,
};

const days = (...overrides: Partial<Raw>[]) =>
  groupDetailByDate(overrides.map((o) => shapeDetailRow({ ...RAW, ...o })));

describe("AttendanceDrill (spec 358 U3)", () => {
  it("shows the Bangkok wall-clock span, the provenance of BOTH scans, and who recorded it", () => {
    render(<AttendanceDrill days={days({})} todayIso={TODAY} />);
    const row = screen.getByText(/งานปกติ/).closest("li");
    expect(row?.textContent).toContain("08:38");
    expect(row?.textContent).toContain("17:00");
    expect(row?.textContent).toContain("เข้า: บันทึกมือ");
    // The check-out's provenance is the fact that varies — it was missing at first.
    expect(row?.textContent).toContain("ออก: บันทึกมือ");
    expect(row?.textContent).toContain("โดย อรปรีญา เงางาม");
    expect(row?.textContent).toContain("ทีม จันทร์ เงางาม");
  });

  it("labels a QR check-in distinctly from a typed one", () => {
    render(<AttendanceDrill days={days({ in_method: "qr", out_method: "qr" })} todayIso={TODAY} />);
    expect(screen.getByText(/เข้า: สแกน QR/)).toBeTruthy();
    expect(screen.getByText(/ออก: สแกน QR/)).toBeTruthy();
  });

  // The contradiction the reviewer caught: same fact, two surfaces, opposite words.
  it("reads TODAY's open session as still-at-work — never as the finding wording", () => {
    render(
      <AttendanceDrill
        days={days({ work_date: TODAY, out_at: null, out_method: null })}
        todayIso={TODAY}
      />,
    );
    expect(screen.getByText(/ยังอยู่ในงาน/)).toBeTruthy();
    expect(screen.queryByText(/ยังไม่เช็คออก/)).toBeNull();
  });

  it("reads a PAST day's open session as a real gap", () => {
    render(
      <AttendanceDrill
        days={days({ work_date: "2026-07-24", out_at: null, out_method: null })}
        todayIso={TODAY}
      />,
    );
    expect(screen.getByText(/ยังไม่เช็คออก/)).toBeTruthy();
    expect(screen.queryByText(/ยังอยู่ในงาน/)).toBeNull();
  });

  it("does not call today's unclosed day a finding, but does call yesterday's one", () => {
    const { unmount } = render(
      <AttendanceDrill days={days({ work_date: TODAY })} todayIso={TODAY} />,
    );
    expect(screen.getByText(/ยังอยู่ระหว่างวัน/)).toBeTruthy();
    expect(screen.queryByText(/ยังไม่ปิดวัน/)).toBeNull();
    unmount();

    render(<AttendanceDrill days={days({ work_date: "2026-07-24" })} todayIso={TODAY} />);
    expect(screen.getByText(/ยังไม่ปิดวัน/)).toBeTruthy();
  });

  it("marks an OT session closed after midnight so it cannot read as out-before-in", () => {
    render(
      <AttendanceDrill
        days={days({
          work_date: "2026-07-24",
          session: "ot",
          in_at: "2026-07-24T15:00:00Z", // 22:00 BKK
          out_at: "2026-07-24T18:30:00Z", // 01:30 BKK next day
          ot_hours: 3.5,
        })}
        todayIso={TODAY}
      />,
    );
    const row = screen.getByText(/OT/).closest("li");
    expect(row?.textContent).toContain("22:00");
    expect(row?.textContent).toContain("01:30");
    expect(row?.textContent).toContain("(+1 วัน)");
    expect(row?.textContent).toContain("3.5 ชม.");
  });

  it("prints the project ONCE on the day header, not on every session", () => {
    render(
      <AttendanceDrill
        days={days({ session: "regular" }, { session: "ot", ot_hours: 2 })}
        todayIso={TODAY}
      />,
    );
    // Two sessions, one project mention.
    expect(screen.getAllByText(/โครงการเอ/)).toHaveLength(1);
  });

  it("tags a system-written check-out", () => {
    render(<AttendanceDrill days={days({ out_auto: true })} todayIso={TODAY} />);
    expect(screen.getByText(/\(อัตโนมัติ\)/)).toBeTruthy();
  });

  it("renders nothing for no days", () => {
    const { container } = render(<AttendanceDrill days={[]} todayIso={TODAY} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // The FOURTH reopen door.
  //
  // Writing failing test first.
  //
  // The close-control fix was scoped to "three surfaces render MusterReopenForm".
  // That count was wrong: this drill is a fourth, and it is the one the LIST view
  // draws — a view that renders no `AttendanceDayPanel`, so it had reopen and no
  // close at all. Reopen from here and the reader had to discover the ตาราง toggle
  // to get the day shut again. Same stranding that left `PRC-2026-004`
  // `2026-08-05` open in production.
  // ---------------------------------------------------------------------------
  describe("closing the day it can reopen", () => {
    const closeForm = () => screen.queryByRole("form", { name: /^ปิดวัน/ });

    it("offers ปิดวัน on an OPEN past day, to a reader the RPC admits", () => {
      render(<AttendanceDrill days={days({})} todayIso={TODAY} canReopen canClose />);
      expect(closeForm()).not.toBeNull();
    });

    it("withholds it from a reader close_muster_day refuses", () => {
      render(<AttendanceDrill days={days({})} todayIso={TODAY} canReopen canClose={false} />);
      expect(closeForm()).toBeNull();
    });

    it("shows REOPEN on a closed day and CLOSE on an open one, never both", () => {
      // Two arms of one state machine — the day panel's own invariant, which the
      // shared `dayClosable` is what makes true here too.
      render(
        <AttendanceDrill days={days({ day_closed: true })} todayIso={TODAY} canReopen canClose />,
      );
      expect(closeForm()).toBeNull();
      expect(screen.queryByRole("form", { name: /^เปิดวัน/ })).not.toBeNull();
    });

    it("withholds it on TODAY — closing mid-shift fabricates the day's end", () => {
      render(
        <AttendanceDrill days={days({ work_date: TODAY })} todayIso={TODAY} canReopen canClose />,
      );
      expect(closeForm()).toBeNull();
    });
  });
});
