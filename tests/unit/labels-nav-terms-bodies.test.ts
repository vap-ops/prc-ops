import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// Spec 313 U2b — finish D4 ("one term per concept") in the BODIES.
//
// U2 renamed the surfaces (the /workers title + h1, the WP labor tab, the /sa
// chip) but left the components rendering inside them. The result was a visible
// contradiction: /workers headed รายชื่อช่างและค่าแรง with a เพิ่มทีมงาน button
// directly beneath it. These files are where ทีมงาน survived, and each one is
// pinned to the concept it actually names:
//
//   ทีมงาน      → ONLY the /team people hub
//   รายชื่อช่าง → the /workers company roster
//   ช่าง        → an individual worker
//   แรงงาน      → the per-work-package daily labor log
//
// The assertions pin ABSENCE of the wrong term, not just presence of the right
// one — a presence-only check passes while the old string still sits next to it.
describe("spec 313 U2b — ทีมงาน no longer leaks into roster/labor bodies", () => {
  const MIGRATED = [
    "src/components/features/labor/worker-roster-manager.tsx",
    "src/components/features/labor/labor-log-zone.tsx",
    "src/app/workers/actions.ts",
    "src/app/review/work-packages/[workPackageId]/page.tsx",
  ];

  it.each(MIGRATED)("%s no longer contains the literal ทีมงาน", (path) => {
    // Comments are code, not copy — but leaving the term in a comment is exactly
    // how the vocabulary drifts back, so the whole file is held to the rule.
    expect(read(path)).not.toContain("ทีมงาน");
  });

  it("the /workers roster body says เพิ่มช่าง, matching its รายชื่อช่าง heading", () => {
    const src = read("src/components/features/labor/worker-roster-manager.tsx");
    expect(src).toContain("เพิ่มช่าง");
  });

  it("the daily labor log says แรงงาน", () => {
    expect(read("src/app/review/work-packages/[workPackageId]/page.tsx")).toContain(
      "บันทึกแรงงานรายวัน",
    );
    expect(read("src/components/features/labor/labor-log-zone.tsx")).toContain("บันทึกแรงงาน");
  });

  it("the worker picker points at รายชื่อช่าง and searches ช่าง", () => {
    const src = read("src/components/features/labor/labor-log-zone.tsx");
    expect(src).toContain("ค้นหาช่าง");
    expect(src).toContain("รายชื่อช่าง");
  });
});

// The three copies of the roster's name that predate the const. Single-sourcing
// them is the ui-term-consistency rule (any term used 2+ places lives in
// labels.ts) — and it is what stops the next rename from missing a surface.
describe("spec 313 U2b — the roster name is single-sourced", () => {
  const CONST_CONSUMERS = [
    // Spec 334 U3 moved the รายชื่อช่าง tile off the hub page into the tile SSOT.
    "src/components/features/sa/team-tiles.tsx",
    "src/app/settings/sections.ts",
    "src/lib/purchasing/procurement-home.ts",
  ];

  it.each(CONST_CONSUMERS)("%s reads WORKER_ROSTER_LABEL instead of the literal", (path) => {
    const src = read(path);
    // ≥2 occurrences = the import line PLUS a real usage — a lone import with
    // the usage deleted counts 1 and fails. toContain alone is satisfied by
    // the import line (fresh-eyes finding, 2026-07-21).
    expect(src.split("WORKER_ROSTER_LABEL").length - 1).toBeGreaterThanOrEqual(2);
    // Bare, not quote-wrapped: a revert to JSX text (no quotes) must trip too.
    expect(src).not.toContain("รายชื่อช่าง");
  });
});
