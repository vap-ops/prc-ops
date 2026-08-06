// Writing failing test first.
//
// Found by a cross-lane fact-check of the route-announcement arc (#983 → #994),
// and it is this repo's own fake-coverage class in code I wrote.
//
// `route-announcement.ts` derives the destination name from `document.title` by
// stripping the app-title suffix. Both halves of what it strips were HAND-COPIES
// of `src/app/layout.tsx`'s metadata:
//
//     route-announcement.ts        layout.tsx
//     APP_TITLE_SUFFIX  " — PRC Ops"   ↔  template: "%s — PRC Ops"
//     APP_TITLE_DEFAULT "PRC Ops"      ↔  default:  "PRC Ops"
//
// …and the test asserted `pageNameFromTitle(`โครงการ${APP_TITLE_SUFFIX}`)`, i.e.
// **the constant against itself**. Rename the app or change the separator in
// `layout.tsx` and every test stays green while every spoken announcement keeps
// a stale suffix glued on — and a page with no title of its own starts being
// announced as the app name instead of staying silent, because the "is this the
// bare default?" check would be comparing against the wrong string.
//
// The fix is one SSOT that BOTH sides consume, so drift is impossible by
// construction rather than merely detectable. This file pins that: the layout
// must not re-declare the literals, and a title composed through the real
// template must round-trip back to the page's own name.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  APP_NAME,
  APP_TITLE_SEPARATOR,
  APP_TITLE_SUFFIX,
  APP_TITLE_TEMPLATE,
} from "@/lib/ui/app-title";
import { pageNameFromTitle } from "@/lib/ui/route-announcement";

/**
 * Comments go before any raw-text scan, or explaining the hazard becomes the
 * hazard — this file's first draft failed because the SSOT's own header says
 * "no `server-only`", which is exactly the word the scan forbids. Line comments
 * are stripped too, but only when not preceded by `:` so URLs survive.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const read = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), "utf8"));

const layoutSource = read("src/app/layout.tsx");

describe("app title SSOT", () => {
  it("composes the template and the suffix from ONE name", () => {
    expect(APP_TITLE_SUFFIX).toBe(`${APP_TITLE_SEPARATOR}${APP_NAME}`);
    expect(APP_TITLE_TEMPLATE).toBe(`%s${APP_TITLE_SUFFIX}`);
    // Next requires the placeholder; without it every routed page would render
    // the same title.
    expect(APP_TITLE_TEMPLATE).toContain("%s");
  });

  it("round-trips: a title rendered through the real template announces the page's own name", () => {
    // This is the assertion the old one only appeared to make. It is meaningful
    // ONLY because the layout is pinned below to use this same template — the
    // composition being exercised is the one production actually applies.
    for (const page of ["โครงการ", "รายชื่อช่าง", "ต้นทุนโครงการ", "รายละเอียดผู้ติดต่อ"]) {
      expect(pageNameFromTitle(APP_TITLE_TEMPLATE.replace("%s", page))).toBe(page);
    }
  });

  it("treats the bare app name as no page name at all", () => {
    // The other hand-copy. A page that sets no title of its own renders the
    // template's `default`, and must announce NOTHING rather than the app name.
    expect(pageNameFromTitle(APP_NAME)).toBe("");
  });
});

describe("the root layout consumes that SSOT rather than re-declaring it", () => {
  it("does not hand-write the app name or the template", () => {
    // The whole defect: two literals in two files that must agree and nothing
    // making them. A rename in one place is the realistic edit.
    expect(
      layoutSource.includes(`"${APP_NAME}"`),
      `src/app/layout.tsx still hard-codes "${APP_NAME}" — import APP_NAME from ` +
        `@/lib/ui/app-title instead, or the announcement layer's copy silently drifts`,
    ).toBe(false);
    expect(
      layoutSource.includes(`"%s${APP_TITLE_SEPARATOR}${APP_NAME}"`),
      "src/app/layout.tsx still hard-codes the title template — import " +
        "APP_TITLE_TEMPLATE from @/lib/ui/app-title instead",
    ).toBe(false);
  });

  it("actually references the shared constants", () => {
    // Absence alone is satisfied by deleting the metadata; require the usage.
    expect(layoutSource.split("APP_NAME").length - 1).toBeGreaterThanOrEqual(2); // import + use
    expect(layoutSource.split("APP_TITLE_TEMPLATE").length - 1).toBeGreaterThanOrEqual(2);
    expect(layoutSource).toMatch(/title:\s*\{[\s\S]*?default:\s*APP_NAME/);
    expect(layoutSource).toMatch(/title:\s*\{[\s\S]*?template:\s*APP_TITLE_TEMPLATE/);
  });

  it("the READING side does not re-declare them either", () => {
    // Symmetric to the layout pin. Guarding only the writer leaves the other
    // half of the original defect open: route-announcement.ts could hard-code
    // the suffix again and a rename would strip nothing.
    const announcement = read("src/lib/ui/route-announcement.ts");
    expect(
      announcement.includes(`"${APP_NAME}"`),
      "route-announcement.ts hard-codes the app name again — import it from " +
        "@/lib/ui/app-title so a rename cannot leave the stripper behind",
    ).toBe(false);
    expect(
      announcement.includes(`"${APP_TITLE_SUFFIX}"`),
      "route-announcement.ts hard-codes the title suffix again",
    ).toBe(false);
    expect(announcement).toContain("@/lib/ui/app-title");
  });

  it("keeps the SSOT importable from a Server Component", () => {
    // layout.tsx is a Server Component and route-announcement.ts is pulled into
    // the client bundle, so the shared module must be a leaf: no `server-only`,
    // no DB imports. (/dashboard 500'd once on exactly this.)
    const ssot = read("src/lib/ui/app-title.ts");
    expect(ssot).not.toContain("server-only");
    expect(ssot).not.toContain("use client");
    expect(ssot).not.toMatch(/^import /m);
    // …and it is not empty, so the three absences above are not vacuous.
    expect(ssot).toContain("APP_NAME");
  });
});
