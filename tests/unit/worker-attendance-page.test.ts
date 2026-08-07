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

// ── Spec 400 U6b — the calendar's door into the fix screen ───────────────────
//
// Writing failing test first. These live at the PAGE because the ROLE GATE and
// the month threading are decided here; the component test can only prove that a
// builder it was handed gets called.

describe("spec 400 U6b — the calendar's fix-screen door", () => {
  it("gates the day links on MUSTER_CORRECT_ROLES, not on the page's own gate", () => {
    // WORKER_ROSTER_ROLES (this page's gate) contains project_manager and
    // project_director; muster_correct_session refuses both with 42501. Handing
    // them a link would be affordance-then-refuse.
    const src = stripComments(read(PAGE));
    expect(uses(src, "MUSTER_CORRECT_ROLES")).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/dayFixHref\s*=\s*MUSTER_CORRECT_ROLES\.includes\(ctx\.role\)/);
  });

  it("passes the builder to the calendar, rather than merely declaring it", () => {
    const src = stripComments(read(PAGE));
    expect(src).toContain("dayFixHref={dayFixHref}");
  });

  it("builds the href through the shared fixHref, not a hand-rolled query", () => {
    const src = stripComments(read(PAGE));
    expect(uses(src, "fixHref")).toBeGreaterThanOrEqual(2);
  });

  it("threads the AUDITED month into the referrer, never the current one", () => {
    // U1's own lost-month bug, from the other direction: `withFrom(monthAnchor)`
    // carries the month on screen. `withFrom(bangkokTodayIso())` — or a bare
    // `base` — would send a July auditor back to August.
    const src = stripComments(read(PAGE));
    const decl = src.slice(src.indexOf("const dayFixHref"));
    const body = decl.slice(0, decl.indexOf(": null;") + 7);
    expect(body).toContain("withFrom(monthAnchor)");
    expect(body).not.toContain("bangkokTodayIso");
  });

  it("sends NO project — this calendar has none to send", () => {
    // AttendanceDayCell carries projectName, not a project id, so the fix screen
    // infers the project from the session. An invented `?project=` would be a
    // guess, and a wrong uuid fails parseFixParams outright.
    const src = stripComments(read(PAGE));
    const decl = src.slice(src.indexOf("const dayFixHref"));
    const body = decl.slice(0, decl.indexOf(": null;") + 7);
    expect(body).toContain("projectId: null");
  });
});
