// Writing failing test first.
//
// Spec 400 U6b — the GRID half of the three doors: anomaly and gap cells become
// links to the U6a fix screen, and a past day nobody closed is named in an amber
// banner above the table.
//
// Rendered for real rather than source-scanned, because U1 paid for that lesson
// twice in this very component: a `toContain` on a predicate that appears three
// times in the file pins nothing, and `{shape === "grid" && (` -> `{false && (`
// stayed green.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AttendanceGridView } from "@/components/features/muster/attendance-grid-view";
import { buildAttendanceGrid, type AttendanceGridInput } from "@/lib/muster/attendance-grid";
import type { AttendanceDetailRow } from "@/lib/muster/attendance-audit";

const WORKER = "aaaaaaaa-1111-1111-1111-111111111111";
const PROJECT = "bbbbbbbb-2222-2222-2222-222222222222";

function row(over: Partial<AttendanceDetailRow> = {}): AttendanceDetailRow {
  const workDate = over.workDate ?? "2026-08-03";
  return {
    workerId: WORKER,
    workerName: "สมชาย",
    projectId: PROJECT,
    projectName: "TFM โพธิ์ทอง",
    workDate,
    session: "regular",
    inAt: `${workDate}T01:00:00+00:00`,
    inTime: "08:00",
    inMethod: "qr",
    outAt: `${workDate}T10:00:00+00:00`,
    outTime: "17:00",
    outMethod: "qr",
    outAuto: false,
    otHours: null,
    scannedBy: "u1",
    scannedByName: "อรปรีญา",
    teamLeadName: "หัวหน้า",
    dayClosed: true,
    stillIn: false,
    outNextDay: false,
    ...over,
  };
}

/** The fix-screen link builder the page passes down. Returns a distinctive,
 *  greppable href so a test can tell WHICH worker-day a cell aimed at. */
const cellFixHref = (workerId: string, date: string) =>
  `/team/attendance/fix?worker=${workerId}&date=${date}&from=%2Fteam%2Fattendance`;

function renderGrid(
  over: Partial<AttendanceGridInput> = {},
  props: {
    cellFixHref?: ((workerId: string, date: string) => string) | null;
    canFixGaps?: boolean;
    todayIso?: string;
  } = {},
) {
  const grid = buildAttendanceGrid({
    from: "2026-08-03",
    to: "2026-08-05",
    rows: [row()],
    holidays: [],
    ...over,
  });
  return render(
    <AttendanceGridView
      grid={grid}
      todayIso={props.todayIso ?? "2026-08-07"}
      workerHref={null}
      dayHref={(date) => `/team/attendance?day=${date}#d-${date}`}
      // `in`, NOT `??`: nullish-coalescing treats an explicit `null` as absent,
      // so `{cellFixHref: null}` silently handed back the default builder and the
      // "no link for this role" case passed against a fully linked grid. The
      // instrument, not the component, was what failed.
      cellFixHref={"cellFixHref" in props ? props.cellFixHref! : cellFixHref}
      canFixGaps={props.canFixGaps ?? true}
    />,
  );
}

/** Every fix-screen link on screen, by href. */
function fixLinks(): HTMLAnchorElement[] {
  return screen
    .getAllByRole("link")
    .filter((a): a is HTMLAnchorElement =>
      (a.getAttribute("href") ?? "").startsWith("/team/attendance/fix"),
    );
}

