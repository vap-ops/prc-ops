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
  return (
    src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Also skip `//` preceded by a quote or slash, so a protocol-relative URL
      // in a string (`"//cdn…"`) or a regex literal is not eaten — eating one
      // would silently truncate the line and turn an absence pin into a pass.
      .replace(/(^|[^:"'/\\])\/\/.*$/gm, "$1")
  );
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

  it("DERIVES them in source — the value check above cannot see a re-hardcoded literal", () => {
    // A mutation proved the assertion above is tautological on its own: writing
    // `APP_TITLE_SUFFIX = " — PRC Ops"` back as a literal still equals
    // `${SEPARATOR}${NAME}` while the values happen to match, which is exactly
    // the defect this whole unit exists to remove — one level down. Only the
    // source can distinguish "composed" from "coincidentally equal".
    const ssot = read("src/lib/ui/app-title.ts");
    expect(
      ssot,
      "APP_TITLE_SUFFIX is not composed from APP_NAME — a rename would leave it behind",
    ).toMatch(/APP_TITLE_SUFFIX\s*=\s*`\$\{APP_TITLE_SEPARATOR\}\$\{APP_NAME\}`/);
    expect(ssot, "APP_TITLE_TEMPLATE is not composed from APP_TITLE_SUFFIX").toMatch(
      /APP_TITLE_TEMPLATE\s*=\s*`%s\$\{APP_TITLE_SUFFIX\}`/,
    );
    // APP_NAME is the only place the product's name may appear as a literal.
    expect(ssot.split(APP_NAME).length - 1, "the name appears more than once in the SSOT").toBe(1);
  });

  it("strips a HAND-WRITTEN title — an oracle that does not depend on the constants", () => {
    // The one assertion here that is independent of the code under test. A
    // review caught that `pageNameFromTitle(APP_TITLE_TEMPLATE.replace("%s", x))`
    // expands to `x + APP_TITLE_SUFFIX`, i.e. byte-identical to the OLD
    // constant-against-itself test and with the same kill set — it proves the
    // stripper still strips, and nothing about drift. This literal is what the
    // shipped HTML actually contains (verified in the browser), so it fails if
    // the composed title ever stops matching reality. Renaming the app is then a
    // deliberate one-line edit here, which is the correct cost for an oracle.
    expect(pageNameFromTitle("โครงการ — PRC Ops")).toBe("โครงการ");
  });

  it("round-trips every page name through the real template", () => {
    // Complements the oracle above: the stripper must be the exact inverse of
    // the template for arbitrary names, including Thai and names containing
    // spaces. (Anti-drift power lives in the source pins below, not here.)
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

  it("uses the constants UNMODIFIED — not merely mentions them", () => {
    // Absence alone is satisfied by deleting the metadata, so require the usage
    // — but a prefix match is not enough either. `default: APP_NAME.toUpperCase()`
    // and `template: APP_TITLE_TEMPLATE.replace("—", "-")` both satisfy a
    // `default:\s*APP_NAME` regex while shipping every page title in a different
    // shape and silently breaking the stripper. So the value must END at the
    // constant: anchor on the trailing comma.
    expect(layoutSource.split("APP_NAME").length - 1).toBeGreaterThanOrEqual(2); // import + use
    expect(layoutSource.split("APP_TITLE_TEMPLATE").length - 1).toBeGreaterThanOrEqual(2);
    expect(layoutSource, "layout.tsx post-processes APP_NAME instead of using it as-is").toMatch(
      /title:\s*\{[^}]*?\bdefault:\s*APP_NAME,/,
    );
    expect(
      layoutSource,
      "layout.tsx post-processes APP_TITLE_TEMPLATE instead of using it as-is",
    ).toMatch(/title:\s*\{[^}]*?\btemplate:\s*APP_TITLE_TEMPLATE,/);
  });

  it("the READING side does not re-declare them either", () => {
    // Symmetric to the layout pin. Guarding only the writer leaves the other
    // half of the original defect open: route-announcement.ts could hard-code
    // the suffix again and a rename would strip nothing.
    // Match the NAME anywhere, not the exact suffix string: a mutation wrote
    // the trimmed `"— PRC Ops"` and slipped straight past an equality check on
    // `" — PRC Ops"`. Comments are stripped above, so any surviving occurrence
    // is a real literal.
    const announcement = read("src/lib/ui/route-announcement.ts");
    expect(
      announcement.includes(APP_NAME),
      `route-announcement.ts contains the literal "${APP_NAME}" — import it from ` +
        "@/lib/ui/app-title so a rename cannot leave the stripper behind",
    ).toBe(false);
    expect(announcement).toContain("@/lib/ui/app-title");
    // …and it must strip using the SUFFIX, not rebuild it. A review found that
    // `const suffix = \`— ${APP_NAME}\`` passes every other pin here: it uses
    // APP_NAME, so the literal check is clean, yet it re-hardcodes the
    // separator and would survive a change to APP_TITLE_SEPARATOR.
    expect(
      announcement,
      "route-announcement.ts rebuilds the suffix instead of using APP_TITLE_SUFFIX",
    ).toMatch(/\bAPP_TITLE_SUFFIX\.trimStart\(\)/);
  });

  it("keeps the SSOT importable from a Server Component", () => {
    // layout.tsx is a Server Component and route-announcement.ts is pulled into
    // the client bundle, so the shared module must be a leaf: no `server-only`,
    // no DB imports. (/dashboard 500'd once on exactly this.)
    const ssot = read("src/lib/ui/app-title.ts");
    expect(ssot).not.toContain("server-only");
    expect(ssot).not.toContain("use client");
    // A re-export IS an import, and `export { X } from "…"` dodges /^import /.
    expect(ssot).not.toMatch(/\bfrom\s+["']/);
    expect(ssot).not.toMatch(/^import /m);
    // …and it is not empty, so the absences above are not vacuous.
    expect(ssot).toContain("APP_NAME");
  });
});
