// Spec 339 U2 — the WIRING seam (spec 343 U1 lesson: this is the part nobody
// covers). The gate renders null, so its PRESENCE on a route is invisible to a
// behavioural render — only a source pin can hold it. Each pin counts the JSX
// use (`<RegisterFreshnessGate`), which never matches the `{ RegisterFreshnessGate }`
// import or a prose comment, so it is not the toContain-satisfied-by-its-import
// trap. "Exactly once" is the real invariant: it catches the gate being dropped
// from a route AND — the worse mistake — it being added to /coming-soon's
// super_admin OperatorHub or the approved-unserved card, where a forced reload
// would discard an approved user's in-flight work.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

const read = (relPath: string) => readFileSync(join(process.cwd(), relPath), "utf8");

function jsxUses(relPath: string): number {
  return read(relPath).split("<RegisterFreshnessGate").length - 1;
}

describe("RegisterFreshnessGate route wiring — spec 339 U2", () => {
  it("is mounted on the field register route", () => {
    expect(jsxUses("src/app/register/technician/page.tsx")).toBe(1);
  });

  it("is mounted on the office register route", () => {
    expect(jsxUses("src/app/register/office/page.tsx")).toBe(1);
  });

  it("is mounted exactly once on /coming-soon (visitor branch only, never the operator hub)", () => {
    expect(jsxUses("src/app/coming-soon/page.tsx")).toBe(1);
  });

  it("is NOT inside the /coming-soon super_admin OperatorHub function", () => {
    const src = read("src/app/coming-soon/page.tsx");
    const hub = src.slice(src.indexOf("function OperatorHub"));
    expect(hub).not.toContain("<RegisterFreshnessGate");
  });
});
