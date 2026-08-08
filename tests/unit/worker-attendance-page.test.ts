// Spec 374 U1 — source pins for the attendance-calendar page + its doors.
// The page is a Server Component vitest cannot render, so the load-bearing
// wiring is pinned by comment-stripped source scan (≥2 occurrences = import
// PLUS a real use — a bare toContain is satisfied by the import line alone).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
// Strip line + block comments so a comment QUOTING a symbol cannot satisfy a
// presence pin (doctrine: the comment-quotes-the-string trap).
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const uses = (src: string, needle: string) => src.split(needle).length - 1;

const PAGE = "src/app/workers/[workerId]/attendance/page.tsx";
const LOADER = "src/lib/attendance/load-worker-attendance.ts";
const ROSTER = "src/components/features/labor/worker-roster-manager.tsx";

describe("worker attendance page wiring (spec 374 U1)", () => {
  it("page gates on WORKER_ROSTER_ROLES via requireRole", () => {
    const src = stripComments(read(PAGE));
    expect(uses(src, "requireRole")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "WORKER_ROSTER_ROLES")).toBeGreaterThanOrEqual(2);
  });

  it("page resolves its back chip via safeBackHref and renders DetailHeader", () => {
    const src = stripComments(read(PAGE));
    expect(uses(src, "safeBackHref")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "DetailHeader")).toBeGreaterThanOrEqual(2);
  });

  it("page loads through the loader and builds the month view-model", () => {
    const src = stripComments(read(PAGE));
    expect(uses(src, "loadWorkerAttendance")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "buildAttendanceMonth")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "WorkerAttendanceCalendar")).toBeGreaterThanOrEqual(2);
  });

  it("month steppers preserve the ?from referrer (chip survives month paging)", () => {
    const src = stripComments(read(PAGE));
    // The literal query-string append is the load-bearing part — a builder
    // NAMED withFrom that drops the param would keep a name-count green.
    expect(uses(src, "&from=")).toBeGreaterThanOrEqual(1);
    expect(uses(src, "withFrom")).toBeGreaterThanOrEqual(3);
  });

  it("guards the worker id shape and clamps the month param", () => {
    const src = stripComments(read(PAGE));
    expect(uses(src, "isValidUuid")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "notFound")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "resolveMonthAnchor")).toBeGreaterThanOrEqual(2);
  });

  it("loader is server-only and reads via the admin client", () => {
    const src = stripComments(read(LOADER));
    expect(uses(src, "server-only")).toBeGreaterThanOrEqual(1);
    expect(uses(src, "@/lib/db/admin")).toBeGreaterThanOrEqual(1);
    expect(uses(src, "canSeeStandardRate")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "paidRowsFromLaborLogs")).toBeGreaterThanOrEqual(2);
  });

  it("loader re-applies membership scoping for viewers outside the see-all set", () => {
    const src = stripComments(read(LOADER));
    expect(uses(src, "viewerSeesAllMusterProjects")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "project_members")).toBeGreaterThanOrEqual(1);
    expect(uses(src, "project_lead_id")).toBeGreaterThanOrEqual(1);
    // The filter must target the muster read's embedded team project.
    expect(uses(src, "muster_teams.project_id")).toBeGreaterThanOrEqual(1);
  });

  it("roster row carries the calendar door with the ?from referrer", () => {
    const src = stripComments(read(ROSTER));
    expect(uses(src, "/attendance?from=/workers")).toBeGreaterThanOrEqual(1);
    expect(uses(src, "ATTENDANCE_CALENDAR_LABEL")).toBeGreaterThanOrEqual(2);
  });

  it("payroll row door renders ONLY for the calendar page's own audience (U1b)", () => {
    // /payroll admits `accounting` (PAYROLL_VIEW_ROLES), the calendar's gate
    // does not — an unconditional door would be affordance-then-refuse.
    const src = stripComments(read("src/app/payroll/page.tsx"));
    expect(uses(src, "/attendance?from=/payroll")).toBeGreaterThanOrEqual(1);
    expect(uses(src, "WORKER_ROSTER_ROLES")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "canOpenCalendar")).toBeGreaterThanOrEqual(2);
  });
});

