// Spec 374 U1 — WorkerAttendanceCalendar: the per-worker month calendar
// procurement reads check-in/out history from. Pure presentational (server-
// renderable): header card (rate + info), month summary (scanned/OT/estimate/
// paid variance + the cost-unconfirmed explainer), and the muster day cells.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkerAttendanceCalendar } from "@/components/features/labor/worker-attendance-calendar";
import { buildAttendanceMonth } from "@/lib/attendance/attendance-month";
import { baht } from "@/lib/format";

const month = buildAttendanceMonth({
  monthAnchor: "2026-07-01",
  musterRows: [
    {
      work_date: "2026-07-15",
      in_at: "2026-07-15T00:30:00Z", // 07:30 Bangkok
      out_at: "2026-07-15T10:00:00Z", // 17:00 Bangkok
      in_method: "qr",
      out_method: "manual",
      out_auto: false,
      ot_hours: 0,
      project_name: "P05 โพธิ์ทอง",
    },
    {
      work_date: "2026-07-16",
      in_at: "2026-07-16T00:35:00Z",
      out_at: "2026-07-16T10:00:00Z",
      in_method: "manual",
      out_method: "manual",
      out_auto: true,
      ot_hours: 0,
      project_name: "P05 โพธิ์ทอง",
    },
    {
      work_date: "2026-07-16",
      in_at: "2026-07-16T11:00:00Z",
      out_at: "2026-07-16T14:00:00Z",
      in_method: "qr",
      out_method: "qr",
      out_auto: false,
      ot_hours: 3,
      project_name: "P05 โพธิ์ทอง",
    },
  ],
  paidRows: [{ work_date: "2026-07-15", day_fraction: 1 }],
  dayRate: 450,
});

const worker = {
  id: "w1",
  name: "สมชาย ใจดี",
  levelLabel: null,
  dayRate: 450,
  phone: "0812345678",
  payTypeLabel: "รายวัน",
  active: true,
  costConfirmedAt: null,
  projectLabel: "P05 โพธิ์ทอง",
};

function renderCal(over: Partial<Parameters<typeof WorkerAttendanceCalendar>[0]> = {}) {
  return render(
    <WorkerAttendanceCalendar
      month={month}
      worker={worker}
      stdRate={null}
      prevHref="/workers/w1/attendance?m=2026-06"
      nextHref="/workers/w1/attendance?m=2026-08"
      {...over}
    />,
  );
}