describe("grid cells as fix-screen doors", () => {
  it("links a cell whose session carries a finding, at that worker and that date", () => {
    renderGrid({ rows: [row({ workDate: "2026-08-03", outAt: null, outTime: null })] });
    const hrefs = fixLinks().map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(
      `/team/attendance/fix?worker=${WORKER}&date=2026-08-03&from=%2Fteam%2Fattendance`,
    );
  });

  it("does NOT link a clean session cell", () => {
    renderGrid({ rows: [row()] });
    // The one cell on screen with a session is clean; the only fix links may be
    // the gap cells of the other two days.
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("date=2026-08-03"))).toBe(false);
  });

  it("links an EMPTY cell on a working day that has a team", () => {
    // 08-03 has a session (headcount 1); 08-04 is empty for this worker but the
    // day itself has no rows at all, so use a second worker to give it a team.
    renderGrid({
      rows: [
        row({ workDate: "2026-08-04" }),
        row({ workDate: "2026-08-04", workerId: "w2", workerName: "ข" }),
        row({ workDate: "2026-08-03", workerId: "w2", workerName: "ข" }),
      ],
    });
    // WORKER has no 08-03 cell but 08-03 has a team (w2 was there) -> a gap link.
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toContain(
      `/team/attendance/fix?worker=${WORKER}&date=2026-08-03&from=%2Fteam%2Fattendance`,
    );
  });

  it("renders NO fix link at all for a role without the correction capability", () => {
    // `null` withholds the LINK, never the facts.
    // ⚠️ Spec 400 U6c made MUSTER_CORRECT_ROLES equal to ATTENDANCE_AUDIT_ROLES, so
    // no live role is withheld today — this drives the prop directly, which is what
    // keeps the branch covered against the narrowing the operator reserved. Until
    // then project_manager and project_director were refused by every correction
    // RPC with 42501 and a link would have been affordance-then-refuse.
    renderGrid({ rows: [row({ outAt: null, outTime: null })] }, { cellFixHref: null });
    expect(fixLinks()).toHaveLength(0);
  });

  it("keeps every FACT for the role that gets no link", () => {
    // Withholding a control must not withhold a fact (spec 397 U3). The VISIBLE
    // cell must read identically with and without the link — the anomaly dot and
    // the check-in time are facts, not affordances.
    const withLink = renderGrid({ rows: [row({ outAt: null, outTime: null })] });
    const linkedCells = screen.getAllByRole("cell").map((c) => c.textContent);
    withLink.unmount();

    renderGrid({ rows: [row({ outAt: null, outTime: null })] }, { cellFixHref: null });
    expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual(linkedCells);
  });

  it("names the anomaly in the link's accessible name, not colour alone", () => {
    // A red/amber mark must never be the only carrier of meaning, and the U3b
    // lesson is that an author-supplied aria-label REPLACES the subtree — so the
    // label has to carry every fact it displaces.
    renderGrid({ rows: [row({ outAt: null, outTime: null })] });
    const name = fixLinks()[0]!.getAttribute("aria-label") ?? "";
    expect(name).toContain("สมชาย");
    expect(name).toContain("ยังไม่เช็คออก");
    expect(name).toContain("08:00");
  });

  it("does not announce a linked cell twice — the cell's name comes from the link", () => {
    // Both an aria-label on the <td> AND one on its link would read the whole
    // story twice per cell, 546 times. The link owns the name; the td drops its
    // own, exactly as DayHeader's <th> does.
    renderGrid({ rows: [row({ outAt: null, outTime: null })] });
    const linkedCell = fixLinks()[0]!.closest("td")!;
    expect(linkedCell.hasAttribute("aria-label")).toBe(false);
  });

  it("keeps the aria-label on an UNLINKED cell, where nothing else carries it", () => {
    renderGrid({ rows: [row({ outAt: null, outTime: null })] }, { cellFixHref: null });
    expect(screen.getByLabelText(/สมชาย.*ยังไม่เช็คออก/)).toBeInTheDocument();
  });

  it("carries a text line on a gap cell, so the door is not an invisible tap target", () => {
    renderGrid({
      rows: [
        row({ workDate: "2026-08-04" }),
        row({ workDate: "2026-08-03", workerId: "w2", workerName: "ข" }),
      ],
    });
    const gap = fixLinks().find((a) => (a.getAttribute("href") ?? "").includes("2026-08-03"))!;
    expect(gap.textContent?.trim()).not.toBe("");
  });

  it("does NOT link gap cells when no project is picked", () => {
    renderGrid(
      {
        rows: [
          row({ workDate: "2026-08-04" }),
          row({ workDate: "2026-08-03", workerId: "w2", workerName: "ข" }),
        ],
      },
      { canFixGaps: false },
    );
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes(`worker=${WORKER}&date=2026-08-03`))).toBe(false);
  });

  it("does NOT link a gap cell on a non-working day", () => {
    // 2026-08-09 is a Sunday.
    renderGrid({
      from: "2026-08-08",
      to: "2026-08-09",
      rows: [
        row({ workDate: "2026-08-08" }),
        row({ workDate: "2026-08-09", workerId: "w2", workerName: "ข" }),
      ],
    });
    const hrefs = fixLinks().map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("date=2026-08-09"))).toBe(false);
  });
});

