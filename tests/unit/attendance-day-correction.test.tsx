// Spec 400 U3b — the ?day= panel: the COLUMN twin of the ?worker= drill.
//
// U1 made the grid the default view, and the grid carries no correction control
// at all — the reopen form shipped by spec 397 U3 lives inside the LIST's drill.
// So the default view of the report showed procurement every hole and offered
// them nothing. U3a then widened `close_muster_day` and `muster_scan_in` to
// `procurement`, which made two of this page's sentences FALSE: they still hand
// the close step to the SA.
//
// What is pinned here:
//   1. the control the panel offers is a PURE function of (date, closure,
//      project, permissions) — extracted because a source scan proves a branch
//      exists, never that it is reachable (U1's surviving mutant);
//   2. every arm renders its own message, so a refusal names its cause rather
//      than silently rendering nothing;
//   3. MUSTER_CLOSE_ROLES mirrors `close_muster_day`'s LIVE allowlist over the
//      exhaustive role domain, and MUSTER_REOPEN_ROLES ⊆ it — the implication the
//      "แก้ไขแล้วต้องปิดวันใหม่" copy rests on.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceDayPanel } from "@/components/features/muster/attendance-day-panel";
import { AttendanceGridView } from "@/components/features/muster/attendance-grid-view";
import { MUSTER_CLOSE_ROLES, MUSTER_REOPEN_ROLES, type UserRole } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { attendanceDayParam, dayCorrectionControl } from "@/lib/muster/day-correction";
import { closeReturnTo } from "@/lib/muster/reopen-return";
import type { GridDay } from "@/lib/muster/attendance-grid";

const TODAY = "2026-08-06";
const DATES = ["2026-08-04", "2026-08-05", "2026-08-06"];

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

describe("spec 400 U3b — who may close a muster day", () => {
  it("is exactly close_muster_day's live allowlist, over the whole role domain", () => {
    // Read from the LIVE function 2026-08-06 (migration 20260813075912 widened it):
    //   {site_admin, super_admin, procurement_manager, procurement}
    // Iterating the exhaustive domain, not a hand-typed "these must not" list: a
    // role added to the enum later must red this, not sail through it.
    const all = Object.keys(USER_ROLE_LABEL) as UserRole[];
    expect(all.filter((r) => MUSTER_CLOSE_ROLES.includes(r)).sort()).toEqual(
      // Spec 400 U6c (migration 20260813075919) widened the live allowlist to the
      // audit audience plus site_admin. Read from the LIVE function, as before.
      [
        "accounting",
        "hr",
        "procurement",
        "procurement_manager",
        "project_coordinator",
        "project_director",
        "project_manager",
        "site_admin",
        "super_admin",
      ].sort(),
    );
  });

  it("admits every role that may REOPEN — the implication the loop copy rests on", () => {
    // "แก้ไขแล้วต้องปิดวันใหม่" is only honest while a reopener can also close.
    // The two sets gate two different RPCs and are kept distinct per the role
    // doctrine, so the relationship between them is pinned rather than assumed:
    // narrowing close would otherwise leave the reopen form promising a step its
    // reader cannot take, silently.
    for (const role of MUSTER_REOPEN_ROLES) {
      expect(MUSTER_CLOSE_ROLES).toContain(role);
    }
  });
});

