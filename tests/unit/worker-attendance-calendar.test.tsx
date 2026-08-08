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
      project_id: null,
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
      project_id: null,
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
      project_id: null,
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

  // ── Spec 404 U2 — the COMPACT cell ────────────────────────────────────────
  //
  // Writing failing test first.
  //
  // The compact cell is the PRICE of the `md` split, not a polish item. Worst
  // case is iPad portrait: 834 − 40 page padding − 16 gap − 300 panel = 478 ÷ 7
  // = 68px per column, 60px usable — against `17:00 (อัตโนมัติ)` at ~80px. So
  // the two stacked time lines become one, and the two word-markers become
  // glyphs whose words live in the legend below the grid.
  it("day cells show ONE in–out line, not two stacked ones", () => {
    renderCal();
    // One element carries both times, so the cell costs one line instead of two.
    expect(screen.getByText("07:30–17:00")).toBeInTheDocument();
    expect(screen.getByText(/\+3 ชม\./)).toBeInTheDocument();
    // 07-16's latest out (21:00) came from the OT session; the auto flag
    // belongs to whichever row supplied the rendered out time.
    expect(screen.getByText("07:35–21:00")).toBeInTheDocument();
  });

  it("renders an open range when only one side was recorded", () => {
    // A worker still checked in. `08:15–` is an open interval and says exactly
    // that; inventing the other half, or hiding the line, would not.
    const openOut = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-23",
          in_at: "2026-07-23T01:15:00Z", // 08:15 Bangkok
          out_at: null,
          in_method: "qr",
          out_method: null,
          out_auto: false,
          ot_hours: 0,
          project_name: "P05 โพธิ์ทอง",
          project_id: null,
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: openOut });
    expect(screen.getByText("08:15–")).toBeInTheDocument();
  });

  it("marks an auto check-out with a glyph, and keeps (อัตโนมัติ) in the accessible name", () => {
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
          project_id: null,
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    const { container } = renderCal({ month: auto });
    // The WORD survives for a screen reader and in the legend; only the visual
    // shrinks. Dropping it outright would be the U6b aria-label defect from the
    // other direction — a compact cell that tells a listener less.
    expect(screen.getByText("(อัตโนมัติ)")).toHaveClass("sr-only");
    // …and the glyph itself is hidden from the name, or the listener hears it twice.
    expect(container.querySelector("[data-marker='auto'][aria-hidden='true']")).not.toBeNull();
    // The legend is what makes the glyph decodable for a SIGHTED reader — the
    // panel cannot serve that job: it is gated on the correction audience and is
    // only on screen while it is open.
    expect(screen.getByText(/ระบบปิดเวลาให้อัตโนมัติ/)).toBeInTheDocument();
  });

  it("renders no marker legend on a month that has no markers", () => {
    // An always-on legend is wallpaper; it appears only when the month it
    // describes actually carries the thing.
    const plain = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-24",
          in_at: "2026-07-24T00:30:00Z",
          out_at: "2026-07-24T10:00:00Z",
          in_method: "qr",
          out_method: "qr",
          out_auto: false,
          ot_hours: 0,
          project_name: "P05 โพธิ์ทอง",
          project_id: null,
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: plain });
    expect(screen.queryByText(/ระบบปิดเวลาให้อัตโนมัติ/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ออกงานหลังเที่ยงคืน/)).not.toBeInTheDocument();
  });

  it("marks a next-day out with a compact +1, whose word survives in the name", () => {
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
          project_id: null,
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: overnight });
    // `+1` is two characters and reads as itself; the unit is what a listener
    // would otherwise lose, so it stays in the name and in the legend.
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("วัน")).toHaveClass("sr-only");
    expect(screen.getByText(/ออกงานหลังเที่ยงคืน/)).toBeInTheDocument();
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
          project_id: null,
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
          project_id: null,
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
    // Empty holiday cell: name shown, no worked chip. Spec 404 U2 — twice now,
    // once in the cell and once in the legend that replaced the `title`.
    expect(screen.getAllByText("วันเฉลิมพระชนมพรรษา")).toHaveLength(2);
    // Scanned holiday cell: the worked-on-holiday chip.
    expect(screen.getAllByText("วันอาสาฬหบูชา")).toHaveLength(2);
    expect(screen.getAllByText("ทำงานวันหยุด")).toHaveLength(1);
    // The tint is the at-a-glance marking — pin the real token (an invented
    // class would silently no-op).
    expect(container.querySelectorAll(".bg-attn-soft")).toHaveLength(2);
  });

  // ── Spec 404 U2 — `title=` is not a fallback on a tablet ──────────────────
  //
  // Writing failing test first.
  //
  // The cell justified truncating a royal-holiday name with "this page's
  // audience is desktop back-office, where hover is real". The operator reads it
  // on an iPad. There is no hover, no long-press tooltip, and the longest live
  // name is 50 characters (`วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ พระบรมราชินี`,
  // measured 2026-08-08) against a 60px box — so the full name has to live
  // somewhere every reader can actually reach.
  it("carries no title= on the holiday name — a tablet has no hover", () => {
    const holidayMonth = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [],
      paidRows: [],
      dayRate: null,
      holidays: [
        {
          holiday_date: "2026-07-28",
          name_th: "วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ พระบรมราชินี",
        },
      ],
    });
    const { container } = renderCal({ month: holidayMonth });
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("names every holiday of the month IN FULL, below the grid", () => {
    // The legend, not the panel: the panel is gated on the correction audience
    // and only renders while open, so moving the name there would withhold it
    // from the readers who lost the hover.
    const holidayMonth = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [],
      paidRows: [],
      dayRate: null,
      holidays: [
        {
          holiday_date: "2026-07-28",
          name_th: "วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ พระบรมราชินี",
        },
        { holiday_date: "2026-07-29", name_th: "วันอาสาฬหบูชา" },
      ],
    });
    renderCal({ month: holidayMonth });
    const legend = screen.getByRole("list", { name: "วันหยุดของเดือนนี้" });
    expect(legend).toHaveTextContent("28");
    expect(legend).toHaveTextContent("วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ พระบรมราชินี");
    expect(legend).toHaveTextContent("วันอาสาฬหบูชา");
  });

  it("renders no holiday legend when the month has none", () => {
    renderCal();
    expect(screen.queryByRole("list", { name: "วันหยุดของเดือนนี้" })).not.toBeInTheDocument();
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
    // Spec 404 U2 — the name now appears twice: in the cell and, in full, in the
    // legend under the grid. The CELL is the one carrying the tint.
    const cell = screen.getAllByText("วันวิสาขบูชา")[0]!.closest("div");
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

// ── Spec 404 U2 — the day cell opens the panel IN PLACE ─────────────────────
//
// Writing failing test first.
//
// Operator, 2026-08-07: "attendance calendar view is not edittable? it feels
// like it can be interactive, especially accessing from tablets." U6b answered
// that by navigating away to `/team/attendance/fix`. Operator, 2026-08-08: "in
// case of large screens, I suggest holding an edit panel on the right side
// opened, with arrows left and right." So the cell now opens `?fix=<date>` on
// this same route — the shape spec 400 U7 already proved on the grid.

describe("spec 404 U2 — calendar days as in-page panel doors", () => {
  /** The builder the page passes down: its OWN url, month preserved. */
  const dayFixHref = (date: string) => `/workers/w1/attendance?m=2026-07&fix=${date}`;

  function fixLinks() {
    return screen
      .getAllByRole("link")
      .filter((a) => (a.getAttribute("href") ?? "").includes("fix="));
  }

  it("links a day that carries attendance, at that date, on its OWN route", () => {
    renderCal({ dayFixHref });
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("fix=2026-07-15"))).toBe(true);
    expect(hrefs.some((h) => h.includes("fix=2026-07-16"))).toBe(true);
    // Never off to the standalone screen: that round trip is the thing this
    // unit removes (the route stays alive for links already in the wild).
    expect(hrefs.some((h) => h.startsWith("/team/attendance/fix"))).toBe(false);
  });

  it("keeps the viewed month in the door, so opening a panel cannot move it", () => {
    // U1 shipped the sibling bug once already: the grid's calendar link dropped
    // `m=`, so a checker auditing July clicked and landed on August.
    renderCal({ dayFixHref });
    expect(fixLinks()[0]!.getAttribute("href")).toContain("m=2026-07");
  });

  it("does NOT link a day with no attendance", () => {
    // `data` is the gate: exactly "this date has something to correct". An empty
    // day is still openable — the panel's own steppers walk onto one — but the
    // grid does not offer 20 blank tap targets to get there.
    renderCal({ dayFixHref });
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("fix=2026-07-14"))).toBe(false);
    expect(hrefs.some((h) => h.includes("fix=2026-07-17"))).toBe(false);
  });

  it("marks the cell the panel is currently open on", () => {
    // The panel docks beside a 42-cell grid; without this the reader has no way
    // to tell WHICH day it is about. `aria-current` rather than an aria-label —
    // it annotates the link without replacing its subtree as the name.
    renderCal({ dayFixHref, openFixDate: "2026-07-15" });
    const open = fixLinks().find((a) => (a.getAttribute("href") ?? "").includes("2026-07-15"))!;
    expect(open).toHaveAttribute("aria-current", "date");
    const other = fixLinks().find((a) => (a.getAttribute("href") ?? "").includes("2026-07-16"))!;
    expect(other.hasAttribute("aria-current")).toBe(false);
  });

  it("marks nothing when no panel is open", () => {
    renderCal({ dayFixHref });
    expect(fixLinks().every((a) => !a.hasAttribute("aria-current"))).toBe(true);
  });

  it("renders no fix link at all for a reader outside the correction audience", () => {
    // WORKER_ROSTER_ROLES (this page's gate) includes project_manager and
    // project_director; every correction RPC refuses them with 42501.
    renderCal({ dayFixHref: null });
    expect(fixLinks()).toHaveLength(0);
  });

  it("keeps every FACT when the link is withheld", () => {
    const linked = renderCal({ dayFixHref });
    const withTimes = screen.getAllByText("07:30–17:00").length;
    linked.unmount();
    renderCal({ dayFixHref: null });
    expect(screen.getAllByText("07:30–17:00")).toHaveLength(withTimes);
    expect(screen.getByText(/ทำงานวันหยุด|17:00/)).toBeInTheDocument();
  });

  it("keeps every FACT in the link's accessible name, and carries NO title", () => {
    // ⚠️ NOT an aria-label. An author-supplied one REPLACES the subtree as the
    // accessible name, so `แก้ไขการเช็คชื่อ 15 ก.ค.` would drop the times, the OT
    // hours, บันทึกมือ and the rest — the roles that GOT the control hearing
    // strictly less than the roles that did not. That is the U3b <th> defect, and
    // an earlier draft of this cell shipped it.
    //
    // ⚠️ And NOT a title either, any more. U6b put the link's whole PURPOSE
    // (`แก้ไขการเช็คชื่อ 15 ก.ค.`) in one, justified as "desktop back-office,
    // where hover is real" — the operator opens this on an iPad, where that
    // attribute reaches nobody. The purpose is carried by the panel's own
    // heading the moment the cell opens it in place, which is the whole point of
    // opening it in place.
    renderCal({ dayFixHref });
    const link = fixLinks().find((a) => (a.getAttribute("href") ?? "").includes("2026-07-15"))!;
    expect(link.hasAttribute("aria-label")).toBe(false);
    expect(link.hasAttribute("title")).toBe(false);
    const name = link.textContent ?? "";
    expect(name).toMatch(/15/); // the day
    expect(name).toMatch(/07:30/); // the check-in it renders
    expect(name).toMatch(/17:00/); // the check-out it renders
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
    // no data for this month's read; linking them would mint a `?fix=` the
    // panel's own month bound then refuses.
    renderCal({ dayFixHref });
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("fix=2026-06-"))).toBe(false);
    expect(hrefs.some((h) => h.includes("fix=2026-08-"))).toBe(false);
  });
});

// ── Spec 404 U1 — the month owns the project, the header does not ────────────
// Live 2026-08-08: 10 workers moved off PRC-2026-004 on 08-07 while still
// carrying August days at 004, so `workers.project_id` (= where they are NOW)
// captions a past month with a project it never touched.
describe("WorkerAttendanceCalendar — project honesty", () => {
  const day = (date: string, project: string, projectId: string | null = null) => ({
    work_date: date,
    in_at: `${date}T00:30:00Z`,
    out_at: `${date}T10:00:00Z`,
    in_method: "qr",
    out_method: "qr",
    out_auto: false,
    ot_hours: 0,
    project_name: project,
    project_id: projectId,
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
