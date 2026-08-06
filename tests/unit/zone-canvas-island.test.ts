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

  // ⚠️ ONE walk of src/, one read per file, both checks over the same pass.
  // Two separate scans each re-read every file in the repo and blew the 5s
  // default timeout on a loaded box — a guard that times out is a guard that
  // reds for a reason unrelated to what it protects, which is its own defect.
  const scan = (() => {
    // The lazy wrapper's own reference is a dynamic `import()`, so a STATIC
    // `from "…/zone-canvas"` anywhere is the regression this pins.
    // ⚠️ Matched on the MODULE SPECIFIER, not on a single line. Prettier wraps a
    // named import past 80 chars across several lines, so a line-anchored
    // `^\s*import…from "…"` pattern reads a wrapped `import {\n  ZoneCanvas,\n}
    // from "…/zone-canvas"` as clean — and that import pulls all 54 KB of konva
    // into the main bundle, which is the exact regression this test exists to
    // catch. `from` immediately before the specifier is what distinguishes a
    // static import from the lazy wrapper's `import("./zone-canvas")` call.
    const STATIC_IMPORT = /\bfrom\s*["'][^"']*\/zone-canvas["']/;
    const KONVA_IMPORT = /\bfrom\s*["'](?:konva|react-konva)["']/;
    const staticImporters: string[] = [];
    const serverKonva: string[] = [];
    let files = 0;

    for (const file of sourceFiles(join(ROOT, "src"))) {
      files += 1;
      const raw = readFileSync(file, "utf8");
      const rel = file.slice(ROOT.length + 1);
      if (STATIC_IMPORT.test(stripComments(raw))) staticImporters.push(rel);
      // `react-konva` reaches for `window` at import time, so a Server
      // Component importing it fails the BUILD, not the suite — pinned here
      // where the failure is readable.
      // ⚠️ Strip comments before the specifier test, and look for the directive
      // in the first NON-COMMENT line rather than at byte 0. Every file in this
      // repo may carry a licence/doc comment above `"use client"` — Next accepts
      // that — so a byte-0 anchor would red a file that is perfectly correct.
      const stripped = stripComments(raw);
      const firstCode = stripped.split("\n").find((l) => l.trim().length > 0) ?? "";
      if (KONVA_IMPORT.test(stripped) && !/^["']use client["']/.test(firstCode.trim())) {
        serverKonva.push(rel);
      }
    }
    return { staticImporters, serverKonva, files };
  })();

  it("scanned the repo at all — a zero-file walk would pass both checks below", () => {
    expect(scan.files).toBeGreaterThan(200);
  });

  it("has no static importer anywhere in src/ — a single one would undo the split", () => {
    expect(scan.staticImporters).toEqual([]);
  });

  it("keeps konva out of every server-rendered module", () => {
    expect(scan.serverKonva).toEqual([]);
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
    // ⚠️ `toContain("readOnly")` is satisfied by the word appearing anywhere —
    // an unused prop, or the identifier inside a template literal. Bind the
    // assertion to the MECHANISM the read-only mode actually is: dragging off
    // and no transformer.
    const source = stripComments(read(SHAPES));
    expect(source).toContain("draggable: !readOnly");
    const canvas = stripComments(read(CANVAS));
    expect(canvas).toContain("!readOnly && (");
    expect(canvas).toContain("readOnly={readOnly}");
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
