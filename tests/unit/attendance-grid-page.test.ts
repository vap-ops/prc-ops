// Spec 400 U1 — the PAGE-level wiring the component tests are structurally
// blind to. `/team/attendance/page.tsx` is a Server Component: the view toggle,
// which client reads the holidays, and where a worker name actually points all
// live here, and spec 397 U3 shipped two dead banners for exactly this reason
// ("7,103 green tests could not see it: every test rendered the CHILD").
//
// Source scan, comments STRIPPED first — a comment quoting the very string an
// assertion looks for satisfies that assertion, which is how a guard ends up
// pinning its own documentation (spec 313 U2b).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ATTENDANCE_AUDIT_ROLES, WORKER_ROSTER_ROLES } from "@/lib/auth/role-home";

const PAGE = join(process.cwd(), "src/app/team/attendance/page.tsx");

/** JSX block comments + whole-line `//`, the two shapes this file uses. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const code = stripComments(readFileSync(PAGE, "utf8"));
const occurrences = (needle: string) => code.split(needle).length - 1;

describe("/team/attendance page — spec 400 U1 wiring", () => {
  it("renders the grid view, not merely imports it", () => {
    // >=2 is a FLOOR that only bites a symbol used once; the real count here is
    // the import plus the single render site.
    expect(occurrences("AttendanceGridView")).toBe(2);
    expect(occurrences("buildAttendanceGrid")).toBeGreaterThanOrEqual(2);
  });

  it("resolves the shape through attendanceView and branches BOTH ways on it", () => {
    expect(occurrences("attendanceView")).toBe(2);
    expect(code).toContain('shape === "grid"');
    expect(code).toContain('shape === "list"');
  });

  it("guards each view's RENDER SITE with its own arm of the shape", () => {
    // A bare toContain on the predicate is NOT this assertion: `shape === "grid"`
    // also appears in the two data-loading guards, so replacing the render site's
    // condition with `false` left the whole grid unrendered and every test green
    // (mutation-proved). What matters is the guard IMMEDIATELY around each site.
    const near = (needle: string) => {
      const at = code.indexOf(needle);
      expect(at).toBeGreaterThan(-1);
      return code.slice(Math.max(0, at - 200), at);
    };
    expect(near("<AttendanceGridView")).toContain('shape === "grid" && (');
    expect(near('<ul className="flex flex-col gap-2">')).toContain('shape === "list" && (');
  });

  it("keeps the list reachable — the grid is a default, not a replacement", () => {
    // Spec §D7: the list is the better read for one person's month and it is
    // what the CSV mirrors. A toggle that only points one way would retire it.
    expect(code).toContain('["grid", "list"] as const');
    expect(occurrences("viewHref")).toBeGreaterThanOrEqual(2);
  });

  it("carries the view through the range form, so a list reader stays in the list", () => {
    expect(code).toContain('<input type="hidden" name="view" value="list" />');
  });

  it("keeps the drill's own links in the list view", () => {
    // Without this the drill's open/close links drop ?view and bounce the reader
    // to the grid, where the drill they just asked for does not exist.
    const drill = code.slice(
      code.indexOf("const drillHref"),
      code.indexOf("return (", code.indexOf("const drillHref")),
    );
    expect(drill).toContain('q.set("view", "list")');
  });

  it("resolves the worker link through gridWorkerHref, keyed on the REAL role set", () => {
    // The BEHAVIOUR of both arms is pinned in attendance-grid.test.ts, because a
    // source scan cannot see reachability: with the branch inline, mutating
    // `if (canOpenCalendar)` to `if (true)` left the fallback code and the
    // role-set count untouched and this file stayed GREEN. All this may assert
    // is that the page hands the helper the right input.
    expect(occurrences("gridWorkerHref")).toBe(2);
    expect(code).toContain("WORKER_ROSTER_ROLES.includes(ctx.role)");
    expect(code).toContain(
      "gridWorkerHref({ workerId, canOpenCalendar: inWorkerRosterRoles, range, backHref })",
    );
    // …and that the page does not quietly rebuild either destination itself.
    expect(code).not.toContain("/workers/${workerId}/attendance");
  });

  it("reads public_holidays on the SESSION client, never the admin one", () => {
    // `public_holidays` RLS is `readable by authenticated` (qual true, verified
    // live), so the admin seam would be an unjustified bypass — and this page
    // already keeps admin to the project picker alone.
    expect(code).toMatch(/supabase\s*\n?\s*\.from\("public_holidays"\)/);
    const holidayCall = code.slice(
      code.indexOf('"public_holidays"') - 400,
      code.indexOf('"public_holidays"'),
    );
    expect(holidayCall).not.toContain("createAdminClient");
  });

  it("skips the detail fetch entirely when the range is too wide to draw", () => {
    // Otherwise a ?start=2020-01-01 pulls every session ever recorded and then
    // refuses to render them. Asserting only that `gridProbe.tooWide` APPEARS is
    // the two-appearance hole again (it guards the holidays read as well), so
    // the guard is pinned adjacent to the detail call itself.
    expect(code).toContain('const drawsGrid = shape === "grid" && !gridProbe.tooWide;');
    expect(code).toContain(
      "const gridDetail = drawsGrid ? await loadAttendanceDetail(supabase, range, null) : [];",
    );
    expect(code).toContain("const { data: holidays } = drawsGrid");
  });

  it("reads the roster on the SESSION client, gated on the roles RLS actually admits", () => {
    // U2. The gate is load-bearing and the NEXT test explains why this exact set.
    expect(code).toContain("drawsGrid && inWorkerRosterRoles ? await rosterQuery");
    expect(code).toContain('supabase.from("workers").select("id, name").eq("active", true)');
    const rosterBlock = code.slice(code.indexOf("const rosterQuery"), code.indexOf("const grid ="));
    expect(rosterBlock).not.toContain("createAdminClient");
    // `day_rate` and `employee_id` are column-WALLED on `workers`; naming them
    // reads back null under RLS rather than failing, so they stay unnamed.
    expect(rosterBlock).not.toContain("day_rate");
    expect(rosterBlock).not.toContain("employee_id");
  });

  it("pins the role set the roster read depends on — a SESSION read needs RLS to agree", () => {
    // THE load-bearing assertion of U2, and the one that will age.
    //
    // Live `workers` policy "readable by staff" (verified 2026-08-06):
    //   {site_admin, project_manager, procurement, procurement_manager,
    //    super_admin, project_director}
    // WORKER_ROSTER_ROLES is exactly ATTENDANCE_AUDIT_ROLES ∩ that policy, which
    // is why the roster can be read on the SESSION client with no admin seam.
    //
    // But the two sets MEAN different things — "who onboards ช่าง" vs "who may
    // read worker rows" — so the equality is a coincidence, not a guarantee.
    // `project_coordinator` is the live example of the hazard: it is in
    // ATTENDANCE_AUDIT_ROLES and can open `/workers` (that page reads via the
    // ADMIN client), but the policy denies it — so adding it here would give
    // this surface a SILENT EMPTY roster, never a refusal.
    //
    // If this test reds, do not "fix" it by editing the array: re-read the live
    // policy and decide whether the new member can actually SELECT `workers`.
    expect([...WORKER_ROSTER_ROLES].sort()).toEqual([
      "procurement",
      "procurement_manager",
      "project_director",
      "project_manager",
      "super_admin",
    ]);
    // …and every one of them really is an audit role, or the branch is dead.
    for (const role of WORKER_ROSTER_ROLES) {
      expect(ATTENDANCE_AUDIT_ROLES).toContain(role);
    }
  });

  it("scopes the roster to the picked project, and to every project otherwise", () => {
    const rosterBlock = code.slice(code.indexOf("const rosterQuery"), code.indexOf("const grid ="));
    expect(rosterBlock).toContain('.eq("project_id", range.projectId)');
    expect(rosterBlock).toContain("range.projectId");
  });

  it("states the absent count beside the header number it would otherwise contradict", () => {
    // Live: the header reads `25 คน` (people the muster recorded) above a table
    // of 42 rows once the roster is unioned in. One screen, two numbers, no
    // explanation — so the finding is written out, and derived from the GRID the
    // reader is looking at rather than recomputed from another source.
    expect(code).toContain(
      'const absentCount = shape === "grid" ? grid.rows.filter((r) => r.daysPresent === 0).length : 0;',
    );
    expect(code).toContain("ไม่มีบันทึกการเช็คชื่อในช่วงนี้ {absentCount} คน");
    // It sits in the header card, not in the grid — a per-range fact, once.
    const header = code.slice(
      code.indexOf("{rows.length} คน"),
      code.indexOf("<AttendanceGridView"),
    );
    expect(header).toContain("absentCount > 0");
  });

  it("hands the roster to the builder as a UNION input, not as the row set", () => {
    // Measured: one worker with attendance in the live window is not `active`.
    // Substituting the roster for the rows would drop them from a grid that
    // already shows them.
    const gridCall = code.slice(code.indexOf("const grid = buildAttendanceGrid"));
    expect(gridCall).toContain("rows: gridDetail");
    expect(gridCall).toContain("roster: roster ?? []");
  });

  it("pays for the per-worker drill query only in the view that renders it", () => {
    const drill = code.slice(code.indexOf("const detailDays"), code.indexOf("const exportHref"));
    expect(drill).toContain('shape === "list"');
  });
});