describe("spec 400 U3b — dayCorrectionControl", () => {
  const base = {
    date: "2026-08-04",
    todayIso: TODAY,
    dayClosed: false as boolean | null,
    projectId: "p1" as string | null,
    canReopen: true,
    canClose: true,
  };

  it("offers CLOSE on an open PAST day", () => {
    expect(dayCorrectionControl(base)).toEqual({ control: "close" });
  });

  it("withholds CLOSE on today — closing mid-shift stamps 17:00 on everyone still in", () => {
    // Today belongs to the muster cockpit, which reaches the same RPC through a
    // ready/overdue state machine this audit report does not reimplement.
    expect(dayCorrectionControl({ ...base, date: TODAY })).toEqual({
      control: "none",
      reason: "dayNotOver",
    });
    // …but a today that was closed EARLY is still reopenable from here.
    expect(dayCorrectionControl({ ...base, date: TODAY, dayClosed: true })).toEqual({
      control: "reopen",
    });
  });

  it("offers REOPEN on a closed day", () => {
    expect(dayCorrectionControl({ ...base, dayClosed: true })).toEqual({ control: "reopen" });
  });

  it("offers nothing for a day that has not happened yet", () => {
    expect(dayCorrectionControl({ ...base, date: "2026-08-09" })).toEqual({
      control: "none",
      reason: "future",
    });
  });

  it("offers nothing for a day nobody was scanned on", () => {
    // dayClosed === null is the grid's "this day carries no rows at all". Closing
    // it would insert a closure over nothing, and the correction that WOULD help
    // — adding the missing person — needs a back-dated in_at that no RPC accepts
    // today (spec 400 U3b finding 2).
    expect(dayCorrectionControl({ ...base, dayClosed: null })).toEqual({
      control: "none",
      reason: "noRecords",
    });
  });

  it("asks for a project before offering either write", () => {
    // close_muster_day and reopen_muster_day both take ONE p_project; a column of
    // the ทุกโครงการ grid spans several, so there is no single target to name.
    expect(dayCorrectionControl({ ...base, projectId: null })).toEqual({
      control: "none",
      reason: "noProject",
    });
    expect(dayCorrectionControl({ ...base, projectId: null, dayClosed: true })).toEqual({
      control: "none",
      reason: "noProject",
    });
  });

  it("withholds the control from a role the RPC refuses — per RPC, not in general", () => {
    // The two permissions are separate inputs because they mirror two separate
    // allowlists. A reader who may close but not reopen must still be offered the
    // close on an open day.
    expect(dayCorrectionControl({ ...base, canClose: false })).toEqual({
      control: "none",
      reason: "notPermitted",
    });
    expect(dayCorrectionControl({ ...base, dayClosed: true, canReopen: false })).toEqual({
      control: "none",
      reason: "notPermitted",
    });
    expect(dayCorrectionControl({ ...base, canReopen: false })).toEqual({ control: "close" });
    expect(dayCorrectionControl({ ...base, dayClosed: true, canClose: false })).toEqual({
      control: "reopen",
    });
  });

  it("puts permission ahead of the project prompt", () => {
    // Telling accounting to pick a project would advertise a write it can never
    // perform; the prompt is only actionable for a reader who may act.
    expect(
      dayCorrectionControl({ ...base, projectId: null, canReopen: false, canClose: false }),
    ).toEqual({ control: "none", reason: "notPermitted" });
  });
});

describe("spec 400 U3b — attendanceDayParam", () => {
  it("accepts a date the grid actually drew", () => {
    expect(attendanceDayParam("2026-08-05", DATES)).toBe("2026-08-05");
  });

  it("rejects a date outside the rendered range", () => {
    // Mirrors attendanceWorkerId: an unvalidated value would reach the panel and
    // describe a column that is not on screen.
    expect(attendanceDayParam("2026-01-01", DATES)).toBeNull();
  });

  it("rejects a repeated key and a missing one", () => {
    expect(attendanceDayParam(["2026-08-05", "2026-08-04"], DATES)).toBeNull();
    expect(attendanceDayParam(undefined, DATES)).toBeNull();
  });
});

