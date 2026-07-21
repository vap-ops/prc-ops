// Writing failing test first.
//
// Spec 334 U3 — the /team hub recompose. The two list blocks that made the page a
// ~30-row wall — the staged onboarding roster and the inline site team board —
// LEAVE the hub: the merged board moves to /team/roster (U2) and the รอตรวจ gate
// becomes the คำขอสมัคร tile's bubble. The hub instead leads with the วันนี้ hero
// (MusterTodayCard) and a tile grid (TeamTiles).
//
// This is a source-scan pin (fs read, like team-page.test.ts): the retired blocks
// are asserted ABSENT by their own bare component names, and the hero + grid
// asserted PRESENT by the ≥2-occurrence (import + render) idiom. Both directions
// are mutation-checked.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PAGE = "src/app/team/page.tsx";
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("spec 334 U3 — the retired blocks leave the /team hub", () => {
  it("the hub renders neither the staged roster nor the inline site board", () => {
    const src = read(PAGE);
    // Bare, unquoted component names — a JSX render, an import, or even a comment
    // mentioning them trips this. That is the point: the mutation-check re-adds a
    // comment bearing one and this pin must go red.
    expect(src).not.toContain("CrewProgressRoster");
    expect(src).not.toContain("SiteTeamBoard");
  });

  it("the crew-progress-roster component file is deleted from disk", () => {
    expect(
      existsSync(join(process.cwd(), "src/components/features/sa/crew-progress-roster.tsx")),
    ).toBe(false);
  });
});

describe("spec 334 U3 — the hub leads with the hero + tile grid", () => {
  it("mounts the MusterTodayCard hero (import + render ≥ 2 occurrences)", () => {
    expect(count(read(PAGE), "MusterTodayCard")).toBeGreaterThanOrEqual(2);
  });

  it("renders the TeamTiles grid (import + render ≥ 2 occurrences)", () => {
    expect(count(read(PAGE), "TeamTiles")).toBeGreaterThanOrEqual(2);
  });
});
