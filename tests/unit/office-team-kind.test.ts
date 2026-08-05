// Spec 397 U4 — the office team must not leak into CREW surfaces.
//
// `muster_teams.kind` defaults to `crew`, so every existing row and caller is
// unaffected. What needs deciding is each READER: a team read either means "the
// ช่าง crews" (filter it) or "this project-day had a muster" (do not).
//
// The four reads, each classified once and pinned here, because a missed one is
// invisible — an office team simply appears as an extra crew with no หัวหน้า:
//
//   loadMusterBoard          → CREW. It groups by lead_worker_id, and an office
//                              team is leadless: it would render a headless group.
//   prior team BY LEAD       → structurally crew already (`eq(lead_worker_id)`
//                              never matches a null lead). Not filtered; pinned
//                              as a comment so nobody "fixes" it later.
//   prior team rows          → CREW. They seed crew suggestions from the last
//                              days; office attendance must not suggest an office
//                              person into a ช่าง crew.
//   unclosed prior days      → NOT filtered. Closure is a project-DAY fact, so an
//                              office-only day still needs closing; filtering here
//                              would HIDE an unclosed day.
//   day summary (the /team hub วันนี้ card) → CREW. The card is the crew's, and
//                              U5 owns the office surface. Counting office people
//                              there would change a number nobody asked to change.
//
// Source pins with exact counts (comment-stripped): these are DB query builders
// vitest cannot execute without a live database, and the pure shaper below them
// (`summariseMusterDay`) never sees a team row at all.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const board = strip(readFileSync("src/lib/muster/load-muster.ts", "utf8"));
const summary = strip(readFileSync("src/lib/muster/day-summary.ts", "utf8"));

describe("spec 397 U4 — crew readers exclude the office team", () => {
  it("the cockpit board reads CREW teams only", () => {
    // Two crew-scoped reads: the day's board, and the prior-day rows that seed
    // suggestions. The by-lead read needs no filter (a null lead never matches).
    expect(count(board, '.eq("kind", "crew")')).toBe(2);
  });

  it("the /team hub's วันนี้ card counts CREW teams only", () => {
    expect(count(summary, '.eq("kind", "crew")')).toBe(1);
  });

  it("the unclosed-prior-day scan is NOT filtered — closure is a project-day fact", () => {
    // If this ever gains a kind filter, an office-only day stops being reported as
    // unclosed and its wages never derive. The comment is the decision; this is
    // the guard that the decision was not quietly reversed.
    // Anchored on the FUNCTION, not on the type name: `UnclosedPriorDay` first
    // appears in the import line at the top, so slicing from there swept in the
    // crew reads above and the assert failed against correct code.
    const unclosed = board.slice(board.indexOf("export async function loadUnclosedPriorDays"));
    expect(unclosed.length).toBeGreaterThan(200); // the anchor resolved
    expect(unclosed).toContain('.from("muster_teams")');
    expect(unclosed).not.toContain('.eq("kind", "crew")');
  });
});

describe("spec 397 U4 — the kind is a typed enum, not a string", () => {
  it("database.types.ts carries the enum", () => {
    const types = readFileSync("src/lib/db/database.types.ts", "utf8");
    expect(types).toContain("muster_team_kind");
    expect(types).toContain('"office"');
  });

  it("open_muster_team's generated args include p_kind", () => {
    const types = readFileSync("src/lib/db/database.types.ts", "utf8");
    const at = types.indexOf("open_muster_team");
    expect(at).toBeGreaterThan(-1);
    expect(types.slice(at, at + 400)).toContain("p_kind");
  });
});
