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

  it("renders unconditionally — no gate of any kind wraps it", () => {
    // A ROLE gate here would be an arm that can never fail (the spec-340
    // unreachable-clause defect); the subset invariant in role-sets.test.ts
    // carries that instead. But this pin must catch ANY wrapper, not just a
    // role one: asserting the absence of `EQUIPMENT_MOVE_ROLES` leaves
    // `{pendingRegCount > 0 ? <EquipmentScanDoor/> : null}` green. So pin the
    // render as a bare JSX sibling — nothing on its line but the element.
    const src = withoutComments(SA_HOME);
    expect(src).toMatch(/\n\s*<EquipmentScanDoor from="\/sa" \/>\n/);
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
    // Both halves of the ternary are pinned, and the leading char class rules
    // out `!canReturnEquipment ? …` — an INVERTED gate (door shown ONLY to
    // non-movers) satisfies a bare `canReturnEquipment ? <Door` substring.
    expect(src).toMatch(
      /[^!]canReturnEquipment\s*\?\s*\(?\s*<EquipmentScanDoor[^]*?\)?\s*:\s*null/,
    );
    expect(src).not.toContain("!canReturnEquipment");
  });

  it("threads its own route as the back href, not the other host's", () => {
    // An empty or copy-pasted `from` degrades silently: /equipment/scan runs it
    // through safeBackHref, so a wrong value lands the user on a default rather
    // than erroring. Pin both hosts' values.
    expect(withoutComments(STORE)).toContain(
      "<EquipmentScanDoor from={`/projects/${project.id}/store`} />",
    );
    expect(withoutComments(SA_HOME)).toContain('<EquipmentScanDoor from="/sa" />');
  });

  it("puts the door above the stock console", () => {
    const src = withoutComments(STORE);
    const door = src.indexOf("<EquipmentScanDoor");
    const stock = src.indexOf("<StoreManager");
    expect(door).toBeGreaterThan(-1);
    expect(stock).toBeGreaterThan(door);
  });
});
