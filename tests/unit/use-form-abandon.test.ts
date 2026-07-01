import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFormAbandon } from "@/lib/telemetry/use-form-abandon";

// Spec 244 U2b-3 — a form the user began filling but left WITHOUT a successful
// submit is a form_abandon friction signal (a form that's too long/confusing to
// finish). The reusable hook emits it on unmount (navigation away / teardown) iff
// markDirty was called and markSubmitted was not. PDPA-min: a stable form id ONLY,
// never field content. Best-effort via the friction bridge (no-ops if capture is
// inactive).

const { trackFriction } = vi.hoisted(() => ({ trackFriction: vi.fn() }));
vi.mock("@/lib/telemetry/friction", () => ({ trackFriction }));

afterEach(() => vi.clearAllMocks());

describe("useFormAbandon (spec 244 U2b-3)", () => {
  it("emits form_abandon (form id only, no content) when a dirtied form unmounts unsubmitted", () => {
    const { result, unmount } = renderHook(() => useFormAbandon("feedback"));
    result.current.markDirty();
    unmount();
    expect(trackFriction).toHaveBeenCalledTimes(1);
    expect(trackFriction).toHaveBeenCalledWith("form_abandon", { form: "feedback" });
  });

  it("does NOT emit when the form was submitted before leaving", () => {
    const { result, unmount } = renderHook(() => useFormAbandon("feedback"));
    result.current.markDirty();
    result.current.markSubmitted();
    unmount();
    expect(trackFriction).not.toHaveBeenCalled();
  });

  it("does NOT emit when the form was never touched", () => {
    const { unmount } = renderHook(() => useFormAbandon("feedback"));
    unmount();
    expect(trackFriction).not.toHaveBeenCalled();
  });

  // A reusable hook must be robust to a changing formId: a re-render with a new id
  // must NOT be mistaken for an unmount (no spurious abandon). The id at MOUNT is the
  // form that was abandoned.
  it("captures the mount-time form id; a formId change does not emit until unmount", () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useFormAbandon(id), {
      initialProps: { id: "feedback" },
    });
    result.current.markDirty();
    rerender({ id: "other" });
    expect(trackFriction).not.toHaveBeenCalled();
    unmount();
    expect(trackFriction).toHaveBeenCalledTimes(1);
    expect(trackFriction).toHaveBeenCalledWith("form_abandon", { form: "feedback" });
  });
});
