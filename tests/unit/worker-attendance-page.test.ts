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
    //
    // ⚠️ The first version of this test sliced from `const prevHref` to
    // `const nextHref` — ONE line — while the property it claims to check lives
    // in `withFrom`'s BODY, which is declared above that slice. Appending
    // `&fix=` inside `withFrom` kept it green (and would have doubled the param
    // in `panelHref`). A fresh-eyes pass caught it. The slice now spans the
    // builder AND both call sites.
    const src = pageSrc();
    const span = src.slice(src.indexOf("const withFrom"), src.indexOf("const panelHref"));
    expect(span).toContain("const prevHref");
    expect(span).toContain("const nextHref");
    expect(span).not.toContain("fix");
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
    // The BAND is md; the panel's WIDTH steps at lg, and that is a measurement,
    // not a second breakpoint: at 834 a 300px panel leaves a 68px column whose
    // 60px of usable width is narrower than `07:42–18:00` (~70px at 10px), so
    // the merged line wrapped back into the two lines the compaction exists to
    // remove — through the whole 768–1000 range.
    //
    // U2b raised the lg width 300 → 340: measured in real Chrome, 340 still
    // leaves ~108px per calendar column at 1194 (the cell needs 60), and the
    // panel is where the width was actually short — its reopen reason input
    // gained 60px of usable width, from 188 to 248.
    // U2c raised the `md` width 280 → 300: at 280 the panel's time field is
    // 102px against a 108px native control (design font, padding already at
    // `px-1`) and would clip. Measured at 768/834/900 across 280/300/320/340,
    // 300 costs the grid nothing — cells wrapped 1/3, 1/3, 0/3, identical to
    // 280 — while 320 would have pushed 768 to 3/3.
    expect(src).toContain("md:w-[300px]");
    expect(src).toContain("lg:w-[340px]");
    // Not lg for the SPLIT — the whole point of the operator's ruling.
    expect(src).not.toContain("lg:flex-row");
    expect(src).not.toContain("hidden lg:block");
  });

  it("wires the blank-day doors into BOTH the grid and the steppers (spec 404 U2b)", () => {
    // ⚠️ This exists because a mutation found the gap. Deleting the merge in
    // `doorDates` — so the blank doors reach the grid but NOT `fixStepDates` —
    // left the whole suite green: `calendarBlankDayFixable` is pinned as a pure
    // function and `fixStepDates` is pinned over a fixture, but the PAGE is what
    // joins them, and no test could see it. The recorded lesson, again: page-level
    // wiring needs a page-level test, because a suite that drives only the pure
    // halves is structurally blind to the seam between them.
    //
    // The consequence of that mutant is not cosmetic. The blank cell would still
    // link, but stepping off the day beside it would SKIP it — so the one day in
    // the month with something to correct becomes the one day the walk avoids,
    // and `fixStepDates`' own stated invariant (the grid and the steppers never
    // disagree about what this month holds) is quietly false.
    const src = stripComments(read(PAGE));
    expect(uses(src, "calendarBlankDayFixable")).toBeGreaterThanOrEqual(2);
    // Anchored on where the value ENDS, so a later edit cannot keep the symbol
    // while dropping either source (an unanchored pin passes on both halves).
    expect(src).toMatch(
      /const doorDates = \[\s*\.\.\.Object\.keys\(month\.cells\),\s*\.\.\.blankFixDates,?\s*\];/,
    );
    // …and the same set reaches the grid, or only the steppers would know.
    expect(src).toMatch(/blankFixDates=\{blankFixDates\}/);
  });

  it("withholds a blank door on a day the VIEWER simply cannot see (spec 404 U2b)", () => {
    // ⚠️ Added because a mutation found it unguarded — the second seam in this
    // page with no page-level pin, after `doorDates`.
    //
    // A cell is blank for two different reasons and they look identical here:
    // the worker has no row, or `loadWorkerAttendance`'s membership scoping hid
    // one. `project_manager` sits in this page's gate AND in the correction
    // audience but NOT in `viewerSeesAllMusterProjects`, so for a PM who is a
    // member of one project only, a day the worker spent elsewhere renders blank
    // while the month still names exactly one project — and the headcount rule
    // would offer a door on it. `muster_correct_session` looks the existing row
    // up by `worker_id + work_date + session` with no project predicate, so the
    // add would take the UPDATE path and refuse on press with "worker is in
    // another team today — move first". Dropping this filter restores exactly
    // that offer-then-refuse.
    const src = stripComments(read(PAGE));
    expect(uses(src, "loadWorkerMusterDates")).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/\.filter\(\(date\) => !workerMusterDates\.has\(date\)\)/);
  });

  it("buys the blank-door read ONLY when a door could be offered (spec 404 U2b)", () => {
    // An unconditional per-project headcount read would cost every reader of
    // every month a query they can make no use of: the door needs BOTH the
    // correction gate and an unambiguous month (an empty day of a split month
    // has two possible owners, so `fixPanelProjectId` supplies none).
    const src = stripComments(read(PAGE));
    expect(src).toMatch(/canCorrect && monthProjectIds\.length === 1/);
    expect(uses(src, "loadProjectHeadcountByDate")).toBeGreaterThanOrEqual(2);
    // …and the rule is HANDED that gate rather than a literal. A hardcoded
    // `true` here is behaviourally equivalent today — the headcount map is empty
    // when no project resolved, so the other arm refuses anyway — which is
    // exactly why no behavioural test can catch it and why this pin is a source
    // scan. It matters because it leaves `gridCellFixable`'s `canFixGaps` arm
    // DEAD at its only call site: the rule would claim a decision something else
    // was making, and the day the headcount read changes shape, doors would be
    // offered with no project to book against.
    expect(src).toMatch(/projectResolvable: blankDoorProjectId !== null/);
  });

  it("adds NO independent scroller to the panel", () => {
    // A scrolling panel is a NEW scroller, and this repo has shipped two
    // opposite touch-action bugs on those. The page scrolls instead.
    //
    // ⚠️ The axis-less forms are listed too: `overflow-auto` creates exactly the
    // same scroller as `overflow-y-auto`, and a guard that names only the
    // y-forms reads as coverage while permitting the thing it forbids.
    const src = pageSrc();
    for (const banned of [
      "overflow-y-auto",
      "overflow-y-scroll",
      "overflow-auto",
      "overflow-scroll",
    ]) {
      expect(src).not.toContain(banned);
    }
  });

  it("threads the RESOLVED project through the panel's own returnTo only", () => {
    // Deleting the last session of a single-day month otherwise re-renders with
    // no cell project and an empty month set — no closure state, no add form, no
    // trail, immediately after the only destructive action, with no way to
    // re-add the person just removed. `/team/attendance/fix` documents that dead
    // end and threads the resolved id for exactly this reason.
    const src = pageSrc();
    expect(uses(src, "fixp")).toBeGreaterThanOrEqual(3);
    expect(src).toContain("&fixp=${fixData.projectId}");
    expect(src).toContain("paramProjectId");
    // …and it is shape-validated, like every other id this page takes.
    expect(src).toMatch(/isValidUuid\(fixpRaw\)/);
    // ⚠️ NOT on the steppers: the next day may belong to another project in a
    // split month, and a carried param outranks the day's own.
    const strip = src.slice(src.indexOf("queue={"), src.indexOf("ปิดหน้าต่างแก้ไข"));
    expect(strip).not.toContain("fixp");
  });

  it("does not hand the panel copy that names a control this route lacks", () => {
    // `เลือกโครงการก่อน จึงจะ…` is true where a project CAN be chosen — the fix
    // route takes ?project=, the grid sits under a picker. This page has neither
    // picker, so the shared component takes an override naming what IS
    // actionable here.
    const src = pageSrc();
    expect(src).toContain("noProjectHint=");
    expect(src).not.toContain("เลือกโครงการก่อน");
    const panel = stripComments(read("src/components/features/muster/worker-day-fix-panel.tsx"));
    // The route's own three distinct sentences survive as the default — an
    // override, never a generic replacement.
    expect(panel.split("เลือกโครงการก่อน จึงจะ").length - 1).toBe(3);
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
