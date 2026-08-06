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

  it("aims a worker name at a page THAT ROLE can open", () => {
    // WORKER_ROSTER_ROLES is narrower than ATTENDANCE_AUDIT_ROLES; the other
    // three roles get this report's own drill rather than a redirect.
    expect(occurrences("WORKER_ROSTER_ROLES")).toBe(2);
    expect(code).toContain("/workers/${workerId}/attendance");
    const fallback = code.slice(code.indexOf("const gridWorkerHref"));
    expect(fallback).toContain('view: "list"');
    expect(fallback).toContain("worker: workerId");
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
