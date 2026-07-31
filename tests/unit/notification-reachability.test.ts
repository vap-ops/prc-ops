import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  classifyReachability,
  summarizeReachability,
  type ReachabilityRow,
} from "@/lib/notifications/reachability";

// Spec 386 U5 — the onboarding roster. Operator, 2026-07-31: "where do I track
// the status who is onboarding to this feature?" Answer at the time: nowhere.
//
// ⭐ THE RULE THIS FILE EXISTS TO ENFORCE: `line_oa_friend === null` means NEVER
// PROBED, not unreachable. The flag is only refreshed at LINE login (spec 318
// U1), so 9 of the 17 office-tier users sit at null right now. Rendering null as
// a red ✗ would send the operator chasing people who may already be fine — the
// same "unknown is not false" trap the readiness banner already respects by
// rendering nothing on null.

const SOURCE = readFileSync(join(process.cwd(), "src/lib/notifications/reachability.ts"), "utf8");

const row = (over: Partial<ReachabilityRow> = {}): ReachabilityRow => ({
  telegram_chat_id: null,
  line_oa_friend: null,
  ...over,
});

describe("classifyReachability", () => {
  it("is 'telegram' when a chat id is bound — the strongest signal", () => {
    expect(classifyReachability(row({ telegram_chat_id: "123", line_oa_friend: false }))).toBe(
      "telegram",
    );
  });

  it("is 'line' for a confirmed OA friend with no Telegram", () => {
    expect(classifyReachability(row({ line_oa_friend: true }))).toBe("line");
  });

  it("is 'unknown' — NOT 'none' — when the friend flag was never probed", () => {
    expect(classifyReachability(row({ line_oa_friend: null }))).toBe("unknown");
  });

  it("is 'none' only when the user is CONFIRMED not a friend and unbound", () => {
    expect(classifyReachability(row({ line_oa_friend: false }))).toBe("none");
  });
});

describe("summarizeReachability", () => {
  it("counts each bucket separately so unknown never inflates unreachable", () => {
    const s = summarizeReachability([
      row({ telegram_chat_id: "a" }),
      row({ line_oa_friend: true }),
      row({ line_oa_friend: null }),
      row({ line_oa_friend: null }),
      row({ line_oa_friend: false }),
    ]);
    expect(s).toEqual({ total: 5, telegram: 1, line: 1, unknown: 2, none: 1 });
  });

  it("handles an empty roster", () => {
    expect(summarizeReachability([])).toEqual({
      total: 0,
      telegram: 0,
      line: 0,
      unknown: 0,
      none: 0,
    });
  });
});

describe("the classifier must not collapse unknown into unreachable", () => {
  it("treats the null flag as its own arm in the source", () => {
    // A future "simplification" to `line_oa_friend ? 'line' : 'none'` would pass
    // every other test in this file except the unknown case above; this pins the
    // intent in the code as well, so the reason survives a refactor.
    expect(SOURCE).toContain("unknown");
    expect(SOURCE).not.toMatch(/return\s+row\.line_oa_friend\s*\?\s*"line"\s*:\s*"none"/);
  });
});