describe("the unfinished-day banner", () => {
  const UNCLOSED = { rows: [row({ workDate: "2026-08-03", dayClosed: false })] };

  it("names a past day nobody closed, and links it to that day's panel", () => {
    renderGrid(UNCLOSED);
    const banner = screen.getByLabelText("วันที่ยังไม่ปิด");
    expect(banner).toHaveTextContent("3 ส.ค.");
    // The link goes to the ?day= PANEL, which is where ปิดวัน lives — not to the
    // per-worker fix screen, which cannot close a day.
    const link = within(banner)
      .getAllByRole("link")
      .find((a) => (a.getAttribute("href") ?? "").includes("day=2026-08-03"));
    expect(link).toBeDefined();
  });

  it("renders NO banner when every past day is closed", () => {
    // The live shape 2026-08-07: 13 past days, all closed.
    renderGrid({ rows: [row({ workDate: "2026-08-03", dayClosed: true })] });
    expect(screen.queryByLabelText("วันที่ยังไม่ปิด")).toBeNull();
  });

  it("renders NO banner for TODAY's own open day", () => {
    // The cry-wolf line: the default range always includes today, so an unclosed
    // today must not be a finding or the banner is permanent.
    renderGrid(
      { rows: [row({ workDate: "2026-08-05", dayClosed: false })] },
      { todayIso: "2026-08-05" },
    );
    expect(screen.queryByLabelText("วันที่ยังไม่ปิด")).toBeNull();
  });

  it("renders NO banner for a day with no attendance at all", () => {
    // dayClosed === null. Live, 2026-08-06 carries zero rows.
    //
    // ⚠️ The range spans TWO days with rows on the first, so 08-04 is a genuine
    // past column whose dayClosed is null. An earlier draft passed `rows: []`,
    // which hits the `grid.rows.length === 0` early return — only EmptyNotice
    // rendered, so the assertion could not fail whatever unfinishedDays did.
    renderGrid({ from: "2026-08-03", to: "2026-08-04", rows: [row({ workDate: "2026-08-03" })] });
    // The grid really did draw the empty column…
    expect(screen.getAllByRole("columnheader")).toHaveLength(3); // ช่าง + 2 days
    // …and the null-closure day is not called unfinished.
    expect(screen.queryByLabelText("วันที่ยังไม่ปิด")).toBeNull();
  });

  it("states the finding in WORDS, not only in amber", () => {
    renderGrid(UNCLOSED);
    const banner = screen.getByLabelText("วันที่ยังไม่ปิด");
    // "reopened" is NOT claimed: the grid carries no reopen history, so the copy
    // names what the data supports — a past day that is still open.
    expect(banner).toHaveTextContent(/ยังไม่ปิด/);
    expect(banner.textContent).not.toMatch(/เปิดวันอีกครั้ง/);
  });

  it("shows the banner to a role that cannot correct, because it is a FACT", () => {
    // The banner reports the state of the DAY. Withholding it from a reader who
    // cannot act would withhold a fact, not a control — and closing is
    // MUSTER_CLOSE_ROLES anyway, a different set from the cell links.
    renderGrid(UNCLOSED, { cellFixHref: null });
    expect(screen.getByLabelText("วันที่ยังไม่ปิด")).toHaveTextContent(/ยังไม่ปิด/);
  });
});
