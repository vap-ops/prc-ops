// Spec 76 (app-feel slice 1) — the toast/snackbar system.
//
// Announce model (review-driven): two persistent sr-only live regions — a
// polite region (role=status) for success and an assertive one (role=alert)
// for errors — exist on first paint and gain a keyed child per toast, so iOS
// VoiceOver reliably speaks them. The visible pills are presentational, so a
// message appears TWICE in the DOM (announce region + pill) — assert with the
// *All* queries. Errors persist until manually dismissed (WCAG 2.2.1).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/features/toast-provider";
import { useToast } from "@/lib/ui/use-toast";

function Harness() {
  const t = useToast();
  return (
    <div>
      <button onClick={() => t.success("บันทึกแล้ว")}>fire-success</button>
      <button onClick={() => t.error("ล้มเหลว")}>fire-error</button>
      <button onClick={() => t.fromResult({ ok: true }, "สำเร็จ")}>from-ok</button>
      <button onClick={() => t.fromResult({ ok: false, error: "พัง" }, "สำเร็จ")}>from-bad</button>
      <button
        onClick={() => {
          t.success("a");
          t.success("b");
          t.success("c");
          t.success("d");
        }}
      >
        fire-four
      </button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

describe("ToastProvider / useToast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("success announces via the polite (role=status) region", () => {
    renderWithProvider();
    act(() => fireEvent.click(screen.getByText("fire-success")));
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("บันทึกแล้ว");
  });

  it("error announces via the assertive (role=alert) region", () => {
    renderWithProvider();
    act(() => fireEvent.click(screen.getByText("fire-error")));
    const region = screen.getByRole("alert");
    expect(region).toHaveAttribute("aria-live", "assertive");
    expect(region).toHaveTextContent("ล้มเหลว");
  });

  it("fromResult maps {ok} to the polite region and {ok:false} to the assertive one", () => {
    renderWithProvider();
    act(() => fireEvent.click(screen.getByText("from-ok")));
    expect(screen.getByRole("status")).toHaveTextContent("สำเร็จ");
    act(() => fireEvent.click(screen.getByText("from-bad")));
    expect(screen.getByRole("alert")).toHaveTextContent("พัง");
  });

  it("auto-dismisses a success after the duration", () => {
    renderWithProvider();
    act(() => fireEvent.click(screen.getByText("fire-success")));
    expect(screen.queryAllByText("บันทึกแล้ว").length).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryAllByText("บันทึกแล้ว")).toHaveLength(0);
  });

  it("does NOT auto-dismiss an error (WCAG 2.2.1)", () => {
    renderWithProvider();
    act(() => fireEvent.click(screen.getByText("fire-error")));
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.queryAllByText("ล้มเหลว").length).toBeGreaterThan(0);
  });

  it("manual dismiss removes the toast", () => {
    renderWithProvider();
    act(() => fireEvent.click(screen.getByText("fire-success")));
    act(() => fireEvent.click(screen.getByRole("button", { name: "ปิด" })));
    expect(screen.queryAllByText("บันทึกแล้ว")).toHaveLength(0);
  });

  it("caps the visible stack at 3 (oldest dropped)", () => {
    renderWithProvider();
    act(() => fireEvent.click(screen.getByText("fire-four")));
    // One dismiss button per visible pill.
    expect(screen.getAllByRole("button", { name: "ปิด" })).toHaveLength(3);
    expect(screen.queryAllByText("a")).toHaveLength(0); // oldest dropped everywhere
    expect(screen.queryAllByText("d").length).toBeGreaterThan(0);
  });

  it("useToast no-ops outside a provider (does not throw)", () => {
    render(<Harness />);
    expect(() => act(() => fireEvent.click(screen.getByText("fire-success")))).not.toThrow();
    expect(screen.queryAllByText("บันทึกแล้ว")).toHaveLength(0);
  });
});
