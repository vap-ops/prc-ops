// Writing failing test first.
//
// Spec 400 U6a — REOPEN_ERROR_COPY and ADD_ERROR_COPY moved out of
// `/team/attendance/page.tsx` into their own module so the fix page can show
// the SAME sentences for the SAME outcomes instead of drifting a second copy.
// RETIME_ERROR_COPY and UNDO_ERROR_COPY are new here. Every arm follows the
// honest-copy rule: none may say ลองใหม่ unless the next attempt could
// genuinely succeed unchanged.

import { describe, expect, it } from "vitest";
import {
  ADD_ERROR_COPY,
  REOPEN_ERROR_COPY,
  RETIME_ERROR_COPY,
  UNDO_ERROR_COPY,
} from "@/lib/muster/outcome-copy";

/** The ratchet's OWN regex, not a substring of it.
 *
 *  ⚠️ Fresh-eyes finding (2026-08-07): this checked only "ลองใหม่", while the
 *  house rule and `honest-copy-ratchet.test.ts` both use
 *  `/ลองใหม่|ลองอีกครั้ง/`. `RETIME_ERROR_COPY.stale` ends "…ลองอีกครั้ง" and
 *  therefore DOES promise a retry — yet a test named "never promises a retry"
 *  passed on that substring technicality, and any future arm could have added
 *  the second phrasing unnoticed. False assurance inside the guard meant to
 *  prevent it, which is the fake-coverage class this repo keeps re-learning. */
const RETRY = /ลองใหม่|ลองอีกครั้ง/;

/** @param retryable keys whose failure genuinely CAN succeed unchanged on a
 *  retry, each justified where it is declared. Everything else must not. */
function assertNoRetryPromise(map: Record<string, string>, retryable: readonly string[] = []) {
  for (const [key, value] of Object.entries(map)) {
    if (retryable.includes(key)) {
      expect(value, `${key} is declared retryable — it should say so`).toMatch(RETRY);
      continue;
    }
    expect(value, `${key} must not promise a retry`).not.toMatch(RETRY);
  }
}

describe("outcome copy maps — honest-copy rule", () => {
  it("REOPEN_ERROR_COPY never promises a retry", () => {
    expect(Object.keys(REOPEN_ERROR_COPY).length).toBeGreaterThan(0);
    assertNoRetryPromise(REOPEN_ERROR_COPY);
  });

  it("ADD_ERROR_COPY never promises a retry", () => {
    expect(Object.keys(ADD_ERROR_COPY).length).toBeGreaterThan(0);
    assertNoRetryPromise(ADD_ERROR_COPY);
  });

  it("RETIME_ERROR_COPY promises a retry on `stale` ALONE, and covers every arm", () => {
    for (const key of ["denied", "shape", "bounds", "locked", "booked", "stale", "failed"]) {
      expect(RETIME_ERROR_COPY[key], `missing arm: ${key}`).toBeTruthy();
    }
    // `stale` is the ONE genuinely retryable arm in the whole unit — the page's
    // server-resolved team id went out of date, and reloading re-resolves it —
    // and it is the occurrence the honest-copy ratchet was raised 237→238 for.
    // Asserted POSITIVELY as well as negatively, so deleting the retry phrasing
    // from it (or adding one to any sibling) reds.
    assertNoRetryPromise(RETIME_ERROR_COPY, ["stale"]);
  });

  it("UNDO_ERROR_COPY never promises a retry, and covers every UndoOutcome arm", () => {
    for (const key of ["denied", "shape", "gone", "closed", "booked", "otFirst", "failed"]) {
      expect(UNDO_ERROR_COPY[key], `missing arm: ${key}`).toBeTruthy();
    }
    assertNoRetryPromise(UNDO_ERROR_COPY);
  });
});
