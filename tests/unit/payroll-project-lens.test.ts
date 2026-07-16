// Spec 323 U5 — the universal cross-project <ProjectLens> lands on /payroll.
// Wages are project-blind by default (spec 311 P0); the page already carries a
// ?project= filter (spec 309) and a period+project GET form, so the lens is a
// pure UX add: a one-tap chip row on the SAME ?project= axis the form's picker
// writes (they sync via the URL). Mirrors the U4 mount on /requests/orders —
// wrapped in empty:hidden so the single-project collapse leaves no stray margin,
// mounted above the period form.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/app/payroll/page.tsx"), "utf8");

describe("payroll project lens (spec 323 U5)", () => {
  it("imports the shared <ProjectLens> from the common feature component", () => {
    expect(src).toMatch(
      /import\s*\{\s*ProjectLens\s*\}\s*from\s*"@\/components\/features\/common\/project-lens"/,
    );
  });

  it("mounts <ProjectLens> with a projects prop derived from the loaded options", () => {
    // Same shape the U4 orders mount passes: { id, name } per project. Named-empty
    // projects are dropped inside the component, so options can be passed as-is.
    expect(src).toMatch(/<ProjectLens\s+projects=\{/);
  });

  it("wraps the lens in empty:hidden so the collapsed single-project state has no margin", () => {
    // The lens returns null at <=1 named project; the wrapper's margin must vanish
    // with it (mirrors /requests/orders). The wrapper carries both a margin and
    // empty:hidden.
    expect(src).toMatch(/className="[^"]*empty:hidden[^"]*"[\s\S]{0,120}?<ProjectLens/);
  });

  it("renders the lens above the period form", () => {
    const lensAt = src.indexOf("<ProjectLens");
    const formAt = src.indexOf('method="get"');
    expect(lensAt).toBeGreaterThan(-1);
    expect(formAt).toBeGreaterThan(-1);
    expect(lensAt).toBeLessThan(formAt);
  });
});
