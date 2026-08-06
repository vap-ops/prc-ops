// Spec 392 U2b — the two properties of the zone canvas that no rendered test
// can reach, because jsdom has no layout engine and Konva draws to a canvas
// jsdom does not implement.
//
// ① The engine must not enter the main bundle (spec §3). konva + react-konva
//    are the largest things in a 16-runtime-dependency repo; only a manager who
//    opens the zones route may pay for them, which means every import of the
//    drawing module goes through `next/dynamic({ ssr: false })`.
// ② The shape `switch` must be exhaustive with no `default:` arm (spec §9). A
//    `default` silently drops a new `zone_shape` enum value — the migration,
//    the RPC and the pgTAP all stay green while the zone renders as nothing.
//
// Both are source facts, so both are asserted over source text. Comments are
// stripped first: a doc comment quoting the forbidden construct would otherwise
// satisfy — or trip — the very assertion that documents it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const ZONE_DIR = join(ROOT, "src", "components", "features", "zones");

const CANVAS = "zone-canvas.tsx";
const LAZY = "zone-canvas-lazy.tsx";
const SHAPES = "zone-shape-node.tsx";

function read(file: string): string {
  return readFileSync(join(ZONE_DIR, file), "utf8");
}

/** Drop JSX/line comments so prose about a rule cannot satisfy the rule. */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("the Konva island stays out of the main bundle", () => {
  it("is reached only through a dynamic, ssr:false import", () => {
    const lazy = stripComments(read(LAZY));
    expect(lazy).toContain('import dynamic from "next/dynamic"');
    expect(lazy).toContain("./zone-canvas");
    expect(lazy).toMatch(/ssr:\s*false/);
  });

  it("has no static importer anywhere in src/ — a single one would undo the split", () => {
    // The lazy wrapper's own reference is a dynamic `import()`, so a STATIC
    // `from "…/zone-canvas"` anywhere is the regression this pins.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"))) {
      const source = stripComments(readFileSync(file, "utf8"));
      if (/^\s*import[^\n]*from\s+["'][^"']*zone-canvas["']/m.test(source)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps konva out of every server-rendered module", () => {
    // `react-konva` reaches for `window` at import time. A Server Component
    // that imports it fails the build, not the test suite — pin it here where
    // the failure is readable.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"))) {
      const source = readFileSync(file, "utf8");
      if (!/from\s+["'](?:konva|react-konva)/.test(source)) continue;
      if (!source.startsWith('"use client"') && !source.startsWith("'use client'")) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the shape renderer covers the whole zone_shape enum", () => {
  it("names every live enum value", () => {
    // The live enum, read 2026-08-06: rect, rounded_rect, ellipse, polygon.
    const source = stripComments(read(SHAPES));
    for (const shape of ["rect", "rounded_rect", "ellipse", "polygon"]) {
      expect(source, shape).toContain(`case "${shape}"`);
    }
  });

  it("has no default arm — a new shape must fail the compile, not render nothing", () => {
    expect(stripComments(read(SHAPES))).not.toMatch(/^\s*default\s*:/m);
  });
});

describe("the canvas is the second path to every operation, not the only one", () => {
  it("renders read-only when told to, so the SA map can reuse it", () => {
    // Spec 392 §5: field devices get the map read-only. One renderer with a
    // mode, never a second copy of the geometry that can drift from this one.
    const source = stripComments(read(SHAPES));
    expect(source).toContain("readOnly");
    const canvas = stripComments(read(CANVAS));
    expect(canvas).toContain("readOnly");
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
