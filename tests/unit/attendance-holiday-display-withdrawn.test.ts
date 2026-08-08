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
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

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
 * Comments only — a note explaining WHY the holiday marking went away must not
 * itself trip the guard (documenting a hazard is not the hazard).
 *
 * Line-led plus BLOCK DEPTH, never a global `/* … *\/` regex: a general
 * block-comment sweep is opened by things like `accept="image/*"` and silently
 * eats real code, which is a false NEGATIVE. Depth-tracking keeps the error
 * direction on the safe side — an unclosed block only ever hides more comment.
 * The continuation lines matter: these files carry multi-line `{/* … *\/}`
 * comments whose middle lines start with a bare word, and the first version of
 * this stripper kept them, so a future comment merely NAMING a holiday symbol
 * would have redded the guard on unrelated work.
 */
function stripComments(src: string): string {
  let inBlock = false;
  const out: string[] = [];
  for (const raw of src.split("\n")) {
    const t = raw.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("//")) continue;
    if (t.startsWith("/*") || t.startsWith("{/*")) {
      if (!t.includes("*/")) inBlock = true;
      continue;
    }
    // A trailing `// …` on a line of code.
    out.push(raw.replace(/\/\/.*$/, ""));
  }
  return out.join("\n");
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

  // ⚠️ The nine-file sweep above is the per-surface DETAIL; this is the claim
  // the file's name makes. A hand-listed corpus cannot see a holiday reader
  // added anywhere ELSE — a new component, the CSV path, `day-fix.ts` (which
  // owns `gridCellFixable`), the worker — so the table's own name is swept
  // across every source file instead. `database.types.ts` is generated from the
  // live schema and MUST keep the row: the table is retained by design.
  it("no source file anywhere reads public_holidays, except the generated types", () => {
    const roots = [join(ROOT, "src"), join(ROOT, "worker", "src")];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    for (const r of roots) walk(r);
    // Positive control on the scan itself: a corpus this small means the walk
    // broke, and an empty scan reads exactly like a clean one.
    expect(files.length).toBeGreaterThan(500);
    const offenders = files.filter(
      (p) =>
        !p.endsWith(join("db", "database.types.ts")) &&
        !p.endsWith("database.types.ts") &&
        !p.endsWith(basename(__filename)) &&
        stripComments(readFileSync(p, "utf8")).includes("public_holidays"),
    );
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
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
      // WHOLE expression, not `toContain("isSunday(")` — mutation-proved: an
      // appended `|| <isHoliday>` arm leaves a containment check green, which is
      // exactly the re-add this guard exists to stop.
      expect(assignments[0], rel).toMatch(/^nonWorking:isSunday\([\w.]+\),$/);
    }
  });
});
