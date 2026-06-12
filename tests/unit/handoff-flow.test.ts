// Spec 43 — callback flow resolution (pure). Pins the precedence the
// callback route relies on: a valid state cookie always wins (ADR 0012
// browser flow, untouched); only then is a pending unexpired handoff
// row honored; everything else is invalid.

import { describe, it, expect } from "vitest";
import { resolveCallbackFlow } from "@/lib/auth/handoff-flow";

const NOW = Date.parse("2026-06-12T12:00:00Z");
const FUTURE = new Date(NOW + 60_000).toISOString();
const PAST = new Date(NOW - 60_000).toISOString();

const row = (status: string, expires_at = FUTURE) => ({ id: "h1", status, expires_at });

describe("resolveCallbackFlow", () => {
  it("matching state cookie → browser flow (handoff row ignored)", () => {
    expect(
      resolveCallbackFlow({
        stateParam: "s",
        stateCookie: "s",
        handoffRow: row("pending"),
        nowMs: NOW,
      }),
    ).toEqual({ kind: "browser" });
  });

  it("no cookie + pending unexpired row → handoff flow", () => {
    expect(
      resolveCallbackFlow({
        stateParam: "s",
        stateCookie: null,
        handoffRow: row("pending"),
        nowMs: NOW,
      }),
    ).toEqual({ kind: "handoff", rowId: "h1" });
  });

  it("mismatched cookie does NOT fall back silently without a row", () => {
    expect(
      resolveCallbackFlow({ stateParam: "s", stateCookie: "other", handoffRow: null, nowMs: NOW }),
    ).toEqual({ kind: "invalid" });
  });

  it("expired handoff row → invalid", () => {
    expect(
      resolveCallbackFlow({
        stateParam: "s",
        stateCookie: null,
        handoffRow: row("pending", PAST),
        nowMs: NOW,
      }),
    ).toEqual({ kind: "invalid" });
  });

  it("already-approved row → invalid (state is single-use)", () => {
    expect(
      resolveCallbackFlow({
        stateParam: "s",
        stateCookie: null,
        handoffRow: row("approved"),
        nowMs: NOW,
      }),
    ).toEqual({ kind: "invalid" });
  });

  it("missing state param → invalid", () => {
    expect(
      resolveCallbackFlow({ stateParam: null, stateCookie: null, handoffRow: null, nowMs: NOW }),
    ).toEqual({ kind: "invalid" });
  });
});