describe("WorkerAttendanceCalendar", () => {
  it("header carries name, rate, pay type, phone, project", () => {
    renderCal();
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(baht(450)))).toBeInTheDocument();
    expect(screen.getByText(/รายวัน/)).toBeInTheDocument();
    expect(screen.getByText(/0812345678/)).toBeInTheDocument();
    expect(screen.getByText(/P05 โพธิ์ทอง/)).toBeInTheDocument();
  });

  it("month label is Buddhist-era Thai and steppers link prev/next", () => {
    renderCal();
    expect(screen.getByText("ก.ค. 2569")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เดือนก่อนหน้า" })).toHaveAttribute(
      "href",
      "/workers/w1/attendance?m=2026-06",
    );
    expect(screen.getByRole("link", { name: "เดือนถัดไป" })).toHaveAttribute(
      "href",
      "/workers/w1/attendance?m=2026-08",
    );
  });

  it("day cells show in–out and the OT chip", () => {
    renderCal();
    expect(screen.getByText(/07:30/)).toBeInTheDocument();
    expect(screen.getByText(/\+3 ชม\./)).toBeInTheDocument();
    // 07-16's latest out (21:00) came from the OT session; the auto flag
    // belongs to whichever row supplied the rendered out time.
    expect(screen.getByText(/21:00/)).toBeInTheDocument();
  });

  it("marks an auto check-out with the drill's (อัตโนมัติ) form", () => {
    const auto = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-20",
          in_at: "2026-07-20T00:30:00Z",
          out_at: "2026-07-20T10:00:00Z",
          in_method: "qr",
          out_method: "manual",
          out_auto: true,
          ot_hours: 0,
          project_name: "P05 โพธิ์ทอง",
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: auto });
    expect(screen.getByText(/\(อัตโนมัติ\)/)).toBeInTheDocument();
  });

  it("marks a next-day out with (+1 วัน)", () => {
    const overnight = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-21",
          in_at: "2026-07-21T15:00:00Z",
          out_at: "2026-07-21T18:30:00Z", // 01:30 Bangkok on the 22nd
          in_method: "qr",
          out_method: "qr",
          out_auto: false,
          ot_hours: 3,
          project_name: "P05 โพธิ์ทอง",
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: overnight });
    expect(screen.getByText(/\(\+1 วัน\)/)).toBeInTheDocument();
  });

  it("marks manually-recorded days with the drill's บันทึกมือ term", () => {
    renderCal();
    // 07-15 (manual OUT) and 07-16 (manual IN) both carry the marker.
    expect(screen.getAllByText("บันทึกมือ")).toHaveLength(2);
  });

  // Spec 404 U1 REPLACED the old rule here. It read "show the code when the day
  // differs from the HOME project", which INVERTS after a project move: the
  // worker's assignment is overwritten, so every correctly-recorded day of the
  // old month starts carrying a badge while the now-wrong header stays clean.
  // Live 2026-08-08, ten workers were in exactly that state. The badge now keys
  // on whether the MONTH spans more than one project — a fact about the days.
  it("shows no project badge when the whole month sat on one project", () => {
    // Deliberately a project that DIFFERS from worker.projectLabel (P05): under
    // the old rule this rendered a badge on every cell.
    const away = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-22",
          in_at: "2026-07-22T00:30:00Z",
          out_at: "2026-07-22T10:00:00Z",
          in_method: "qr",
          out_method: "qr",
          out_auto: false,
          ot_hours: 0,
          project_name: "P99 อื่น",
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: away });
    expect(screen.queryByText("P99")).not.toBeInTheDocument();
    renderCal();
    expect(screen.queryByText("P05")).not.toBeInTheDocument();
  });

  it("summary: scanned days, OT total, labeled estimate, paid days, variance", () => {
    renderCal();
    expect(screen.getByText(/มาทำงาน 2 วัน/)).toBeInTheDocument();
    expect(screen.getByText(/OT รวม 3 ชม\./)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`ประมาณการค่าแรง ฿${baht(900)}`))).toBeInTheDocument();
    expect(screen.getByText(/บันทึกค่าแรงแล้ว 1 วัน/)).toBeInTheDocument();
    expect(screen.getByText(/ต่างกัน 1 วัน/)).toBeInTheDocument();
  });

  it("explains WHY paid lags when the worker's cost is unconfirmed", () => {
    renderCal();
    expect(screen.getByText(/ยังไม่ยืนยันค่าแรง/)).toBeInTheDocument();
  });

  it("hides the unconfirmed explainer once cost is confirmed", () => {
    renderCal({ worker: { ...worker, costConfirmedAt: "2026-07-01T00:00:00Z" } });
    expect(screen.queryByText(/ยังไม่ยืนยันค่าแรง/)).not.toBeInTheDocument();
  });

  it("shows the standard level rate beside the worker rate when provided and different", () => {
    renderCal({ stdRate: 500, worker: { ...worker, levelLabel: "ช่างฝีมือ" } });
    expect(screen.getByText(new RegExp(`มาตรฐานระดับ ฿${baht(500)}`))).toBeInTheDocument();
  });

  it("omits the standard-rate compare when absent (non-money audience or unset)", () => {
    renderCal();
    expect(screen.queryByText(/มาตรฐานระดับ/)).not.toBeInTheDocument();
  });

  it("marks a holiday cell with its name and flags work on it (spec 374 U2)", () => {
    const holidayMonth = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-29",
          in_at: "2026-07-29T00:30:00Z",
          out_at: "2026-07-29T10:00:00Z",
          in_method: "qr",
          out_method: "qr",
          out_auto: false,
          ot_hours: 0,
          project_name: "P05 โพธิ์ทอง",
        },
      ],
      paidRows: [],
      dayRate: null,
      holidays: [
        { holiday_date: "2026-07-28", name_th: "วันเฉลิมพระชนมพรรษา" },
        { holiday_date: "2026-07-29", name_th: "วันอาสาฬหบูชา" },
      ],
    });
    const { container } = renderCal({ month: holidayMonth });
    // Empty holiday cell: name shown, no worked chip.
    expect(screen.getByText("วันเฉลิมพระชนมพรรษา")).toBeInTheDocument();
    // Scanned holiday cell: the worked-on-holiday chip.
    expect(screen.getByText("วันอาสาฬหบูชา")).toBeInTheDocument();
    expect(screen.getAllByText("ทำงานวันหยุด")).toHaveLength(1);
    // The tint is the at-a-glance marking — pin the real token (an invented
    // class would silently no-op).
    expect(container.querySelectorAll(".bg-attn-soft")).toHaveLength(2);
    // A truncated name must still be reachable — desktop back-office audience,
    // so title is the affordance.
    expect(screen.getByTitle("วันอาสาฬหบูชา")).toBeInTheDocument();
  });

  it("holiday tint beats the weekend tint (Sunday holiday)", () => {
    const sundayHoliday = buildAttendanceMonth({
      monthAnchor: "2026-05-01",
      musterRows: [],
      paidRows: [],
      dayRate: null,
      holidays: [{ holiday_date: "2026-05-31", name_th: "วันวิสาขบูชา" }],
    });
    const { container } = renderCal({ month: sundayHoliday });
    const cell = screen.getByText("วันวิสาขบูชา").closest("div");
    expect(cell?.className).toContain("bg-attn-soft");
    expect(cell?.className).not.toContain("bg-sunk");
    expect(container.querySelectorAll(".bg-attn-soft")).toHaveLength(1);
  });

  it("renders no holiday marking on an ordinary month", () => {
    const { container } = renderCal();
    expect(screen.queryByText("ทำงานวันหยุด")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".bg-attn-soft")).toHaveLength(0);
  });

  it("estimate renders — (not ฿0) when the worker has no rate", () => {
    const noRate = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: noRate, worker: { ...worker, dayRate: null } });
    expect(screen.getByText(/ประมาณการค่าแรง —/)).toBeInTheDocument();
  });
});

