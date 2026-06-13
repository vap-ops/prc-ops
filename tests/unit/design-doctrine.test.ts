// Spec 67 — anti-drift pins for the design doctrine. The design-critique
// found six places where the CODE contradicted the team's OWN written
// rules, surviving because nothing enforced them and the one-operator
// look-loop checks the one config where none of it shows. These read the
// source and make each fixed flaw a RED TEST instead of a thing a human
// has to spot.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = process.cwd();
const SRC = resolve(ROOT, "src");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function srcFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const ALL = srcFiles().map((f) => ({
  rel: f.slice(ROOT.length + 1),
  src: readFileSync(f, "utf8"),
}));

const WP_LIST = "src/app/projects/[projectId]/work-package-list.tsx";
const PHASE_BAR = "src/components/features/phase-progress-bar.tsx";

describe("design doctrine (spec 67 anti-drift pins)", () => {
  it("no window.confirm() call anywhere in src (§7 — use ConfirmDialog)", () => {
    const offenders = ALL.filter((c) => /window\.confirm\s*\(/.test(c.src)).map((c) => c.rel);
    expect(offenders).toEqual([]);
  });

  it("no off-palette green-* utility (positive hue is emerald)", () => {
    const offenders = ALL.filter((c) => /\b(?:bg|text|border|ring)-green-\d/.test(c.src)).map(
      (c) => c.rel,
    );
    expect(offenders).toEqual([]);
  });

  it("no sub-44px min-h-9 control (the gloved-hands tap floor, §7)", () => {
    const offenders = ALL.filter((c) => /\bmin-h-9\b/.test(c.src)).map((c) => c.rel);
    expect(offenders).toEqual([]);
  });

  it("the WP-list group header line-clamps, never single-line truncates (spec 57)", () => {
    const src = read(WP_LIST);
    expect(src).not.toMatch(/block truncate/);
    expect(src).toMatch(/line-clamp-2/);
  });

  it("DETAIL_TITLE carries explicit leading (Thai wrapping-heading)", async () => {
    const { DETAIL_TITLE } = await import("@/lib/ui/classes");
    expect(DETAIL_TITLE).toMatch(/\bleading-/);
  });

  it("the phase progress bar's current segment is not the reserved link blue", () => {
    const src = read(PHASE_BAR);
    expect(src).not.toMatch(/current:\s*"bg-blue-700"/);
    expect(src).not.toMatch(/bg-blue-700/);
  });
});
