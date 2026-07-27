// Writing failing test first.
//
// 2026-07-27 — the awaiting-bank queue was invisible. Live evidence: 14
// `worker_bank_capture` rows sat `pending_pm` with ZERO of those workers carrying a
// `bank_account_number`, oldest onboarded 07-13 — so the spec-298 U3 transcription
// step had NEVER run in production and none of those men could be paid.
//
// It was never a permission problem: `procurement_manager` has been in
// STAFF_APPROVAL_ROLES and in the `complete_worker_bank` allowlist the whole time.
// It was reach — the queue hung off a bare, unbadged text link on /registrations,
// itself two taps in behind a zero-suppressed tile, rendering identically at 14
// waiting and at 0.
//
// Both surfaces are Server Components that vitest cannot render, so they are pinned
// by source scan. Comments are stripped FIRST, so documenting a symbol can never
// satisfy the assertion about using it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    // strip block + line comments so prose about a symbol cannot pin the symbol
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const TEAM_PAGE = read("src/app/team/page.tsx");
const REGISTRATIONS_PAGE = read("src/app/registrations/page.tsx");
const QUEUE_LIB = read("src/lib/register/worker-bank-queue.ts");

const occurrences = (src: string, needle: string) => src.split(needle).length - 1;

describe("the awaiting-bank count reaches both surfaces", () => {
  // ≥2 = the import PLUS a real call. A bare `toContain` is satisfied by the
  // import line alone, which is the fake-coverage trap this repo keeps re-learning.
  it("/team fetches the count AND passes it to the tiles", () => {
    expect(occurrences(TEAM_PAGE, "countWorkersAwaitingBank")).toBeGreaterThanOrEqual(2);
    // NOT a bare toContain("awaitingBank") — that is satisfied by the `const
    // awaitingBank = …` declaration alone, so dropping it from the counts object
    // would kill the bubble with the assertion still green (fresh-eyes catch).
    expect(TEAM_PAGE).toContain("awaitingBank,");
    expect(occurrences(TEAM_PAGE, "awaitingBank")).toBeGreaterThanOrEqual(2);
  });

  it("/registrations fetches the count too, so the inner link can badge itself", () => {
    expect(occurrences(REGISTRATIONS_PAGE, "countWorkersAwaitingBank")).toBeGreaterThanOrEqual(2);
    expect(REGISTRATIONS_PAGE).toContain("awaitingBank > 0");
  });

  // The whole point of a separate counter: the list reader signs a Storage URL per
  // row. Counting through it would issue one signing round-trip per waiting worker
  // on every hub render — for a number nobody clicks.
  it("the counter is a head-count, never the signed-URL list reader", () => {
    expect(QUEUE_LIB).toContain("head: true");
    const counter = QUEUE_LIB.slice(QUEUE_LIB.indexOf("countWorkersAwaitingBank"));
    expect(counter).not.toContain("createSignedUrl");
  });

  // /team pays for the count ONLY for the tier whose tile can open it — and pays for
  // it in the SAME round-trip as the other approver-only count, not a second serial
  // await. Pinned on the gate + the batching, not on one exact expression, so the
  // assertion cannot itself block a future refactor.
  it("/team gates the fetch on the approver tier and batches it", () => {
    const gate = /isApprover\s*\?\s*await Promise\.all\(\[/;
    expect(TEAM_PAGE).toMatch(gate);
    const batched = TEAM_PAGE.slice(TEAM_PAGE.search(gate));
    expect(batched.slice(0, batched.indexOf("]"))).toContain("countWorkersAwaitingBank()");
  });
});