// ── Spec 400 U6b — the calendar as a door into the fix screen ────────────────
//
// Writing failing test first.
//
// Operator, 2026-08-07: "attendance calendar view is not edittable? it feels
// like it can be interactive, especially accessing from tablets." It was
// read-only; a day with attendance now opens that worker-day's fix screen for
// the correction audience.

describe("spec 400 U6b — calendar days as fix-screen doors", () => {
  /** The builder the page passes down, carrying the AUDITED month back. */
  const dayFixHref = (date: string) =>
    `/team/attendance/fix?worker=w1&date=${date}&from=${encodeURIComponent(
      "/workers/w1/attendance?m=2026-07",
    )}`;

  function fixLinks() {
    return screen
      .getAllByRole("link")
      .filter((a) => (a.getAttribute("href") ?? "").startsWith("/team/attendance/fix"));
  }

  it("links a day that carries attendance, at that date", () => {
    renderCal({ dayFixHref });
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("date=2026-07-15"))).toBe(true);
    expect(hrefs.some((h) => h.includes("date=2026-07-16"))).toBe(true);
  });

  it("threads the AUDITED month back, so returning does not land on today's", () => {
    // U1 shipped this bug once already: the grid's calendar link dropped `m=`, so
    // a checker auditing July clicked a name and landed on August. The referrer
    // has to carry the month the reader is actually looking at.
    renderCal({ dayFixHref });
    const from = new URL(
      fixLinks()[0]!.getAttribute("href") ?? "",
      "https://x.test",
    ).searchParams.get("from");
    expect(from).toBe("/workers/w1/attendance?m=2026-07");
  });

  it("does NOT link a day with no attendance — there is no project to infer", () => {
    // The fix page resolves the project from the first session; an empty day has
    // none, and this calendar carries no project id of its own (the month cell
    // holds project_NAME only). A link would land on the `noProject` arm.
    renderCal({ dayFixHref });
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("date=2026-07-14"))).toBe(false);
    expect(hrefs.some((h) => h.includes("date=2026-07-17"))).toBe(false);
  });

  it("renders no fix link at all for a reader outside the correction audience", () => {
    // WORKER_ROSTER_ROLES (this page's gate) includes project_manager and
    // project_director; every correction RPC refuses them with 42501.
    renderCal({ dayFixHref: null });
    expect(fixLinks()).toHaveLength(0);
  });

  it("keeps every FACT when the link is withheld", () => {
    const linked = renderCal({ dayFixHref });
    const withTimes = screen.getAllByText("07:30").length;
    linked.unmount();
    renderCal({ dayFixHref: null });
    expect(screen.getAllByText("07:30")).toHaveLength(withTimes);
    expect(screen.getByText(/ทำงานวันหยุด|17:00/)).toBeInTheDocument();
  });

  it("keeps every FACT in the link's accessible name, and puts the ACT in title", () => {
    // ⚠️ NOT an aria-label. An author-supplied one REPLACES the subtree as the
    // accessible name, so `แก้ไขการเช็คชื่อ 15 ก.ค.` would drop the times, the OT
    // hours, บันทึกมือ and the rest — the roles that GOT the control hearing
    // strictly less than the roles that did not. That is the U3b <th> defect, and
    // an earlier draft of this cell shipped it (a fresh-eyes pass caught it while
    // this very test asserted only that แก้ไข was present, which is what let it
    // through). The name comes from the subtree; `title` carries the act.
    renderCal({ dayFixHref });
    const link = fixLinks().find((a) => (a.getAttribute("href") ?? "").includes("2026-07-15"))!;
    expect(link.hasAttribute("aria-label")).toBe(false);
    const name = link.textContent ?? "";
    expect(name).toMatch(/15/); // the day
    expect(name).toMatch(/07:30/); // the check-in it renders
    expect(name).toMatch(/17:00/); // the check-out it renders
    expect(link.getAttribute("title")).toMatch(/แก้ไข/);
  });

  it("does not swallow the OT hours or the manual-entry marker either", () => {
    // 2026-07-16 carries a regular session AND an OT one (spec 351). The cell
    // merges them — earliest in, LATEST out — so the rendered check-out is the OT
    // row's 21:00, which a human recorded: no (อัตโนมัติ) marker belongs here, and
    // asserting one would be asserting against the merge rule rather than against
    // this link. What must survive is every marker the cell DOES render.
    renderCal({ dayFixHref });
    const link = fixLinks().find((a) => (a.getAttribute("href") ?? "").includes("2026-07-16"))!;
    const name = link.textContent ?? "";
    expect(name).toMatch(/07:35/); // earliest in
    expect(name).toMatch(/21:00/); // latest out
    expect(name).toMatch(/\+3 ชม\./); // the OT hours
    expect(name).toMatch(/บันทึกมือ/);
  });

  it("does not link the out-of-month padding cells", () => {
    // `cell.inMonth === false` cells belong to the neighbouring months and carry
    // no data for this month's read; linking them would mint a worker-day URL
    // for a date this page never audited.
    renderCal({ dayFixHref });
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("date=2026-06-"))).toBe(false);
    expect(hrefs.some((h) => h.includes("date=2026-08-"))).toBe(false);
  });
});

