// Writing failing test first.
//
// Spec 370 U4 (prominence redesign) — WHERE the door renders. Both hosts are
// Server Components vitest cannot render, so placement is pinned by source with
// comments stripped first (a comment quoting a symbol must not satisfy a pin,
// and a comment quoting a retired literal must not trip an absence pin).
//
// The store-page pin is the one that matters most: #821's raw <Link> is being
// replaced, and the ONLY thing stopping a revert is this file — the component
// test beside it stays green either way.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SA_HOME = join(process.cwd(), "src/app/sa/page.tsx");
const STORE = join(process.cwd(), "src/app/projects/[projectId]/store/page.tsx");

function withoutComments(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function occurrences(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

describe("scan door placement — /sa home", () => {
  it("imports and renders the door exactly once", () => {
    const src = withoutComments(SA_HOME);
    // import line PLUS one real usage; a bare toContain would pass on the import alone.
    expect(occurrences(src, "EquipmentScanDoor")).toBe(2);
    expect(occurrences(src, "<EquipmentScanDoor")).toBe(1);
  });

  it("sits between แผนวันนี้ and the เครื่องมือ tiles", () => {
    const src = withoutComments(SA_HOME);
    const plan = src.indexOf("<DailyPlanWorklist");
    const door = src.indexOf("<EquipmentScanDoor");
    const tools = src.indexOf("<SaTools");
    expect(plan).toBeGreaterThan(-1);
    expect(door).toBeGreaterThan(plan);
    expect(tools).toBeGreaterThan(door);
  });

  it("renders ungated — every SA-home role is an equipment mover (pinned in role-sets)", () => {
    // A role gate here would be an arm that can never fail (the spec-340
    // unreachable-clause defect). The subset invariant carries it instead.
    const src = withoutComments(SA_HOME);
    expect(src).not.toContain("EQUIPMENT_MOVE_ROLES");
  });
});

describe("scan door placement — project store", () => {
  it("renders the shared door instead of #821's inline link", () => {
    const src = withoutComments(STORE);
    expect(occurrences(src, "EquipmentScanDoor")).toBe(2);
    // The literal now lives in the component. Pinned BARE so a revert to plain
    // JSX text — not just a quoted string — reds this.
    expect(src).not.toContain("สแกนยืม/คืนอุปกรณ์");
  });

  it("keeps the movers-only gate — a store page is readable by non-movers", () => {
    const src = withoutComments(STORE);
    expect(src).toMatch(/canReturnEquipment\s*\?\s*\(?\s*<EquipmentScanDoor/);
  });

  it("puts the door above the stock console", () => {
    const src = withoutComments(STORE);
    const door = src.indexOf("<EquipmentScanDoor");
    const stock = src.indexOf("<StoreManager");
    expect(door).toBeGreaterThan(-1);
    expect(stock).toBeGreaterThan(door);
  });
});
