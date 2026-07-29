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
