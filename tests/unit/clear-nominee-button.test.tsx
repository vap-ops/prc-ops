// Spec 320 U2 — ClearNomineeButton: the PM reclaims a worker's payout routing
// once the worker registers their own account. Two states: an idle trigger and
// an ARMED confirm.
//
// This exists because the armed confirm is unverifiable in a browser today —
// `worker_payout_nominee` has 0 rows, so the button has never rendered in
// production — and because its confirm colour was silently dead. It composed
// `${BUTTON_SECONDARY_MUTED} text-danger`, and BUTTON_SECONDARY_MUTED sets
// `text-ink`, which Tailwind v4 emits AFTER `text-danger` (alphabetical within
// a family) — so the destructive confirm rendered in neutral ink. Nothing
// caught it: the className string contained `text-danger` all along.
//
// The assertions below are therefore about the ARMED state's ink specifically,
// not just "some class is present": the armed control must carry the danger
// primitive and must NOT reintroduce a competing neutral ink.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { clearPayoutNominee, mockRefresh } = vi.hoisted(() => ({
  clearPayoutNominee: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/app/settings/payout-nominees/actions", () => ({ clearPayoutNominee }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { ClearNomineeButton } from "@/components/features/payroll/clear-nominee-button";
import { BUTTON_DANGER_OUTLINE_COMPACT } from "@/lib/ui/classes";

const WORKER = "a1111111-1111-4111-8111-111111111111";

/** The colour utilities a class string sets for `color`, per the design tokens. */
function inkClasses(className: string): string[] {
  return className.split(/\s+/).filter((c) => /^text-(ink|danger|action|done|attn|on-)/.test(c));
}

describe("ClearNomineeButton (spec 320 U2)", () => {
  it("arms a confirm before clearing — the action never fires on the first tap", () => {
    render(<ClearNomineeButton workerId={WORKER} />);
    fireEvent.click(screen.getByRole("button"));
    expect(clearPayoutNominee).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent("ยืนยันล้าง?");
  });

  it("the ARMED confirm reads destructive — exactly one ink, and it is the danger primitive's", () => {
    render(<ClearNomineeButton workerId={WORKER} />);
    fireEvent.click(screen.getByRole("button"));
    const armed = screen.getByRole("button");

    expect(armed.className).toBe(BUTTON_DANGER_OUTLINE_COMPACT);
    // The bug was TWO inks on one element, the neutral one winning. One ink only.
    expect(inkClasses(armed.className)).toEqual(["text-danger-ink"]);
    expect(armed.className).not.toContain("text-ink ");
    expect(armed.className.endsWith("text-ink")).toBe(false);
  });

  it("the idle trigger is NOT destructive — only the armed state is", () => {
    render(<ClearNomineeButton workerId={WORKER} />);
    const idle = screen.getByRole("button");
    expect(idle.className).not.toBe(BUTTON_DANGER_OUTLINE_COMPACT);
    expect(inkClasses(idle.className)).not.toContain("text-danger-ink");
  });

  it("confirming relays to clearPayoutNominee for that worker", () => {
    clearPayoutNominee.mockResolvedValue({ ok: true });
    render(<ClearNomineeButton workerId={WORKER} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(clearPayoutNominee).toHaveBeenCalledWith(WORKER);
  });
});
