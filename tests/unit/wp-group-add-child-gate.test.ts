// Spec 335 — the add-งานย่อย door's gate is the riskiest line in the unit and
// has no render test (the WP-detail page is a server component with the whole
// leaf branch behind it). Pin it at the source, in the style of
// project-config-placement.test.ts.
//
// What must hold: the door renders only for the PM tier (`isPlanner`, which IS
// `isManagerRole` — exactly the gate `createWorkPackage` enforces, so the
// button can never be a dead door) AND only while the project is open. A future
// edit that widens the role to `isAssigner` (site staff, who the action would
// refuse) or drops the status arm has to break this test to land.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = join(
  process.cwd(),
  "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx",
);

describe("งาน detail add-งานย่อย gate (spec 335)", () => {
  const src = readFileSync(PAGE, "utf8");
  const declaration = src.match(/const canAddChild =[^;]+;/)?.[0] ?? "";

  it("gates on the PM tier, not the wider write-affordance flag", () => {
    expect(declaration).not.toBe("");
    expect(declaration).toContain("isPlanner");
    // isAssigner is `!readOnly` — site staff included, whom createWorkPackage
    // refuses with PM_ONLY_ERROR. Widening to it would build a dead door.
    expect(declaration).not.toContain("isAssigner");
  });

  it("gates on an open project — both statuses project_is_open() accepts", () => {
    expect(declaration).toContain('"active"');
    expect(declaration).toContain('"on_hold"');
  });

  it("renders the sheet only under that gate", () => {
    expect(src).toMatch(/addChildAction=\{\s*canAddChild \?/);
  });
});
