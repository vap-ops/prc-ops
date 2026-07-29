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

// Spec 375 U3 — the /sa home no longer hosts the door DIRECTLY. It became the
// right half of the เบิกจากคลังหน้างาน custody pair, alongside เบิกวัสดุ, because
// the SA holds materials and equipment both and both are withdrawals from the
// same store. The pair owns the scan href now (pinned in store-withdraw-pair
// .test.tsx); what this file still guards is that the standalone door has not
// crept BACK onto /sa as a second equipment door, and that the store page —
// the other host, unchanged — kept its copy.
describe("scan door placement — /sa home (retired in favour of the pair)", () => {
  it("no longer renders the standalone door", () => {
    const src = withoutComments(SA_HOME);
    // Bare, not quote-wrapped: a revert to plain JSX must red this too.
    expect(occurrences(src, "EquipmentScanDoor")).toBe(0);
  });

  it("renders the custody pair in its place, ungated, above the tools grid", () => {
    const src = withoutComments(SA_HOME);
    expect(occurrences(src, "StoreWithdrawPair")).toBe(2); // import + one usage
    expect(src).toMatch(/\n\s*<StoreWithdrawPair projectId=\{primaryProjectId\} from="\/sa" \/>\n/);
    const plan = src.indexOf("<DailyPlanWorklist");
    const pair = src.indexOf("<StoreWithdrawPair");
    const tools = src.indexOf("<SaTools");
    expect(plan).toBeGreaterThan(-1);
    expect(pair).toBeGreaterThan(plan);
    expect(tools).toBeGreaterThan(pair);
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

  it("threads its own route as the back href", () => {
    // An empty or copy-pasted `from` degrades silently: /equipment/scan runs it
    // through safeBackHref, so a wrong value lands the user on a default rather
    // than erroring. Spec 375 U3: the /sa host is gone (the custody pair owns
    // that href now and pins its own `from`), so only the store host remains here.
    expect(withoutComments(STORE)).toContain(
      "<EquipmentScanDoor from={`/projects/${project.id}/store`} />",
    );
  });

  it("puts the door above the stock console", () => {
    const src = withoutComments(STORE);
    const door = src.indexOf("<EquipmentScanDoor");
    const stock = src.indexOf("<StoreManager");
    expect(door).toBeGreaterThan(-1);
    expect(stock).toBeGreaterThan(door);
  });
});
