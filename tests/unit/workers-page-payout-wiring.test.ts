// Spec 395 U2 — the page-side half of the badge.
//
// `/workers` is a Server Component vitest cannot render, so the BEHAVIOUR is pinned in
// worker-roster-payout-badge.test.tsx (RTL over the client component) and the WIRING is
// pinned here by source scan. Comments are stripped FIRST, so prose describing a symbol
// can never satisfy an assertion about USING it.
//
// ⚠️ The one thing that must never regress is the GATE. `WORKER_ROSTER_ROLES` (who may
// open this page) includes `project_manager`; `PAYOUT_NOMINEE_ROLES` (who may open the
// control the badge invites you to use) does NOT. Computing the state for everyone
// would ship a badge whose control refuses the reader — and, worse, would put the
// derived state into a bundle for a role with no business seeing it. The gate belongs
// at the SOURCE, not at render time.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PAGE = read("src/app/workers/page.tsx");

const occurrences = (src: string, needle: string) => src.split(needle).length - 1;

describe("/workers computes the payout-account state", () => {
  // >=2 = the import PLUS a real call; a bare toContain is satisfied by the import line.
  it("reads it through the audited admin seam", () => {
    expect(occurrences(PAGE, "loadPayoutAccountAudit")).toBe(2);
  });

  it("gates the computation on PAYOUT_NOMINEE_ROLES, not on the page's own role set", () => {
    expect(occurrences(PAGE, "PAYOUT_NOMINEE_ROLES")).toBe(2);
    // The gate must sit on the COMPUTATION, not merely be imported: the call has to be
    // inside the conditional, so a non-entitled viewer never triggers the read at all.
    const gateIdx = PAGE.indexOf("PAYOUT_NOMINEE_ROLES.includes(ctx.role)");
    const callIdx = PAGE.indexOf("loadPayoutAccountAudit(supabase)");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(gateIdx);
    // …and nothing between them re-widens it to the page gate.
    expect(PAGE.slice(gateIdx, callIdx)).not.toContain("WORKER_ROSTER_ROLES");
  });

  it("threads the state onto each roster row", () => {
    expect(occurrences(PAGE, "payoutState")).toBeGreaterThanOrEqual(2);
    expect(PAGE).toContain("payoutState: payoutStateByWorker.get(w.id) ?? null");
  });
});