// ── Spec 404 U2 — the fix panel, on this page ────────────────────────────────
//
// Writing failing test first. These live at the PAGE because the ROLE GATE, the
// read, the project resolution and the two-band layout are all decided here; the
// component test can only prove that a builder it was handed gets called.
//
// U6b's block was REPLACED rather than extended: the door no longer navigates to
// `/team/attendance/fix`, so its assertions (fixHref, the threaded referrer, the
// `projectId: null`) pin a design this unit retires. The reasoning behind each is
// carried into its successor below.

describe("spec 404 U2 — the calendar's in-page fix panel", () => {
  const pageSrc = () => stripComments(read(PAGE));

  it("gates the panel on MUSTER_CORRECT_ROLES, not on the page's own gate", () => {
    // WORKER_ROSTER_ROLES (this page's gate) is not the correction audience.
    // Both the DOOR and the `?fix=` READ hang off canCorrect: a hand-typed URL
    // is exactly how affordance-then-refuse would otherwise arrive.
    const src = pageSrc();
    expect(uses(src, "MUSTER_CORRECT_ROLES")).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/canCorrect\s*=\s*MUSTER_CORRECT_ROLES\.includes\(ctx\.role\)/);
    expect(src).toMatch(/const dayFixHref = canCorrect \?/);
    expect(src).toMatch(/canCorrect\s*\n?\s*\?\s*calendarFixTarget\(fix, monthAnchor\)/);
  });

  it("opens the panel on its OWN route — no link out to /team/attendance/fix", () => {
    // The round trip out to a route and back was most of the cost the U7
    // measurement found (the 07-24 correction was 10 edits across 9 people in 4
    // minutes). The route itself stays alive for links already in the wild.
    const src = pageSrc();
    expect(src).not.toContain("/team/attendance/fix");
    expect(src).not.toContain("fixHref");
    expect(uses(src, "&fix=")).toBeGreaterThanOrEqual(1);
  });

  it("every panel link keeps the VIEWED month, so opening one cannot move it", () => {
    // U1's own lost-month bug: a builder that dropped `m=` sent a July auditor
    // to August. `panelHref` is the single home for the panel's URL, so the
    // month is threaded once rather than at four call sites.
    const src = pageSrc();
    const decl = src.slice(src.indexOf("const panelHref"));
    const body = decl.slice(0, decl.indexOf(";\n") + 1);
    expect(body).toContain("withFrom(monthAnchor)");
    expect(body).not.toContain("bangkokTodayIso");
    // The steppers, the close link and every write's returnTo all go through it.
    expect(uses(src, "panelHref(")).toBeGreaterThanOrEqual(5);
  });

  it("month steppers do NOT carry ?fix= into the next month", () => {
    // The target is bounded to the month on screen, so a carried-over ?fix=
    // would land as the `outside` refusal — an error notice a reader paging
    // months never asked for.
    const src = pageSrc();
    const prev = src.slice(src.indexOf("const prevHref"), src.indexOf("const nextHref"));
    expect(prev).toContain("withFrom(");
    expect(prev).not.toContain("fix");
  });

  it("resolves the panel's project through fixPanelProjectId, never by guessing", () => {
    // The DAY owns the project; an empty day borrows the month's ONLY project
    // and gets nothing when the month is split. Guessing there would book a
    // wage against the wrong project.
    const src = pageSrc();
    expect(uses(src, "fixPanelProjectId")).toBeGreaterThanOrEqual(2);
    expect(src).toContain("cellProjectId: month.cells[openDate]?.projectId ?? null");
    expect(src).toContain("projectParam: fixProjectId");
  });

  it("reads the worker-day ONLY when a panel is open", () => {
    // Five round trips (worker, detail RPC, closure, team list, trail) must not
    // ride every month view. `openDate === null` short-circuits ahead of the
    // await, so a closed panel costs nothing.
    const src = pageSrc();
    expect(uses(src, "loadWorkerDayFix")).toBeGreaterThanOrEqual(2);
    const decl = src.slice(src.indexOf("const fixData"));
    expect(decl.slice(0, decl.indexOf("});"))).toMatch(/openDate === null\s*\n?\s*\?\s*null/);
  });

  it("renders the U7 panel component rather than a second copy of that screen", () => {
    // Spec 400 U7 extracted it for exactly this reason: the reopen form was
    // copied once and drifted on three details before it was pulled into one
    // component. The queue slot carries the day steppers.
    const src = pageSrc();
    expect(uses(src, "WorkerDayFixPanel")).toBeGreaterThanOrEqual(2);
    expect(src).toContain("queue={");
  });

  it("names the AXIS on the day steppers — never bare chevrons", () => {
    // The grid's identical control walks the next PERSON within a day; here it
    // walks the next DAY for one person. Same component, opposite meaning.
    const src = pageSrc();
    expect(uses(src, "วันก่อนหน้า")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "วันถัดไป")).toBeGreaterThanOrEqual(2);
    expect(uses(src, "fixStepDates")).toBeGreaterThanOrEqual(2);
  });

  it("splits the two bands at md, and the phone band REPLACES the calendar", () => {
    // The operator ruled tablet == desktop. An `lg:` split would appear in
    // landscape and vanish in portrait on the same iPad. Below `md` the panel
    // takes the whole width, so the calendar is hidden rather than squeezed.
    const src = pageSrc();
    expect(src).toContain("md:flex-row");
    expect(src).toContain('"hidden md:block"');
    expect(uses(src, "md:w-[300px]")).toBeGreaterThanOrEqual(2);
    // Not lg — the whole point of the ruling.
    expect(src).not.toContain("lg:flex-row");
    expect(src).not.toContain("hidden lg:block");
  });

  it("adds NO independent scroller to the panel", () => {
    // A scrolling panel is a NEW scroller, and this repo has shipped two
    // opposite touch-action bugs on those. The page scrolls instead.
    const src = pageSrc();
    expect(src).not.toContain("overflow-y-auto");
    expect(src).not.toContain("overflow-y-scroll");
  });

  it("reads every outcome through the shared reader, with the shared copy", () => {
    // A CODE in the query, never a sentence. The reader moved to
    // `outcome-copy.ts` when this became the second surface reading it back.
    const src = pageSrc();
    expect(uses(src, "readOutcome")).toBeGreaterThanOrEqual(5);
    for (const copy of [
      "RETIME_ERROR_COPY",
      "UNDO_ERROR_COPY",
      "ADD_ERROR_COPY",
      "REOPEN_ERROR_COPY",
    ]) {
      expect(uses(src, copy)).toBeGreaterThanOrEqual(2);
    }
  });

  it("states the two permanent refusals, and neither promises a retry", () => {
    // §6 cases 1–3. `ลองใหม่` on a URL that can never work is the honest-copy
    // class this repo ratchets against.
    const src = pageSrc();
    expect(src).toContain("วันที่เลือกไม่อยู่ในเดือนนี้");
    expect(src).toContain("เปิดจากหน้าตารางเช็คชื่อแทน");
    expect(src).not.toContain("ลองใหม่");
  });
});

describe("spec 404 U2 — the shared outcome reader", () => {
  it("lives beside the sentences it selects, and /team/attendance uses it too", () => {
    // Two surfaces now read the same six params back from the same five
    // actions. A second copy of the parse would be the drift OUT_LOCKED_COPY
    // exists to prevent, one layer down — in the half that decides whether an
    // error is SHOWN at all.
    const copy = stripComments(read("src/lib/muster/outcome-copy.ts"));
    expect(copy).toContain("export function readOutcome");
    expect(copy).toContain("export function firstParam");
    const grid = stripComments(read("src/app/team/attendance/page.tsx"));
    expect(uses(grid, "readOutcome")).toBeGreaterThanOrEqual(5);
    // …and no longer carries its own.
    expect(grid).not.toContain("const fixOutcome =");
  });
});
