// UX-audit gap G1 (S0 F-012 + S1 F-027): the app-wide error boundary.
//
// F-027 — a React-boundary-caught render crash NEVER reaches window.onerror
// (React swallows it), so telemetry-provider's listener structurally cannot
// see it: crashes were invisible in interaction_events and the S0's blast
// radius was unmeasurable. The boundary itself must emit js_error — once per
// mount (StrictMode double-invokes effects; the counts must stay comparable
// with the window.onerror path).
//
// F-012 — the boundary said "ลองใหม่" for EVERY crash and the button re-runs
// the crash. Honest-copy split: a FIRST occurrence is genuinely retryable and
// keeps the retry primary; a crash that RECURRED after the user already
// pressed retry stops promising retry and names real next steps. The
// mechanism (verified against next/dist/client/components/error-boundary.js):
// reset() clears the boundary's error state → the fallback UNMOUNTS; a
// re-throw REMOUNTS it fresh — so recurrence lives in sessionStorage
// (digest-or-name + ROUTE key, TTL-expired) and a mount-time read suffices.
// The replica harness below reproduces exactly that unmount/remount cycle.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** Current route key suffix — boundary keys are route-scoped. */
const route = () => window.location.pathname;
const keyFor = (idOrName: string) => `err-retry:${idOrName}:${route()}`;

// A faithful replica of Next's ErrorBoundaryHandler (error-boundary.js):
// getDerivedStateFromError stores the error; reset() clears it, which
// re-renders CHILDREN (unmounting the fallback); a re-throw re-derives the
// error and REMOUNTS the fallback. This is the cycle the real app runs.
class ReplicaBoundary extends React.Component<
  { children: React.ReactNode },
  { error: BoundaryError | null }
> {
  override state: { error: BoundaryError | null } = { error: null };
  static getDerivedStateFromError(error: BoundaryError) {
    return { error };
  }
  reset = () => this.setState({ error: null });
  override render() {
    if (this.state.error) return <ErrorBoundary error={this.state.error} reset={this.reset} />;
    return this.props.children;
  }
}

function AlwaysThrows(): React.ReactElement {
  throw makeError();
}

describe("app error boundary (UX-audit G1)", () => {
  beforeEach(() => {
    cleanup();
    trackFriction.mockClear();
    sessionStorage.clear();
    window.history.pushState({}, "", "/");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits ONE js_error friction event with message and digest (F-027)", () => {
    render(<ErrorBoundary error={makeError("d123")} reset={() => {}} />);
    expect(trackFriction).toHaveBeenCalledTimes(1);
    const [type, ctx] = trackFriction.mock.calls[0]!;
    expect(type).toBe("js_error");
    expect(ctx).toMatchObject({ where: "error_boundary", digest: "d123", recurred: false });
    expect(String(ctx.message)).toContain("TypeError");
  });

  it("first occurrence: no alert, retry is primary, pressing it calls reset()", () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={makeError("d1")} reset={reset} />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("pressing retry durably records a timestamped attempt for digest+route", () => {
    render(<ErrorBoundary error={makeError("d2")} reset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    const raw = sessionStorage.getItem(keyFor("d2"));
    expect(Number(raw)).toBeGreaterThan(0);
  });

  it("REAL cycle: retry against a still-broken child remounts into the honest variant", () => {
    // React logs caught errors; keep the output readable.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ReplicaBoundary>
          <AlwaysThrows />
        </ReplicaBoundary>,
      );
      // first catch: retryable variant
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
      // reset cleared the error → children re-threw → fallback REMOUNTED and
      // re-read sessionStorage → honest variant, no retry promise.
      const alert = screen.getByRole("alert");
      expect(alert.textContent).not.toContain("กรุณาลองใหม่อีกครั้ง");
      expect(screen.queryByRole("button", { name: "ลองใหม่" })).toBeNull();
      expect(screen.getByRole("link", { name: /กลับหน้าหลัก/ })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: /แจ้งปัญหา/ })).toHaveAttribute("href", "/feedback");
    } finally {
      spy.mockRestore();
    }
  });

  it("recurred (seeded): honest copy, exits, digest shown, telemetry marks it (F-012)", () => {
    sessionStorage.setItem(keyFor("d3"), String(Date.now()));
    render(<ErrorBoundary error={makeError("d3")} reset={() => {}} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/d3/)).toBeTruthy();
    expect(trackFriction.mock.calls[0]![1]).toMatchObject({ recurred: true });
  });

  it("the key is ROUTE-scoped: a retry elsewhere does not deny retry here", () => {
    // a retry recorded on another route, same error name
    sessionStorage.setItem("err-retry:TypeError:/other-route", String(Date.now()));
    window.history.pushState({}, "", "/this-route");
    render(<ErrorBoundary error={makeError()} reset={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeTruthy();
  });

  it("a recorded retry EXPIRES: an old attempt gets its retry back (TTL)", () => {
    sessionStorage.setItem(keyFor("d6"), String(Date.now() - 10 * 60_000));
    render(<ErrorBoundary error={makeError("d6")} reset={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeTruthy();
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
});
