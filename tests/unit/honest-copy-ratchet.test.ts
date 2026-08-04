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

  it("retry-copy occurrences never grow past the ceiling", () => {
    expect(
      total,
      `retry copy ("ลองใหม่"/"ลองอีกครั้ง") grew past the ratchet ceiling. Is this failure ` +
        `genuinely RETRYABLE? If yes: raise the ceiling in this file with a justification ` +
        `line. If no: a permanent refusal must name the cause and the next step instead — ` +
        `never "try again" (house honest-copy rule).`,
    ).toBeLessThanOrEqual(228); // measured 2026-08-04 — lower opportunistically, raise only with justification
  });

  it("the number of files carrying retry copy never grows past the ceiling", () => {
    expect(
      files.size,
      `a NEW file added retry copy — read the honest-copy rule at the top of this test ` +
        `before raising the ceiling.`,
    ).toBeLessThanOrEqual(106); // measured 2026-08-04 — lower opportunistically, raise only with justification
  });
});
