// Spec 404 U2b — the worker-day fix panel's controls must lay themselves out
// against the BOX they are in, never against the viewport.
//
// Writing failing test first.
//
// THE DEFECT THIS PINS, measured in real Chrome and deterministic at every width
// in the `md` band: U2 docked `WorkerDayFixPanel` into a fixed 280–300px column,
// while `muster-reopen-form` and `attendance-fix-retime-form` keyed their row
// layouts on `sm:` — a VIEWPORT query. So at any viewport ≥640px those forms
// took their WIDE layout inside a narrow box. Restoring that instruction on the
// live page as a control measured the reopen reason input at **63px** of usable
// width inside the 280px panel, against a **154px** placeholder — the truncated
// `เช่น ลงเวลาไ` on the operator's screenshot — and the two retime time fields
// at different x-origins. It is now 188px there, and 248px above `lg`.
//
// jsdom has no layout engine, so the whole 7,900-test suite is structurally
// blind to this: the browser measurement is the proof, and THIS is the
// regression pin. Two halves, and both are needed —
//
//  1. the shared forms carry container variants (`@md:`), not viewport ones;
//  2. every component that RENDERS one of them declares a container, or those
//     variants silently never fire and the form stacks where it has room to row.
//
// (2) is derived from the tree, never hand-listed: a guard that types out the
// set it considers safe fails closed the day a fourth renderer appears, and
// reads as a bug in the new renderer rather than in the guard.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).map((file) => ({ file, content: fs.readFileSync(file, "utf8") }));

/**
 * JSX comment blocks and whole-line `//` comments, removed.
 *
 * ⚠️ NOT a general `/* … *\/` sweep: `accept="image/*"` opens one, which then
 * runs to the next real close and silently deletes spans of unrelated files —
 * the failure direction of a comment stripper must be a LOUD false positive,
 * never a quiet false negative. Whole-line only, so a `https://` inside a string
 * survives. It matters here because both forms carry comments that QUOTE the
 * retired `sm:` classes to explain why they went — documenting the hazard must
 * not trip the guard against it.
 */
function stripComments(content: string): string {
  return content.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const STRING_LITERALS = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

/** Viewport-keyed responsive prefixes inside string literals — the whole class
 *  of bug this unit closes. `@md:`-style container variants are what belongs
 *  here instead, and are deliberately NOT matched. */
const VIEWPORT_VARIANT = /(?:^|[\s"'`])(sm|md|lg|xl|2xl):/;

export function viewportVariants(content: string): string[] {
  const out: string[] = [];
  for (const [lit] of stripComments(content).matchAll(STRING_LITERALS)) {
    if (VIEWPORT_VARIANT.test(lit)) out.push(lit);
  }
  return out;
}

// The three controls the panel composes. Named individually rather than swept,
// because the claim is about THESE forms — they are the ones a 280px column
// hosts, and the ones three surfaces share.
const PANEL_FORMS = [
  "src/components/features/muster/muster-reopen-form.tsx",
  "src/components/features/muster/attendance-fix-retime-form.tsx",
  "src/components/features/muster/attendance-fix-add-form.tsx",
];

describe("the panel's shared forms lay out against their container (spec 404 U2b)", () => {
  it.each(PANEL_FORMS)("%s carries no viewport-keyed layout variant", (rel) => {
    const entry = FILES.find((f) => f.file.endsWith(path.normalize(rel)));
    expect(entry, `${rel} not found — the guard's target moved`).toBeDefined();
    expect(viewportVariants(entry!.content)).toEqual([]);
  });

  it("the two forms that DO have a wide layout express it as a container query", () => {
    // The add form stacks at every width and needs no variant at all — asserting
    // one there would force a class in to satisfy a test. These two have a real
    // row/stack decision, so each must actually carry the container variant; an
    // absence-only guard above would be satisfied by deleting the layout.
    for (const rel of PANEL_FORMS.slice(0, 2)) {
      const entry = FILES.find((f) => f.file.endsWith(path.normalize(rel)))!;
      expect(stripComments(entry.content)).toContain("@md:flex-row");
    }
  });
});

// ---------------------------------------------------------------------------
// Every component that RENDERS one of the forms declares a container.
//
// `@md:` resolves against the nearest ancestor carrying `container-type`, so a
// renderer with no container silently STACKS a form that has room for a row —
// and that is a regression on a full-width surface, not a safe default. It was
// nearly shipped: the browser probe caught `MusterReopenForm` being rendered by
// two surfaces beyond the panel (`attendance-day-panel`, `attendance-drill`),
// both of which this unit would otherwise have stacked.
//
// DERIVED from the tree, never hand-listed: a guard that types out the set it
// considers safe fails closed the day a fourth renderer appears, and then reads
// as a bug in the new renderer rather than in the guard.
// ---------------------------------------------------------------------------

const FORM_TAGS = /<(MusterReopenForm|AttendanceFixRetimeForm|AttendanceFixAddForm)\b/;

const renderers = FILES.filter(
  (f) =>
    FORM_TAGS.test(stripComments(f.content)) &&
    !PANEL_FORMS.some((p) => f.file.endsWith(path.normalize(p))),
).map((f) => ({ rel: path.relative(process.cwd(), f.file), content: f.content }));

describe("every renderer of those forms declares a container (spec 404 U2b)", () => {
  it("finds them all — a zero-match scan is an ABORT, not a pass", () => {
    // Corpus-size pin. Without it, losing the matcher (a rename, a wrapper
    // component, a re-export) turns the whole describe below into a vacuous
    // green while every form silently stacks.
    //
    // Pinned by PATH, not basename: a renderer moved to another directory while
    // keeping its filename would otherwise satisfy this untouched, and a move is
    // exactly when the box a form sits in changes.
    expect(renderers.map((r) => r.rel.split(path.sep).join("/")).sort()).toEqual([
      "src/components/features/muster/attendance-day-panel.tsx",
      "src/components/features/muster/attendance-drill.tsx",
      "src/components/features/muster/worker-day-fix-panel.tsx",
    ]);
  });

  it.each(renderers.map((r) => [r.rel, r.content]))(
    "%s declares @container ABOVE the form it hosts",
    (_rel, content) => {
      const src = stripComments(content as string);
      expect(src).toContain("@container");
      // ⚠️ A file-level `toContain` cannot see whether the container is an
      // ANCESTOR of the form — a renderer that put `@container` on an unrelated
      // sibling would pass while its form stacked. Source ORDER is the cheap
      // approximation that closes the likeliest version of that: all three
      // declare it on the element they return, so it must appear before the
      // first form tag. A true ancestry check needs a JSX parse, which is more
      // machinery than this property is worth — the limitation is stated here
      // rather than left for the next reader to discover.
      expect(src.indexOf("@container")).toBeLessThan(src.search(FORM_TAGS));
    },
  );

  it("the PANEL owns its own container, so no door has to remember", () => {
    // The panel is docked into three boxes of very different widths (a
    // full-width page section, a wide card, a 280–340px column). Declaring the
    // container on the panel means the forms measure the PANEL — which is
    // exactly the box they are in — instead of whatever a door wrapped it in.
    const panel = FILES.find((f) =>
      f.file.endsWith(path.normalize("src/components/features/muster/worker-day-fix-panel.tsx")),
    )!;
    expect(stripComments(panel.content)).toContain('<div className="@container">');
  });
});
