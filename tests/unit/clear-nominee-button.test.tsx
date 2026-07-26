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

import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { BUTTON_SECONDARY_MUTED, BUTTON_SECONDARY_MUTED_LAYOUT } from "@/lib/ui/classes";

const WORKER = "a1111111-1111-4111-8111-111111111111";

const ARMED = `${BUTTON_SECONDARY_MUTED_LAYOUT} border-edge bg-card text-danger`;

/** Every `--color-*` token, so "is this an ink?" is decided by the design SSOT
 *  and not a hand-written prefix list that quietly misses `text-wait`, the
 *  category hues, or the Tailwind keywords. */
const COLOR_TOKENS = new Set([
  ...[
    ...fs
      .readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8")
      .matchAll(/--color-([a-z0-9-]+)\s*:/g),
  ].map((m) => m[1]!),
  "white",
  "black",
  "transparent",
  "current",
  "inherit",
]);

/** The colour utilities a class string sets for `color` (the type ramp —
 *  `text-body`, `text-meta` — is not a colour and drops out via the token set). */
function inkClasses(className: string): string[] {
  return className
    .split(/\s+/)
    .filter((c) => c.startsWith("text-") && COLOR_TOKENS.has(c.slice("text-".length)));
}

describe("ClearNomineeButton (spec 320 U2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("arms a confirm before clearing — the action never fires on the first tap", () => {
    render(<ClearNomineeButton workerId={WORKER} />);
    fireEvent.click(screen.getByRole("button"));
    expect(clearPayoutNominee).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent("ยืนยันล้าง?");
  });

  it("the ARMED confirm reads destructive — exactly one ink, and it is the danger one", () => {
    render(<ClearNomineeButton workerId={WORKER} />);
    fireEvent.click(screen.getByRole("button"));
    const armed = screen.getByRole("button");

    expect(armed.className).toBe(ARMED);
    // The bug was TWO inks on one element, the neutral one winning. One ink only.
    expect(inkClasses(armed.className)).toEqual(["text-danger"]);
  });

  it("arming changes the ink and NOTHING else — same control, no geometry shift", () => {
    render(<ClearNomineeButton workerId={WORKER} />);
    const idle = screen.getByRole("button").className;
    fireEvent.click(screen.getByRole("button"));
    const armed = screen.getByRole("button").className;

    expect(idle).toBe(BUTTON_SECONDARY_MUTED);
    const geometry = (c: string) =>
      c
        .split(/\s+/)
        .filter((x) => !inkClasses(x).length)
        .sort();
    expect(geometry(armed)).toEqual(geometry(idle));
  });

  it("confirming relays to clearPayoutNominee for that worker", () => {
    clearPayoutNominee.mockResolvedValue({ ok: true });
    render(<ClearNomineeButton workerId={WORKER} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(clearPayoutNominee).toHaveBeenCalledWith(WORKER);
  });
});
