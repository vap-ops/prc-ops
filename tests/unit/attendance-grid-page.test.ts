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
    expect(code).toContain("gridWorkerHref({ workerId, canOpenCalendar, range, backHref })");
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
    // refuses to render them.
    expect(code).toContain("gridProbe.tooWide");
  });
});
