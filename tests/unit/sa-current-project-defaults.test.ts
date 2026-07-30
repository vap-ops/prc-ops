// Spec 292 U3 — the SA scoped surfaces DEFAULT to the resolved current project.
// Static pins on the two consumers (same page-level-contract pattern as
// wp-leaf-only-queries / ui-class-contracts — the data load itself is exercised
// by the real-browser gate, the default-resolution behaviour by the resolver's
// own unit tests, tests/unit/sa-current-project.test.ts). These pins fail RED
// while the old ad-hoc defaults are still in place and green once each page
// routes its default through getSaCurrentProject.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

/** Source with line comments stripped + whitespace collapsed, so a match keys
 * on code shape, not formatting/prose. */
function code(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ");
}

describe("spec 292 U3 — sa/page.tsx tiles default to the resolver", () => {
  const src = () => code("src/app/sa/page.tsx");

  it("resolves the current project through getSaCurrentProject", () => {
    expect(src()).toContain("getSaCurrentProject(");
  });

  it("feeds the resolver's projectId into primaryProjectId", () => {
    // primaryProjectId is derived from the resolver result, not recomputed.
    expect(src()).toMatch(/primaryProjectId\s*=\s*[^;]*current\b/);
  });

  it("drops the old only-if-exactly-one default", () => {
    // The line 175 pattern the spec replaces: a primary resolved ONLY for a
    // single-project SA. Its removal is the U3 change.
    expect(src()).not.toMatch(/projectIds\.length\s*===\s*1\s*\?\s*projectIds\[0\]/);
  });
});

describe("spec 292 U3 — sa/plan/page.tsx default via the resolver", () => {
  const src = () => code("src/app/sa/plan/page.tsx");

  it("resolves the default through getSaCurrentProject", () => {
    expect(src()).toContain("getSaCurrentProject(");
  });

  it("still honours the ?project= deep-link by passing it as queryProjectId", () => {
    expect(src()).toMatch(/queryProjectId/);
  });

  it("selectedProjectId derives from the resolver's current project", () => {
    expect(src()).toMatch(/selectedProjectId\s*=\s*[^;]*current\b/);
  });

  it("drops the inline projects[0] / projects.some default", () => {
    // The line 59 pattern the spec replaces: validate ?project= inline then
    // fall back to projects[0] (alphabetically-first by code). Now the resolver
    // owns validation + precedence.
    expect(src()).not.toMatch(/projects\.some\(\s*\(p\)\s*=>\s*p\.id\s*===\s*qProject/);
  });
});

describe("spec 292 U4 — sa/page.tsx renders the current-site switcher", () => {
  const src = () => code("src/app/sa/page.tsx");

  it("renders the CurrentProjectSwitcher chip", () => {
    expect(src()).toContain("CurrentProjectSwitcher");
  });

  it("feeds the resolver's current + visible list into the chip", () => {
    expect(src()).toMatch(/current=\{saCurrent\.current\}/);
    expect(src()).toMatch(/projects=\{saCurrent\.visibleProjects\}/);
  });
});

// Writing failing test first.
//
// Spec 376 U1 — the โครงการ tab's per-user href is resolved on the server and
// handed to BottomTabBar. The swap logic itself is covered by
// tests/unit/projects-tab-target.test.ts + the bar's own component tests; what
// only a source pin can hold is that this page actually PASSES the prop —
// sa/page.tsx is a Server Component vitest cannot render, and without the prop
// the bar silently falls back to the static /projects (the exact hop U1 removes,
// with nothing else in the suite noticing).
describe("spec 376 U1 — sa/page.tsx hands the bar her project-tab href", () => {
  const src = () => code("src/app/sa/page.tsx");

  it("passes projectsTabHref exactly once, off the resolved current project", () => {
    const s = src();
    // EXACT count, not toContain: a second mount would be a stale duplicate.
    expect(s.split("projectsTabHref").length - 1).toBe(1);
    // Null-guarded: a zero-project SA keeps the static /projects (its redirect
    // is still the fallback), and the href is built through the project-paths SSOT.
    expect(s).toContain(
      "projectsTabHref={primaryProjectId ? projectHref(primaryProjectId) : null}",
    );
  });
});
