import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time shared-secret check for inbound webhook/cron authentication.
 *
 * Hashing BOTH sides to a fixed 32 bytes normalizes length, which is what makes
 * `timingSafeEqual` applicable at all — it throws on length-mismatched buffers,
 * and a plain `===` leaks the common prefix through timing.
 *
 * Extracted from the notification drain (spec 386 U2) rather than forked: the
 * Telegram webhook needs exactly this check, and a second hand-rolled copy is
 * how the two drift. Server-only — it is never part of a client bundle.
 */
export function secretMatches(provided: string | null | undefined, expected: string): boolean {
  const a = createHash("sha256")
    .update(provided ?? "")
    .digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
