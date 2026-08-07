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

function assertNoRetryPromise(map: Record<string, string>) {
  for (const [key, value] of Object.entries(map)) {
    expect(value, `${key} must not promise a retry`).not.toContain("ลองใหม่");
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

  it("RETIME_ERROR_COPY never promises a retry, and covers every RetimeOutcome arm", () => {
    for (const key of ["denied", "shape", "bounds", "locked", "booked", "stale", "failed"]) {
      expect(RETIME_ERROR_COPY[key], `missing arm: ${key}`).toBeTruthy();
    }
    assertNoRetryPromise(RETIME_ERROR_COPY);
  });

  it("UNDO_ERROR_COPY never promises a retry, and covers every UndoOutcome arm", () => {
    for (const key of ["denied", "shape", "gone", "closed", "booked", "otFirst", "failed"]) {
      expect(UNDO_ERROR_COPY[key], `missing arm: ${key}`).toBeTruthy();
    }
    assertNoRetryPromise(UNDO_ERROR_COPY);
  });
});
