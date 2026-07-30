// Writing failing test first.
//
// Spec 384 U1 — the grouping itself is pinned behaviourally in sa-action-groups
// and sa-action-section-groups. This file pins what lives in the /sa page, which
// is a Server Component vitest cannot render: that the page actually supplies the
// two AGES the band and the ordering read, and the cutoff the band is drawn at.
//
// Drop any one of them and nothing else in the suite notices — every row silently
// gets a null age, so the band empties, the groups fall back to the project/code
// order, and the surface looks correct while asserting nothing.
//
// Comments are stripped first, and occurrence counts are EXACT: a symbol used
// twice still passes a `>= 2` check with one of its uses deleted (spec 371).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_ACTION_DAYS, staleCutoffIso } from "@/lib/sa/action-list";

const SA_HOME = join(process.cwd(), "src/app/sa/page.tsx");

function withoutComments(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function occurrences(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

describe("spec 384 U1 — the /sa page feeds the ages the band reads", () => {
  it("threads the decision timestamp onto every bounced row", () => {
    const src = withoutComments(SA_HOME);
    // Already fetched by getLatestDecisionsForWorkPackages — this is the one line
    // that carries it onto the item the section groups.
    expect(occurrences(src, "decidedAt: dec.decided_at")).toBe(1);
  });

  it("selects and threads the reopen timestamp for rework rows", () => {
    const src = withoutComments(SA_HOME);
    // The reopen query already ORDERS by created_at; without it in the SELECT the
    // value is simply absent and every rework row reads as unknown-age.
    expect(occurrences(src, '.select("target_id, payload, created_at")')).toBe(1);
    expect(occurrences(src, "since: reopen?.created_at ?? null")).toBe(1);
  });

  it("draws the band at the cutoff, with the clock read OUTSIDE the render body", () => {
    const src = withoutComments(SA_HOME);
    expect(occurrences(src, "staleBeforeIso={staleCutoffFromNow()}")).toBe(1);
    // A literal Date.now() here is rejected by the React Compiler lint, and an
    // inline cutoff would make the page untestable — the helper is the contract.
    expect(occurrences(src, "Date.now()")).toBe(0);
  });
});

describe("spec 384 U1 — the stale cutoff", () => {
  it("is 3 days, the empty band in a bimodal age distribution", () => {
    // 2026-07-31: 29 open bounces aged 1–3 days, 7 aged 6–10, NOTHING at 4–5.
    // Spec 384 §6 ③ re-runs that query as acceptance; if the gap closes this
    // constant is wrong and the band splits a real mode.
    expect(STALE_ACTION_DAYS).toBe(3);
  });

  it("returns the ISO instant STALE_ACTION_DAYS before the given clock", () => {
    expect(staleCutoffIso(Date.parse("2026-07-31T09:00:00.000Z"))).toBe("2026-07-28T09:00:00.000Z");
  });
});
