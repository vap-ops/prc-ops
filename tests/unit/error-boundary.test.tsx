// UX-audit gap G1 (S0 F-012 + S1 F-027): the app-wide error boundary.
//
// F-027 — a React-boundary-caught render crash NEVER reaches window.onerror
// (React swallows it), so telemetry-provider's listener structurally cannot
// see it: crashes were invisible in interaction_events and the S0's blast
// radius was unmeasurable. The boundary itself must emit js_error.
//
// F-012 — the boundary said "ลองใหม่" for EVERY crash, and the button re-runs
// the crash. Honest-copy split: a FIRST occurrence is genuinely retryable
// (transient state) and keeps the retry primary; a crash that RECURRED after
// the user already pressed retry must stop promising retry and name real next
// steps (home, report) — the house honest-copy rule at the widest surface.
// Recurrence is tracked in sessionStorage keyed by error.digest, and per the
// spec-339 lesson the counter is written BEFORE reset() and a throwing
// sessionStorage must never block the reset itself.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const trackFriction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telemetry/friction", () => ({ trackFriction }));

import ErrorBoundary from "@/app/error";

type BoundaryError = Error & { digest?: string };

function makeError(digest?: string): BoundaryError {
  const e = new Error("boom from render") as BoundaryError;
  e.name = "TypeError";
  if (digest) e.digest = digest;
  return e;
}

describe("app error boundary (UX-audit G1)", () => {
  beforeEach(() => {
    cleanup();
    trackFriction.mockClear();
    sessionStorage.clear();
  });

  it("emits a js_error friction event with message, digest and route (F-027)", () => {
    render(<ErrorBoundary error={makeError("d123")} reset={() => {}} />);
    expect(trackFriction).toHaveBeenCalledTimes(1);
    const [type, ctx] = trackFriction.mock.calls[0]!;
    expect(type).toBe("js_error");
    expect(ctx).toMatchObject({
      where: "error_boundary",
      digest: "d123",
    });
    expect(String(ctx.message)).toContain("TypeError");
    expect(ctx).toHaveProperty("route");
  });

  it("first occurrence: retry is primary and pressing it calls reset()", () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={makeError("d1")} reset={reset} />);
    // the recurred-state alert is NOT shown on first occurrence (contrasting
    // control — asserted BEFORE the click; the click itself flips the
    // same-instance state by design, covered by its own test below)
    expect(screen.queryByRole("alert")).toBeNull();
    const retry = screen.getByRole("button", { name: "ลองใหม่" });
    fireEvent.click(retry);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("pressing retry durably records the attempt for this digest", () => {
    render(<ErrorBoundary error={makeError("d2")} reset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(sessionStorage.getItem("err-retry:d2")).toBe("1");
  });

  it("a failed reset on the SAME instance flips to the honest variant (no remount needed)", () => {
    // Next/React can restore this exact fallback instance when the reset
    // attempt throws before commit — a mount-time-only read would keep the
    // retry promise forever. In-instance state must flip by itself.
    render(<ErrorBoundary error={makeError("d5")} reset={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).toBeNull();
  });

  it("recurred after retry: honest copy replaces the retry promise (F-012)", () => {
    sessionStorage.setItem("err-retry:d3", "1");
    render(<ErrorBoundary error={makeError("d3")} reset={() => {}} />);
    // the one failure surface a screen reader must announce
    const alert = screen.getByRole("alert");
    // no "try again" promise in the recurred message
    expect(alert.textContent).not.toContain("กรุณาลองใหม่อีกครั้ง");
    // real next steps: home (a full <a> navigation, not router state in a
    // broken tree) and report
    expect(screen.getByRole("link", { name: /กลับหน้าหลัก/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /แจ้งปัญหา/ })).toHaveAttribute("href", "/feedback");
    // the error digest is shown so a report can name it
    expect(screen.getByText(/d3/)).toBeTruthy();
    // telemetry marks the recurrence
    expect(trackFriction.mock.calls[0]![1]).toMatchObject({ recurred: true });
  });

  it("a throwing sessionStorage never blocks reset (spec-339 class)", () => {
    const reset = vi.fn();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      render(<ErrorBoundary error={makeError("d4")} reset={reset} />);
      fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
      expect(reset).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("an error with NO digest still classifies (falls back to the error name)", () => {
    sessionStorage.setItem("err-retry:TypeError", "1");
    render(<ErrorBoundary error={makeError()} reset={() => {}} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
