// Honest-copy ratchet (UX-audit 2026-08, consistency-machine gap §6 row 5).
//
// House rule, applied in at least three libs and recorded in memory
// (delivery-photo-storage-rls-fix-2026-07): a PERMANENT refusal must never say
// "ลองใหม่" / "ลองอีกครั้ง" — telling a user to retry an action that can never
// succeed strands them in a retry loop (the #456/#823 class; the app-wide error
// boundary still violates it — UX-audit gap G1, its own fix lane). ~15 tests pin
// the rule per-surface, but nothing watched the WHOLE tree, so every NEW surface
// re-decides it alone.
//
// This is a CEILING ratchet, not a semantic check — a grep cannot know whether a
// given failure is retryable. What it CAN do is make growth deliberate: adding
// retry copy to any file bumps a counter over the ceiling and lands the author
// here, where the rule is stated. If your new failure IS retryable, raise the
// ceiling in the same PR with a one-line justification — that review moment is
// the entire point of this file. If it is NOT retryable, name the real cause and
// the next step instead (see src/lib/register/registration-error.ts or the
// /settings delivery-health notice for the house pattern).
//
// Comments are stripped LINE-BASED before counting (a doc comment quoting the
// literal must not count — the house has been bitten by guards satisfied by
// their own documentation; and mid-line stripping would eat `https://` URLs).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");
const RETRY = /ลองใหม่|ลองอีกครั้ง/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("honest-copy ratchet (retry copy never grows silently)", () => {
  let total = 0;
  const files = new Set<string>();
  for (const abs of walk(SRC)) {
    const src = readFileSync(abs, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      // strip full trailing line comments conservatively: only when the `//` is
      // preceded by whitespace and the line holds no string quote after it —
      // keeps `https://` (inside strings) intact.
      .replace(/\s\/\/ [^"'`\n]*$/gm, "");
    const n = (src.match(RETRY) ?? []).length;
    if (n > 0) {
      total += n;
      files.add(relative(SRC, abs));
    }
  }

  it("the scan sees the known retry-copy surface (not vacuous)", () => {
    // labels.ts carries several retry strings — if the scan misses even that,
    // the instrument is broken and the ceilings below prove nothing.
    expect([...files].some((f) => f.endsWith("labels.ts"))).toBe(true);
    expect(total).toBeGreaterThan(100);
  });

  // EXACT counts, not ceilings — a `<=` ceiling turns every removal into
  // silently re-spendable budget for a later wrong "try again" (review catch).
  // Lower them in the same PR when copy is removed; raise them only with a
  // written retryability justification.
  it("retry-copy occurrences match the ledger exactly", () => {
    expect(
      total,
      `retry copy ("ลองใหม่"/"ลองอีกครั้ง") count changed. GREW: is this failure genuinely ` +
        `RETRYABLE? If yes, raise this number with a justification line; if no, a permanent ` +
        `refusal must name the cause and the next step instead — never "try again" (house ` +
        `honest-copy rule). SHRANK: lower this number in the same PR.`,
      // 226 → 228, spec 391 U2: the hide/unhide pair's GENERIC arm.
      // JUSTIFICATION (the ratchet demands one): both new occurrences are
      // "ซ่อนรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" — the action's fallback and the
      // component's — and they are reached ONLY when the RPC fails with
      // something other than a known refusal, i.e. network/transport/unknown.
      // That is genuinely retryable. The two PERMANENT refusals this pair can
      // raise do NOT use retry copy: 42501 answers
      // "เฉพาะผู้อำนวยการโครงการเท่านั้นที่ปักดาวได้" and 22023 answers
      // "ซ่อนรูปไม่ได้: ไม่พบรูปนี้" — each naming the cause instead of inviting
      // a retry that cannot succeed.
    ).toBe(228); // measured 2026-08-04; lowered same day by the G1 boundary unit, then +2 by spec 391 U2 (justified above)
  });

  it("the number of files carrying retry copy matches the ledger exactly", () => {
    expect(
      files.size,
      `the retry-copy file set changed — a NEW file added retry copy (read the honest-copy ` +
        `rule at the top of this test first), or a file dropped it (lower this number).`,
    ).toBe(104); // measured 2026-08-04; lowered same day by the G1 boundary unit (error.tsx + global-error.tsx left the set)
  });
});