describe("spec 400 U3b — the panel", () => {
  const props = {
    todayIso: TODAY,
    projectId: "p1",
    canReopen: true,
    canClose: true,
    returnTo: "/team/attendance?start=2026-08-01&end=2026-08-06",
  };

  // ⚠️ EVERY close assertion is ANCHORED, and every one names a discriminator.
  // `ปิดวัน` is a SUBSTRING of `เปิดวัน`, so an unanchored /ปิดวัน/ matches the
  // REOPEN form's own label, its เปิดวันอีกครั้ง button and its ค่าแรง helper —
  // and the two forms carry identical hidden fields. A fresh-eyes pass proved a
  // mutant rendering <MusterReopenForm> in the close arm passed the lot.
  it("offers the close form on an open day, carrying the project-day it names", () => {
    render(<AttendanceDayPanel day={day()} {...props} />);
    const form = screen.getByRole("form", { name: /^ปิดวัน/ });
    expect(form.querySelector('input[name="projectId"]')).toHaveValue("p1");
    expect(form.querySelector('input[name="workDate"]')).toHaveValue("2026-08-04");
    expect(within(form).getByRole("button", { name: /^ปิดวัน$/ })).toBeInTheDocument();
    // The discriminator: the reopen form's required reason must be ABSENT here.
    expect(within(form).queryByLabelText(/เหตุผล/)).toBeNull();
    expect(screen.queryByRole("form", { name: /อีกครั้ง/ })).not.toBeInTheDocument();
  });

  it("discloses BOTH losses before the control, not after it", () => {
    // close_muster_day stamps 17:00 on every open REGULAR session and leaves the
    // open OT ones alone — and no RPC records a past check-out for any role, so
    // an OT session left open is unbookable. The cockpit and the prior-day
    // banner both disclose exactly this; a one-tap close here would re-ship the
    // loss those two surfaces exist to prevent.
    render(
      <AttendanceDayPanel
        day={day()}
        {...props}
        stillIn={{ regular: ["ช่าง หนึ่ง", "ช่าง สอง"], ot: ["ช่าง สาม"] }}
      />,
    );
    const form = screen.getByRole("form", { name: /^ปิดวัน/ });
    expect(within(form).getByText(/ยังไม่เช็คออก.*17:00/)).toBeInTheDocument();
    expect(within(form).getByText(/ช่าง หนึ่ง, ช่าง สอง/)).toBeInTheDocument();
    expect(within(form).getByText(/ไม่บันทึก OT/)).toBeInTheDocument();
    expect(within(form).getByText(/อัตราปัจจุบัน/)).toBeInTheDocument();
    // …and the disclosure precedes the button in DOM order, or it is a
    // disclosure the reader meets after the tap.
    const list = within(form).getByRole("list");
    const button = within(form).getByRole("button", { name: /^ปิดวัน$/ });
    expect(list.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // …and DOM order is the only order. jsdom has no layout engine, so a flex
    // `order-*` utility would move the disclosure below the button VISUALLY with
    // every assertion above still green — the geometry blind spot this repo has
    // paid for twice. Nothing in this form may carry one.
    for (const el of Array.from(form.querySelectorAll("*"))) {
      expect(el.className).not.toMatch(/\border-(?:first|last|none|\d+)\b/);
    }
  });

  it("needs a second deliberate act — the close is never one tap", () => {
    render(<AttendanceDayPanel day={day()} {...props} />);
    const form = screen.getByRole("form", { name: /^ปิดวัน/ });
    expect(within(form).getByRole("checkbox")).toBeRequired();
  });

  it("names no still-in worker when there is none — no empty scare line", () => {
    render(<AttendanceDayPanel day={day()} {...props} />);
    expect(screen.queryByText(/ยังไม่เช็คออก/)).toBeNull();
    expect(screen.queryByText(/ไม่บันทึก OT/)).toBeNull();
  });

  it("offers the reopen form on a closed day, with the reason required at the input", () => {
    render(<AttendanceDayPanel day={day({ dayClosed: true })} {...props} />);
    const form = screen.getByRole("form", { name: /อีกครั้ง/ });
    expect(within(form).getByLabelText(/เหตุผล/)).toBeRequired();
    expect(screen.queryByRole("form", { name: /^ปิดวัน/ })).not.toBeInTheDocument();
  });

  it("does not offer to close TODAY — mid-shift that fabricates the day's end", () => {
    render(<AttendanceDayPanel day={day({ date: TODAY })} {...props} />);
    expect(screen.queryByRole("form", { name: /^ปิดวัน/ })).not.toBeInTheDocument();
    // The header ALSO says ยังอยู่ระหว่างวัน (dayClosureLabel), so the assertion
    // names the whole reason line — matching the header would pass on a panel
    // that renders no explanation at all.
    expect(screen.getByText("ยังอยู่ระหว่างวัน ปิดวันได้เมื่อจบวันแล้ว")).toBeInTheDocument();
  });

  it("still offers to REOPEN today, if today was closed early", () => {
    render(<AttendanceDayPanel day={day({ date: TODAY, dayClosed: true })} {...props} />);
    expect(screen.getByRole("form", { name: /อีกครั้ง/ })).toBeInTheDocument();
  });

  it("renders the close outcome HERE, where the redirect lands the reader", () => {
    // The panel sits below a 42-row table and the redirect anchors on
    // `#d-<date>`, so a banner in the page header is a viewport away — a refusal
    // would read as nothing having happened, with the button still there.
    render(
      <AttendanceDayPanel day={day()} {...props} outcome={{ ok: false, message: "ไม่มีสิทธิ์" }} />,
    );
    expect(screen.getByText("ไม่มีสิทธิ์")).toBeInTheDocument();
  });

  // Each of these arms REPLACES a control, so what is pinned is the presence of
  // the new message — not merely the absence of the form, which an empty render
  // satisfies perfectly. One case each: three renders in one test share a DOM,
  // so a later assertion can pass on an earlier render's output.
  it("names the cause on a day nobody was scanned", () => {
    render(<AttendanceDayPanel day={day({ dayClosed: null, headcount: 0 })} {...props} />);
    expect(screen.getByText("ยังไม่มีบันทึกการเช็คชื่อของวันดังกล่าว")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("asks for a project rather than offering a write with no target", () => {
    render(<AttendanceDayPanel day={day()} {...props} projectId={null} />);
    // ⚠️ The WHOLE control string, not /เลือกโครงการ/: spec 400 U5 added a second,
    // deliberately parallel "เลือกโครงการก่อน จึงจะดูประวัติการแก้ไขได้" for the
    // trail, and an unanchored matcher cannot tell the two apart — it would pass
    // for a panel that had lost this arm entirely.
    expect(screen.getByText("เลือกโครงการก่อน จึงจะปิดหรือเปิดวันดังกล่าวได้")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("names the cause on a day that has not happened yet", () => {
    render(<AttendanceDayPanel day={day({ date: "2026-08-09" })} {...props} />);
    expect(screen.getByText(/ยังมาไม่ถึง/)).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("says nothing at all to a reader who may not act — silence, not a telling-off", () => {
    // notPermitted is the one `none` arm with no copy: the header above already
    // carries the day's state, and accounting does not need to be informed that
    // it may not close muster days.
    render(<AttendanceDayPanel day={day()} {...props} canReopen={false} canClose={false} />);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    // Same anchoring point as above: the CONTROL's own copy, so U5's trail line
    // cannot satisfy — or break — a claim about the correction arm.
    expect(
      screen.queryByText("เลือกโครงการก่อน จึงจะปิดหรือเปิดวันดังกล่าวได้"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/ยังมาไม่ถึง/)).not.toBeInTheDocument();
    // …and the FACT survives.
    expect(screen.getByText(/4 คน/)).toBeInTheDocument();
  });

  it("keeps the FACT when it withholds the CONTROL", () => {
    // Spec 397 U3's rule: a reader who may not act still gets the day's state.
    render(<AttendanceDayPanel day={day({ dayClosed: true })} {...props} canReopen={false} />);
    expect(screen.queryByRole("form", { name: /เปิดวัน/ })).not.toBeInTheDocument();
    expect(screen.getByText(/ปิดวันแล้ว/)).toBeInTheDocument();
    expect(screen.getByText(/4 คน/)).toBeInTheDocument();
  });
});

describe("spec 400 U3b — the column header link", () => {
  const grid = {
    tooWide: false,
    // headcount 7 ≠ the day number 4, so an assertion about one cannot pass on
    // the other — the two are adjacent spans in the same header.
    days: [day({ headcount: 7 }), day({ date: "2026-08-05", dayClosed: true, headcount: 9 })],
    rows: [
      {
        workerId: "w1",
        workerName: "ช่าง หนึ่ง",
        cells: {},
        daysPresent: 0,
        otHoursTotal: 0,
      },
    ],
  };

  it("names the DATE, not the day number — 31 links called 1…31 say nothing", () => {
    render(
      <AttendanceGridView
        grid={grid}
        todayIso={TODAY}
        workerHref={null}
        dayHref={(d) => `/team/attendance?day=${d}`}
      />,
    );
    const link = screen.getByRole("link", { name: /แก้ไขวัน 4 ส\.ค\./ });
    expect(link).toHaveAttribute("href", "/team/attendance?day=2026-08-04");
  });

  it("CARRIES the column's facts in that label instead of replacing them", () => {
    // An author-supplied aria-label wins over its subtree AND becomes the <th>'s
    // accessible name, so a bare `แก้ไขวัน 4 ส.ค. 2569` would strip the headcount
    // and the closure state from what a screen reader announces as the header of
    // all 42 cells — leaving the roles that GOT the control hearing strictly less
    // than the roles that did not.
    render(
      <AttendanceGridView
        grid={grid}
        todayIso={TODAY}
        workerHref={null}
        dayHref={(d) => `/team/attendance?day=${d}`}
      />,
    );
    // Read the attribute directly — a matcher that takes an asymmetric argument
    // it does not support would pass on anything.
    const open = screen.getByRole("link", { name: /แก้ไขวัน 4 ส\.ค\./ });
    expect(open.getAttribute("aria-label")).toContain("7 คน");
    // The closed column carries its closure state too.
    const closed = screen.getByRole("link", { name: /แก้ไขวัน 5 ส\.ค\./ });
    expect(closed.getAttribute("aria-label")).toContain("9 คน");
    expect(closed.getAttribute("aria-label")).toContain("ปิดวันแล้ว");
  });

  it("withholds the LINK, never the column's facts, when the reader may not act", () => {
    // The four audit roles outside both allowlists. A link here would promise a
    // panel whose every control their own server refuses.
    render(<AttendanceGridView grid={grid} todayIso={TODAY} workerHref={null} dayHref={null} />);
    expect(screen.queryByRole("link", { name: /แก้ไขวัน/ })).not.toBeInTheDocument();
    // …and the header still carries the day number and its headcount.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});

describe("spec 400 U3b — where the close form returns to", () => {
  const GRID = "/team/attendance?start=2026-08-01&end=2026-08-06&day=2026-08-04#d-2026-08-04";

  it("puts the outcome in the QUERY, before any fragment", () => {
    // The same defect reopen shipped in review: the panel's own href ends in a
    // fragment, so a naively appended param is swallowed by the hash and the
    // banner becomes dead code.
    const url = new URL(closeReturnTo(GRID, "ok"), "http://x");
    expect(url.searchParams.get("closed")).toBe("1");
    expect(url.hash).toBe("#d-2026-08-04");
    expect(url.searchParams.get("day")).toBe("2026-08-04");
  });

  it("carries a refusal as a CODE, never a sentence", () => {
    const url = new URL(closeReturnTo(GRID, "denied"), "http://x");
    expect(url.searchParams.get("closeError")).toBe("denied");
    expect(url.hash).toBe("#d-2026-08-04");
  });

  it("refuses an off-app returnTo — including the backslash form", () => {
    for (const bad of ["/\\evil.com", "//evil.com", "https://evil.com", "javascript:alert(1)"]) {
      expect(closeReturnTo(bad, "ok")).toBe("/team/attendance?closed=1");
    }
    expect(closeReturnTo(undefined, "ok")).toBe("/team/attendance?closed=1");
  });
});

// ── Spec 400 U6b — the anomaly WORK-LIST, and the loop order ────────────────
//
// Writing failing test first.
//
// The panel's grain is the DAY while every dispute is a WORKER-DAY: it stated
// the day's holes (headcount, the still-in names inside the close disclosure)
// and offered no way to fix any ONE of them. This adds one row per person, each
// a door to that worker-day — and moves ปิดวัน below the work it depends on.

describe("spec 400 U6b — the day panel's work-list", () => {
  const props = {
    todayIso: TODAY,
    projectId: "p1",
    canReopen: true,
    canClose: true,
    returnTo: "/team/attendance?start=2026-08-01&end=2026-08-06",
  };

  // Two OPEN-check-out rows. There is deliberately no unscanned-worker arm — see
  // DayWorkProblem and the exhaustive-domain pin in attendance-fix-doors.test.ts.
  const WORK = [
    { workerId: "a1", workerName: "อนันต์", problem: "openOut" as const },
    { workerId: "s1", workerName: "สมชาย", problem: "openOut" as const },
  ];

  const workItemHref = (workerId: string, date: string) =>
    `/team/attendance/fix?worker=${workerId}&date=${date}`;

  function renderPanel(over: Record<string, unknown> = {}) {
    return render(
      <AttendanceDayPanel
        day={day()}
        {...props}
        workList={WORK}
        workItemHref={workItemHref}
        {...over}
      />,
    );
  }

  it("names each person AND their specific problem", () => {
    renderPanel();
    const list = screen.getByRole("list", { name: /ต้องแก้ไข/ });
    expect(within(list).getByText(/อนันต์ · ยังไม่เช็คออก/)).toBeInTheDocument();
    expect(within(list).getByText(/สมชาย · ยังไม่เช็คออก/)).toBeInTheDocument();
  });

  it("never claims a rostered worker is missing — that is not a day-grain finding", () => {
    // The removed arm would have listed 15 unscheduled people on a fully-closed
    // day (measured live). The panel must not speak that phrase at all.
    renderPanel();
    expect(screen.queryByText(/ไม่มีการเช็คชื่อ/)).toBeNull();
  });

  it("makes each row a link to THAT worker-day", () => {
    renderPanel();
    const list = screen.getByRole("list", { name: /ต้องแก้ไข/ });
    const hrefs = within(list)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/team/attendance/fix?worker=a1&date=2026-08-04",
      "/team/attendance/fix?worker=s1&date=2026-08-04",
    ]);
  });

  it("keeps the FACTS but drops the links for a role that cannot correct", () => {
    // MUSTER_CORRECT_ROLES only — accounting reads this panel and owns the wage
    // consequence of these very holes, so the list is a fact it must keep.
    renderPanel({ workItemHref: null });
    const list = screen.getByRole("list", { name: /ต้องแก้ไข/ });
    expect(within(list).getByText(/อนันต์ · ยังไม่เช็คออก/)).toBeInTheDocument();
    expect(within(list).getByText(/สมชาย · ยังไม่เช็คออก/)).toBeInTheDocument();
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
  });

  it("renders no work-list at all on a clean day", () => {
    renderPanel({ workList: [] });
    expect(screen.queryByRole("list", { name: /ต้องแก้ไข/ })).toBeNull();
  });

  it("puts ปิดวัน BELOW the work-list — fix first, then close", () => {
    // The loop is fix-then-close, so the control that finalises the day must not
    // sit above the work it depends on. ANCHORED matcher + a discriminator:
    // `ปิดวัน` is a substring of `เปิดวันอีกครั้ง`.
    renderPanel();
    const list = screen.getByRole("list", { name: /ต้องแก้ไข/ });
    const closeForm = screen.getByRole("form", { name: /^ปิดวัน/ });
    expect(within(closeForm).queryByLabelText(/เหตุผล/)).toBeNull();
    expect(list.compareDocumentPosition(closeForm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts ปิดวัน BELOW the add-person form too — adding is part of the fixing", () => {
    renderPanel({
      // canCorrect is what makes the add arm render at all; without it this case
      // would have "passed" by finding no add form to compare against.
      canCorrect: true,
      addTeams: [{ teamId: "t1", leadName: "หัวหน้า", headcount: 3 }],
      addWorkers: [{ workerId: "a1", name: "อนันต์" }],
    });
    const addForm = screen.getByRole("form", { name: /เพิ่มคน/ });
    const closeForm = screen.getByRole("form", { name: /^ปิดวัน/ });
    expect(
      addForm.compareDocumentPosition(closeForm) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses DOM order alone — no flex order-* utility anywhere in the panel", () => {
    // jsdom has no layout engine, so an `order-*` class would move ปิดวัน back
    // above the work-list VISUALLY with every assertion above still green.
    const { container } = renderPanel();
    for (const el of Array.from(container.querySelectorAll("*"))) {
      expect(el.className.toString()).not.toMatch(/\border-(?:first|last|none|\d+)\b/);
    }
  });

  it("keeps the work-list ABOVE the trail, which is history rather than work", () => {
    renderPanel({ trail: [] });
    const list = screen.getByRole("list", { name: /ต้องแก้ไข/ });
    const trailHeading = screen.getByText("การแก้ไขย้อนหลัง");
    expect(
      list.compareDocumentPosition(trailHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("spec 400 U6b — the unfinished-day mark on the panel", () => {
  const props = {
    todayIso: TODAY,
    projectId: "p1",
    canReopen: true,
    canClose: true,
    returnTo: "/team/attendance?start=2026-08-01&end=2026-08-06",
  };

  it("states the CONSEQUENCE on a past day nobody closed, which the header does not", () => {
    // The header already says ยังไม่ปิดวัน in neutral ink. What it does not say is
    // why that matters — the wages of the day are unbooked until someone closes
    // it. That sentence is the whole point of the amber, not a second copy of the
    // closure label.
    render(<AttendanceDayPanel day={day({ dayClosed: false })} {...props} />);
    // Queried by TEXT, not by role="status": static server-rendered prose is not a
    // live region, and the grid above already carries one for the same fact — with
    // ?day= on an unfinished date both would have announced.
    expect(screen.getByText(/ค่าแรงของวันดังกล่าวยังไม่ถูกบันทึก/)).toBeInTheDocument();
  });

  it("shows no mark on a CLOSED day", () => {
    render(<AttendanceDayPanel day={day({ dayClosed: true })} {...props} />);
    expect(screen.queryByText(/ค่าแรงของวันดังกล่าวยังไม่ถูกบันทึก/)).toBeNull();
  });

  it("shows no mark on TODAY, whose open day is normal", () => {
    render(<AttendanceDayPanel day={day({ date: TODAY, dayClosed: false })} {...props} />);
    expect(screen.queryByText(/ค่าแรงของวันดังกล่าวยังไม่ถูกบันทึก/)).toBeNull();
  });

  it("shows no mark on a day with no attendance at all", () => {
    render(<AttendanceDayPanel day={day({ dayClosed: null, headcount: 0 })} {...props} />);
    expect(screen.queryByText(/ค่าแรงของวันดังกล่าวยังไม่ถูกบันทึก/)).toBeNull();
  });

  it("shows the mark to a reader who cannot close — it is a fact about the day", () => {
    render(
      <AttendanceDayPanel
        day={day({ dayClosed: false })}
        {...props}
        canReopen={false}
        canClose={false}
      />,
    );
    expect(screen.getByText(/ค่าแรงของวันดังกล่าวยังไม่ถูกบันทึก/)).toBeInTheDocument();
  });

  it("claims nothing about a REOPEN — the panel cannot know one happened", () => {
    render(<AttendanceDayPanel day={day({ dayClosed: false })} {...props} />);
    expect(screen.getByText(/ค่าแรงของวันดังกล่าวยังไม่ถูกบันทึก/).textContent).not.toMatch(
      /เปิดวันอีกครั้ง/,
    );
  });
});
