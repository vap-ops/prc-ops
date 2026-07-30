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
  it("is 5 days — the centre of the empty interval, measured in ELAPSED time", () => {
    // 2026-07-31, `now() - decided_at`: 29 open bounces below 4.0 days, 7 above
    // 6.0, NOTHING between. 5 sits dead centre with a day of slack either side.
    //
    // ⚠️ It was 3 for one commit, derived from a `now()::date - decided_at::date`
    // histogram — whose "1–3 day" mode is really elapsed [0, 4). The code compares
    // elapsed instants, so a 3-day cut sliced that mode by time of day and the
    // band rendered 18 of 36 rows. The suite was green throughout; rendering the
    // real page is what caught it. Spec 384 §6 ③ re-runs the ELAPSED query.
    expect(STALE_ACTION_DAYS).toBe(5);
  });

  it("returns the ISO instant STALE_ACTION_DAYS before the given clock", () => {
    expect(staleCutoffIso(Date.parse("2026-07-31T09:00:00.000Z"))).toBe("2026-07-26T09:00:00.000Z");
  });
});
