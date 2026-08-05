// Spec 397 U5 — the door to ทีมสำนักงาน.
//
// The operator asked for it to be PROMINENT. It sits on /team, directly under the
// วันนี้ hero — not inside the tile grid, where it would read as one of nine
// equal icons — and it is gated on SA_SURFACE_ROLES, exactly the set every muster
// write RPC admits, so the door never promises what the server refuses.
//
// /team/page.tsx is an async Server Component vitest cannot render, so this is a
// comment-stripped source pin with exact counts (the house idiom).

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SA_SURFACE_ROLES } from "@/lib/auth/role-home";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const team = strip(readFileSync("src/app/team/page.tsx", "utf8"));

describe("spec 397 U5 — the office-team door on /team", () => {
  it("links the surface exactly once, threading its own ?from", () => {
    expect(count(team, 'withBackFrom("/team/office", "/team")')).toBe(1);
    // No second, unthreaded link may survive beside it — its back chip would then
    // send the SA to /team from a page they did not come from.
    expect(count(team, '"/team/office"')).toBe(1);
  });

  it("is gated on the muster WRITE set, not on the hub's own wider audience", () => {
    // /team admits procurement + procurement_manager too (TEAM_PAGE_ROLES); the
    // office team is a write surface, so its door follows the RPCs' set.
    expect(count(team, "SA_SURFACE_ROLES.includes(ctx.role)")).toBe(1);
    expect(SA_SURFACE_ROLES).toContain("site_admin");
    expect(SA_SURFACE_ROLES).not.toContain("procurement");
  });

  it("renders its own label, not a hand-typed duplicate of the page title", () => {
    expect(count(team, "OFFICE_TEAM_LABEL")).toBe(2); // the import + one render
    expect(team).not.toContain("ทีมสำนักงาน"); // the literal belongs in labels.ts
  });
});
