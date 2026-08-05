// Spec 397 U5 — the PAGE-level wiring of /team/office.
//
// The U3 review found this exact gap the hard way: the gate and the outcome
// banners live in the page while every test rendered the child, so a redirect
// whose params never reached the page shipped green through 7,000 tests. The page
// is an async Server Component vitest cannot render, so these are comment-stripped
// source pins with exact counts — the house idiom for that case.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const page = strip(readFileSync("src/app/team/office/page.tsx", "utf8"));
const actions = strip(readFileSync("src/app/team/office/actions.ts", "utf8"));

describe("spec 397 U5 — the page's gate", () => {
  it("admits exactly the muster WRITE set", () => {
    expect(count(page, "requireRole(SA_SURFACE_ROLES)")).toBe(1);
    // Never a restated literal — the RPC's allowlist is the SSOT.
    expect(page).not.toContain('"procurement_manager"');
  });
});

describe("spec 397 U5 — outcomes are CODES, never text from the URL", () => {
  it("the action never puts a message in the query", () => {
    // The first cut redirected with `&m=<Thai sentence>` and the page rendered it
    // inside its own ErrorNotice — unbounded, forgeable, in the app's red box.
    // Precise pins: the redirect carries ONE param, and the mapped Thai only ever
    // reaches classify() — never the URL. (`r.error)` would also match
    // `classify(r.error)` itself, so it is not the thing to assert.)
    expect(actions).not.toContain('set("m"');
    expect(actions).not.toContain("encodeURIComponent");
    expect(count(actions, "redirect(`${HERE}?o=${outcome}`)")).toBe(1);
    expect(count(actions, "classify(r.error)")).toBe(4); // one per form action
  });

  it("the page maps every code it can receive, and reads nothing else", () => {
    for (const code of ["opened", "added", "out", "removed"]) {
      expect(page).toContain(`${code}:`);
    }
    for (const code of ["denied", "alreadyin", "failed"]) {
      expect(page).toContain(`${code}:`);
    }
    // The only param it reads besides the back-referrer.
    expect(count(page, "searchParams")).toBeGreaterThanOrEqual(1);
    // Asserted on the field name WITH its punctuation: "m?: string" is a substring
    // of "from?: string", which made the first version of this pin fail against
    // correct code — the assertion, not the page, was wrong.
    expect(page).not.toContain("; m?:");
  });

  it("no failure arm tells the user to retry — none of them can succeed on one", () => {
    expect(page).not.toContain("ลองใหม่");
    expect(page).not.toContain("ลองอีกครั้ง");
  });
});

describe("spec 397 U5 — the mistake is undoable", () => {
  it("every member row offers เอาออก, not just ออกงาน", () => {
    // Checking out stamps a time; it does not undo a wrong person. A ช่าง added
    // here has their real crew check-in refused all day and, once the day closes,
    // books no wage at all — and the cockpit's undo cannot see office rows.
    expect(count(page, "removeOfficeMember")).toBe(2); // the import + one render
    // The CONTROL, not the word: "เอาออก" also appears inside the `alreadyin`
    // failure copy, so a bare occurrence count stays green with the button deleted.
    expect(count(page, "action={removeOfficeMember}")).toBe(1);
    expect(count(actions, "undoMusterScan")).toBe(2); // the import + one call
  });
});

describe("spec 397 U5 — the two empty states are different states", () => {
  it("distinguishes an empty roster from everyone being checked in", () => {
    // Saying "everyone has checked in" beside "nobody has checked in" is a
    // contradiction the reader cannot resolve — and before U6 creates the office
    // worker rows, the empty-roster case is the live one.
    expect(count(page, "board.rosterSize === 0")).toBe(1);
    expect(page).toContain("ยังไม่มีรายชื่อทีมสำนักงานในโครงการนี้");
    expect(page).toContain("ทุกคนในทีมสำนักงานเช็คชื่อแล้ววันนี้");
  });
});
