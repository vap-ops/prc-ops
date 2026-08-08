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
  // case is iPad portrait: 834 − 40 page padding − 16 gap − 280 panel ÷ 7 =
  // ~71px per column, 66px usable — against `17:00 (อัตโนมัติ)` at ~80px. So
  // the two stacked time lines become one, and the two word-markers become
  // glyphs whose words live in the legend below the grid.
  //
  // ⚠️ jsdom has no layout engine, so this file can only pin the MARKUP — that
  // both times share one element. Whether that element fits on one LINE is a
  // geometry claim and was measured in real Chrome instead: one line above
  // ~880px, wrapping to two below it. See the component's own note.
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

  // ── Operator 2026-08-08 — the holiday marking is WITHDRAWN ────────────────
  //
  // Writing failing test first.
  //
  // "hide info about holidays, we do not have those yet. money is the same as
  // normal day." Spec 374 U2's tint + name + ทำงานวันหยุด chip + legend
  // described a policy the firm does not have: PRC scanned FULL days on
  // 2026-07-29 (อาสาฬหบูชา) and 2026-07-30 (วันเข้าพรรษา), and on a page whose
  // headline is ประมาณการค่าแรง an amber tint reads as "this day is priced
  // differently" — which it never was.
  //
  // Pinned as an ORDINARY DAY, not as an absence: the queryBy…toBeNull half is
  // satisfied by a component that renders nothing at all.
  it("renders a public-holiday date as an ordinary working day", () => {
    const julyEnd = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-29", // วันอาสาฬหบูชา in the retained seed
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
    });
    const { container } = renderCal({ month: julyEnd });
    // The day's own facts are there …
    expect(screen.getByText("07:30–17:00")).toBeInTheDocument();
    // … and it is a Wednesday, so it carries neither tint. `getAllByText`
    // because the 42-cell grid pads with the neighbouring months: June 29 sits
    // in the first row. The IN-MONTH day is the one rendered `font-semibold`
    // (it carries attendance).
    const cell = screen
      .getAllByText("29")
      .find((el) => el.className.includes("font-semibold"))!
      .closest("div");
    expect(cell?.className).not.toContain("bg-attn-soft");
    expect(cell?.className).not.toContain("bg-sunk");
    // Nothing holiday-shaped anywhere on the page.
    expect(container.querySelectorAll(".bg-attn-soft")).toHaveLength(0);
    expect(screen.queryByText("ทำงานวันหยุด")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "วันหยุดของเดือนนี้" })).not.toBeInTheDocument();
  });

  it("keeps the WEEKEND tint — Sunday is not a public holiday", () => {
    // The withdrawal is about `public_holidays` only. 2026-05-31 is a Sunday
    // (and วันวิสาขบูชา in the retained seed): it stays tinted, as every Saturday
    // and Sunday of the month does, for the weekend reason alone.
    const may = buildAttendanceMonth({
      monthAnchor: "2026-05-01",
      musterRows: [],
      paidRows: [],
      dayRate: null,
    });
    const { container } = renderCal({ month: may });
    const cell = screen.getByText("31").closest("div");
    expect(cell?.className).toContain("bg-sunk");
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

  it("does NOT link a blank day the page did not name as a door", () => {
    // ⚠️ Retitled by U2b. It used to read "a day with no attendance", which
    // stopped being the rule the moment blank days could be doors — and it kept
    // passing only because this suite never supplied `blankFixDates`, so the
    // title asserted an invariant the code no longer has.
    //
    // `data` OR membership of `blankFixDates` is the gate. With no set passed,
    // no blank cell links: the grid does not offer ~24 blank tap targets.
    renderCal({ dayFixHref });
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("fix=2026-07-14"))).toBe(false);
    expect(hrefs.some((h) => h.includes("fix=2026-07-17"))).toBe(false);
  });

  it("links exactly the blank days the page named, and no others (spec 404 U2b)", () => {
    // A day this worker has no row on, at a project that scanned other people,
    // is fully serviceable — but nothing linked it before U2b, so the screen
    // built for "the muster missed him" existed only at a hand-typed URL.
    renderCal({ dayFixHref, blankFixDates: new Set(["2026-07-14"]) });
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("fix=2026-07-14"))).toBe(true);
    // …and ONLY that one. The neighbouring blank day is not a door, which is
    // what keeps this from becoming the cry-wolf wall U6b ruled against.
    expect(hrefs.some((h) => h.includes("fix=2026-07-17"))).toBe(false);
  });

  it("marks a blank door visibly, or it is an invisible tap target", () => {
    // A blank cell has no time to show. The grid's gap cells solve this with a
    // `+`; the same glyph appears here, and ONLY on the door — an always-on mark
    // would accuse every unworked day of something.
    renderCal({ dayFixHref, blankFixDates: new Set(["2026-07-14"]) });
    const door = fixLinks().find((a) => (a.getAttribute("href") ?? "").includes("2026-07-14"))!;
    expect(door.textContent).toContain("+");
    const dayWithData = fixLinks().find((a) =>
      (a.getAttribute("href") ?? "").includes("2026-07-15"),
    )!;
    expect(dayWithData.textContent).not.toContain("+");
  });

  it("names a blank door for what it DOES, not for a control that may be withheld", () => {
    // Honest copy, and the first draft failed it: the blank door said
    // เพิ่มคนที่ตกหล่น, but the panel gates the whole add block on
    // `dayClosed === false` and offers เปิดวันอีกครั้ง instead on a closed day.
    // Every one of the 13 past days carrying attendance is closed — including
    // 2026-08-04, the live case this door was built for — so the promise would
    // have been false for the flagship example, not for an edge.
    renderCal({ dayFixHref, blankFixDates: new Set(["2026-07-14"]) });
    const door = fixLinks().find((a) => (a.getAttribute("href") ?? "").includes("2026-07-14"))!;
    expect(door.textContent).toContain("เปิดหน้าต่างแก้ไข");
    expect(door.textContent).not.toContain("เพิ่มคนที่ตกหล่น");
    // The data door keeps its own name, which is true of IT: there is a
    // เช็คชื่อ on that day to แก้ไข.
    const dayWithData = fixLinks().find((a) =>
      (a.getAttribute("href") ?? "").includes("2026-07-15"),
    )!;
    expect(dayWithData.textContent).toContain("แก้ไขการเช็คชื่อ");
  });

  it("withholds blank doors from a reader who cannot correct at all", () => {
    // `dayFixHref` is null for everyone outside MUSTER_CORRECT_ROLES, and the
    // blank door must not be a second way in — the set alone cannot open one.
    renderCal({ dayFixHref: null, blankFixDates: new Set(["2026-07-14"]) });
    expect(fixLinks()).toHaveLength(0);
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
