// Operator ruling 2026-08-08 — the holiday display is WITHDRAWN from every
// attendance surface: "hide info about holidays, we do not have those yet.
// money is the same as normal day."
//
// Spec 374 U2 shipped a tint + a name + a ทำงานวันหยุด chip + a legend, and
// spec 400 shaded the grid's holiday columns. All of it described a policy the
// firm does not have — PRC scanned a full day on 2026-07-29 (อาสาฬหบูชา) and
// 2026-07-30 (วันเข้าพรรษา) — and an amber tint on a pay calendar reads as
// "this day is priced differently", which it never was: `public_holidays` is
// referenced by no DB function, view or trigger.
//
// The TABLE and its 23 rows stay (a future holiday policy keeps its data); what
// this pins is that nothing READS them, so the display cannot creep back one
// surface at a time. Behavioural coverage lives in the per-surface suites; this
// is the repo-wide absence, which no render test can express.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/** Every module that read `public_holidays` before the withdrawal. */
const SURFACES = [
  "src/lib/attendance/attendance-month.ts",
  "src/lib/attendance/load-worker-attendance.ts",
  "src/lib/attendance/fix-panel.ts",
  "src/lib/muster/attendance-grid.ts",
  "src/components/features/labor/worker-attendance-calendar.tsx",
  "src/components/features/muster/attendance-grid-view.tsx",
  "src/components/features/muster/attendance-day-panel.tsx",
  "src/app/team/attendance/page.tsx",
  "src/app/workers/[workerId]/attendance/page.tsx",
] as const;

/**
 * Comment lines only — a note explaining WHY the holiday marking went away must
 * not itself trip the guard (documenting a hazard is not the hazard). Line-led
 * rather than a `/* … *\/` sweep on purpose: a general block-comment stripper is
 * opened by things like `accept="image/*"` and silently eats real code.
 */
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("/*") ||
        t.startsWith("{/*")
      );
    })
    .join("\n");
}

/** Identifiers and copy that only exist to render a holiday. */
const WITHDRAWN = [
  "public_holidays",
  "holidayName",
  "holidayByDate",
  "HolidayRow",
  "GridHoliday",
  "ทำงานวันหยุด",
  "วันหยุดของเดือนนี้",
] as const;

describe("attendance holiday display — withdrawn (operator 2026-08-08)", () => {
  const sources = SURFACES.map((rel) => ({
    rel,
    code: stripComments(readFileSync(join(ROOT, rel), "utf8")),
  }));

  // The corpus is the claim. A renamed or moved file would otherwise shrink the
  // scan to nothing and pass for the wrong reason.
  it("scans every surface that used to read public_holidays", () => {
    expect(sources).toHaveLength(9);
    for (const { rel, code } of sources) expect(code.length, rel).toBeGreaterThan(0);
  });

  it.each(SURFACES)("%s renders and reads no holiday", (rel) => {
    const code = sources.find((s) => s.rel === rel)!.code;
    for (const token of WITHDRAWN)
      expect(code, `${rel} still carries ${token}`).not.toContain(token);
  });

  // The calendar's holiday tint was the at-a-glance half of the marking. The
  // weekend tint (`bg-sunk`) is untouched — Sunday is not a public holiday.
  it("the worker calendar carries no holiday tint, and keeps the weekend one", () => {
    const cal = sources.find((s) => s.rel.endsWith("worker-attendance-calendar.tsx"))!.code;
    expect(cal).not.toContain("bg-attn-soft");
    expect(cal).toContain("bg-sunk");
  });

  // `nonWorking` was `holiday || Sunday`, and it drives BOTH the grid shading
  // and `gridCellFixable`. Leaving the holiday arm in place would have kept the
  // day visibly and behaviourally special with nothing on screen saying why —
  // a hidden marking is worse than a visible one.
  it("derives nonWorking from Sunday alone, in both producers", () => {
    for (const rel of ["src/lib/muster/attendance-grid.ts", "src/lib/attendance/fix-panel.ts"]) {
      const code = sources.find((s) => s.rel === rel)!.code;
      // Every `nonWorking:` in the file, not the first one — the interface
      // declaration (`nonWorking: boolean;`) shares the prefix, and matching it
      // instead of the assignment would pass over any predicate at all.
      const assignments = code
        .split("\n")
        .map((l) => l.replace(/\s/g, ""))
        .filter((l) => l.includes("nonWorking:") && !l.includes("nonWorking:boolean"));
      expect(assignments, `${rel} no longer assigns nonWorking`).toHaveLength(1);
      expect(assignments[0], rel).toContain("nonWorking:isSunday(");
    }
  });
});