// ── Spec 404 U1 — the month owns the project, the header does not ────────────
// Live 2026-08-08: 10 workers moved off PRC-2026-004 on 08-07 while still
// carrying August days at 004, so `workers.project_id` (= where they are NOW)
// captions a past month with a project it never touched.
describe("WorkerAttendanceCalendar — project honesty", () => {
  const day = (date: string, project: string) => ({
    work_date: date,
    in_at: `${date}T00:30:00Z`,
    out_at: `${date}T10:00:00Z`,
    in_method: "qr",
    out_method: "qr",
    out_auto: false,
    ot_hours: 0,
    project_name: project,
  });

  const splitMonth = buildAttendanceMonth({
    monthAnchor: "2026-08-01",
    musterRows: [
      day("2026-08-03", "PRC-2026-004 TFM โพธิ์ทอง"),
      day("2026-08-04", "PRC-2026-004 TFM โพธิ์ทอง"),
      day("2026-08-05", "PRC-2026-008 ลาดกระบัง"),
    ],
    paidRows: [],
    dayRate: 400,
  });

  const movedWorker = { ...worker, projectLabel: "PRC-2026-008 ลาดกระบัง" };

  function renderSplit(over: Partial<Parameters<typeof WorkerAttendanceCalendar>[0]> = {}) {
    return render(
      <WorkerAttendanceCalendar
        month={splitMonth}
        worker={movedWorker}
        stdRate={null}
        prevHref="/workers/w1/attendance?m=2026-07"
        nextHref="/workers/w1/attendance?m=2026-09"
        {...over}
      />,
    );
  }

  it("split month: header lists every project with its own day count", () => {
    renderSplit();
    expect(screen.getByText("โครงการเดือนนี้")).toBeInTheDocument();
    expect(screen.getByText(/PRC-2026-004 TFM โพธิ์ทอง/)).toBeInTheDocument();
    expect(screen.getByText(/PRC-2026-008 ลาดกระบัง/)).toBeInTheDocument();
    expect(screen.getByText(/2 วัน/)).toBeInTheDocument();
    expect(screen.getByText(/1 วัน/)).toBeInTheDocument();
  });

  it("split month: every attendance cell carries the short project code", () => {
    renderSplit();
    expect(screen.getAllByText("004")).toHaveLength(2);
    expect(screen.getAllByText("008")).toHaveLength(1);
  });

  it("a month worked entirely elsewhere is NOT captioned with the current assignment", () => {
    // The whole defect in one assertion: the worker sits on -008 today and
    // every day of this month was worked at -004.
    const pastMonth = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [day("2026-07-20", "PRC-2026-004 TFM โพธิ์ทอง")],
      paidRows: [],
      dayRate: 400,
    });
    renderSplit({ month: pastMonth });
    expect(screen.getByText(/PRC-2026-004 TFM โพธิ์ทอง/)).toBeInTheDocument();
    // The current assignment may appear ONLY under its own label, never as the
    // month's project.
    expect(screen.getByText(/ปัจจุบันอยู่ที่/)).toBeInTheDocument();
  });

  it("does not claim a current assignment when it is one of the month's projects", () => {
    renderSplit();
    expect(screen.queryByText(/ปัจจุบันอยู่ที่/)).not.toBeInTheDocument();
  });

  it("a month with no attendance names no project, but still says where the worker is", () => {
    // The empty month has nothing to caption — but dropping the assignment
    // outright would remove a signal the old header carried, so it survives
    // under its own honest label.
    const empty = buildAttendanceMonth({
      monthAnchor: "2026-09-01",
      musterRows: [],
      paidRows: [],
      dayRate: 400,
    });
    renderSplit({ month: empty });
    expect(screen.queryByText("โครงการเดือนนี้")).not.toBeInTheDocument();
    expect(screen.queryByText("โครงการ")).not.toBeInTheDocument();
    expect(screen.getByText(/ปัจจุบันอยู่ที่/)).toBeInTheDocument();
    expect(screen.getByText(/PRC-2026-008 ลาดกระบัง/)).toBeInTheDocument();
  });

  it("labels the estimate as using the CURRENT rate", () => {
    renderSplit();
    expect(screen.getByText(/ค่าแรง\/วัน ปัจจุบัน/)).toBeInTheDocument();
  });
});
